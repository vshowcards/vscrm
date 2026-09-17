import { createHash } from 'node:crypto';

import {
  type CustomerClassification,
  type CustomerGroup,
  type SourceMember,
  type SourceOrder,
} from './customer-sync.types';

export const subscriptionHash = (provider: string, reference: string) =>
  createHash('sha256').update(`${provider}:${reference}`).digest('hex');

const validSeconds = (value: number | null) =>
  value !== null && Number.isFinite(Number(value)) && Number(value) > 0
    ? Number(value)
    : null;

export const classifyCustomer = ({
  member,
  orders,
  now,
  verifiedSubscriptionHashes = [],
  sourceDateOffset,
  sourceTimezone,
}: {
  member: SourceMember;
  orders: SourceOrder[];
  now: Date;
  verifiedSubscriptionHashes?: string[];
  sourceDateOffset: string;
  sourceTimezone?: string;
}): CustomerClassification => {
  const groups = new Set<CustomerGroup>();
  const issues = new Set<string>(member.sourceIssues ?? []);
  const device = (member.device_type ?? '').trim().toLowerCase();
  const platform =
    (
      {
        '': 'Web',
        apple: 'Apple',
        android: 'Android',
        google: 'Unknown',
      } as Record<string, string>
    )[device] ?? 'Unknown';
  const accountState =
    (
      { 1: 'Active', 0: 'Inactive', [-1]: 'Source Deleted' } as Record<
        number,
        string
      >
    )[member.status] ?? 'Unknown';

  if (accountState === 'Unknown') issues.add('UNKNOWN_ACCOUNT_STATUS');
  if (![0, 1, 2, 3].includes(member.user_type)) issues.add('UNKNOWN_USER_TYPE');
  if (!['', 'apple', 'android', 'google'].includes(device))
    issues.add('UNKNOWN_DEVICE');
  if (device === '') groups.add('WEB');
  if (device === 'apple') groups.add('APPLE');
  if (device === 'android') groups.add('ANDROID');
  if (device === 'google') groups.add('GOOGLE_SUBSCRIBER');
  if (member.status === 0) groups.add('INACTIVE');
  if (member.status === -1)
    return {
      groups: ['SOURCE_DELETED'],
      accountState,
      membershipState: 'Unknown',
      paymentState: 'Inactive',
      paymentProvider: '',
      platform,
      accessValidUntil: null,
      nextPaymentDate: null,
      issues: [],
    };

  const streams = new Map<string, SourceOrder[]>();

  for (const order of orders) {
    const provider = (order.payment_gateway_type ?? '').trim().toLowerCase();
    if (
      !['paypal', 'apple', 'google'].includes(provider) ||
      (!order.recurring_payment_id && !order.subscription_key)
    ) {
      issues.add('PAYMENT_IDENTITY_INCOMPLETE');
      continue;
    }
    const hash =
      order.subscription_key ??
      subscriptionHash(provider, order.recurring_payment_id ?? '');
    if (order.next_payment_date_validity === 'invalid')
      issues.add('PAYMENT_DATE_INVALID');

    if (!verifiedSubscriptionHashes.includes(hash))
      issues.add('PAYMENT_STREAM_REQUIRES_REVIEW');
    const stream = streams.get(hash) ?? [];

    stream.push(order);
    streams.set(hash, stream);
  }

  const states = new Set<string>();
  const providers = new Set<string>();
  const expiries: number[] = [];
  const nextDates: number[] = [];
  let previouslyPaid = false;

  for (const stream of streams.values()) {
    stream.sort((left, right) => left.order_id - right.order_id);
    const latest = stream[stream.length - 1];
    const provider = latest.payment_gateway_type.trim().toLowerCase();
    const event = (latest.txn_type ?? '').toUpperCase();
    const subtype = (latest.payment_type ?? '').toUpperCase();
    const status = (latest.payment_status ?? '').toUpperCase();
    const profile = (latest.txn_profile_status ?? '').toUpperCase();
    let expiry = validSeconds(latest.next_seconds);

    providers.add(provider);
    previouslyPaid ||= stream.some(
      (order) => validSeconds(order.next_seconds) !== null,
    );
    if (expiry) nextDates.push(expiry);
    const cancelled =
      /CANCEL/.test(event) ||
      /CANCEL/.test(status) ||
      /CANCEL/.test(profile) ||
      (event === 'DID_CHANGE_RENEWAL_STATUS' &&
        subtype === 'AUTO_RENEW_DISABLED');
    const failed =
      /FAIL|SKIP|ON_HOLD|GRACE_PERIOD/.test(event) || status === 'FAILED';
    const pending =
      status === 'PENDING' || (provider === 'google' && status === '0');

    if (/REFUND|REVOK|REVERSE/.test(event) || /REFUND|REVERSE/.test(status)) {
      issues.add('REFUND_OR_REVOCATION_REQUIRES_REVIEW');
    }
    if (provider === 'paypal' && cancelled && expiry === null) {
      const previous = stream
        .slice(0, -1)
        .reverse()
        .find((order) => validSeconds(order.next_seconds) !== null);

      expiry = previous ? validSeconds(previous.next_seconds) : null;
    }
    // A decreasing expiry can be a delayed callback or an entitlement adjustment.
    // Neither is safe to resolve by database arrival order alone.
    if (
      expiry &&
      stream
        .slice(0, -1)
        .some((order) => (validSeconds(order.next_seconds) ?? 0) > expiry)
    ) {
      issues.add('PAYMENT_EVENT_ORDER_REQUIRES_REVIEW');
    }
    const active = expiry !== null && expiry * 1000 > now.getTime();

    if (active && expiry !== null) expiries.push(expiry);
    if (provider === 'google') groups.add('GOOGLE_SUBSCRIBER');
    if (cancelled) {
      groups.add('PAYMENT_CANCELLED');
      states.add('Cancelled');
    } else if (failed) {
      groups.add('PAYMENT_FAILED');
      states.add('Failed');
    } else if (pending) states.add('Pending');
    else if (active) {
      const knownSuccess =
        provider === 'paypal'
          ? ['COMPLETED', 'SUCCESS', 'ACTIVE', ''].includes(status)
          : provider === 'apple'
            ? ['PURCHASE', 'RENEWAL'].includes(status)
            : ['1', '2'].includes(status);

      if (knownSuccess) {
        groups.add('PAYMENT_ACTIVE');
        states.add('Current');
      } else issues.add('UNKNOWN_PAYMENT_STATUS');
    } else states.add('Inactive');
  }

  const complimentaryDate = (member.free_access_till_date ?? '').slice(0, 10);
  if (streams.size > 1 && states.size > 1) {
    issues.add('MULTIPLE_SUBSCRIPTION_STATES_REQUIRES_REVIEW');
  }
  const complimentaryExpiry = /^\d{4}-\d{2}-\d{2}$/.test(complimentaryDate)
    ? Date.parse(`${complimentaryDate}T23:59:59${sourceDateOffset}`)
    : NaN;
  const sourceToday = sourceTimezone
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: sourceTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now)
    : null;
  const complimentary =
    member.is_free_access === 1 &&
    (sourceToday
      ? /^\d{4}-\d{2}-\d{2}$/.test(complimentaryDate) &&
        complimentaryDate >= sourceToday
      : complimentaryExpiry >= now.getTime());
  const membershipState = expiries.length
    ? 'Paid'
    : complimentary
      ? 'Complimentary'
      : previouslyPaid
        ? 'Lapsed'
        : 'Free';

  groups.add(
    (
      {
        Paid: 'PAID',
        Complimentary: 'COMPLIMENTARY',
        Lapsed: 'LAPSED',
        Free: 'FREE',
      } as const
    )[membershipState],
  );
  const isoMaximum = (seconds: number[]) =>
    seconds.length ? new Date(Math.max(...seconds) * 1000).toISOString() : null;

  return {
    groups: [...groups].sort(),
    accountState,
    membershipState,
    paymentState: [...states].sort().join(', ') || 'Inactive',
    paymentProvider: [...providers].sort().join(', '),
    platform,
    accessValidUntil: isoMaximum(expiries),
    nextPaymentDate: isoMaximum(nextDates),
    issues: [...issues].sort(),
  };
};

export const reconcileGroups = (current: string[], desired: string[]) => {
  const uniqueCurrent = [...new Set(current)];
  const uniqueDesired = [...new Set(desired)].sort();

  return {
    values: uniqueDesired,
    added: uniqueDesired.filter((group) => !uniqueCurrent.includes(group)),
    removed: uniqueCurrent.filter((group) => !uniqueDesired.includes(group)),
  };
};
