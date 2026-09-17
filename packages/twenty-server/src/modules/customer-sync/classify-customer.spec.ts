import {
  classifyCustomer,
  reconcileGroups,
  subscriptionHash,
} from './classify-customer';
import { matchSourceOrders } from './match-source-orders';
import { type SourceMember, type SourceOrder } from './customer-sync.types';

const member: SourceMember = {
  member_id: 1,
  username: 'test-member',
  full_name: 'Example Member',
  email: 'member@example.test',
  telephone: null,
  address: null,
  gender: null,
  gender_other: null,
  city: null,
  country: null,
  user_type: 1,
  isverify: 1,
  status: 1,
  is_free_access: 0,
  free_access_till_date: null,
  device_type: null,
  joined_seconds: 1700000000,
};
const now = new Date('2026-09-15T12:00:00Z');
const future = Date.parse('2026-10-15T12:00:00Z') / 1000;
const order: SourceOrder = {
  order_id: 1,
  username: member.username,
  payment_gateway_type: 'paypal',
  recurring_payment_id: 'subscription-a',
  txn_type: 'recurring_payment',
  payment_status: 'Completed',
  payment_type: null,
  txn_profile_status: 'Active',
  next_seconds: future,
};
const classify = (
  orders: SourceOrder[] = [],
  changes: Partial<SourceMember> = {},
  at = now,
) =>
  classifyCustomer({
    member: { ...member, ...changes },
    orders,
    now: at,
    sourceDateOffset: '+05:30',
    verifiedSubscriptionHashes: [subscriptionHash('paypal', 'subscription-a')],
  });

describe('vShowcards customer classification', () => {
  it('moves free to paid without retaining Free', () => {
    expect(classify().groups).toEqual(['FREE', 'WEB']);
    expect(classify([order]).groups).toEqual(['PAID', 'PAYMENT_ACTIVE', 'WEB']);
  });

  it('keeps Paid after failure until expiry, then removes it', () => {
    const failed = {
      ...order,
      txn_type: 'recurring_payment_failed',
      payment_status: 'Failed',
    };

    expect(classify([failed]).groups).toEqual([
      'PAID',
      'PAYMENT_FAILED',
      'WEB',
    ]);
    expect(classify([failed], {}, new Date('2026-11-01')).groups).toEqual([
      'LAPSED',
      'PAYMENT_FAILED',
      'WEB',
    ]);
  });

  it('recovers from failed to active without stale failed membership', () => {
    expect(
      classify([
        { ...order, txn_type: 'recurring_payment_failed' },
        { ...order, order_id: 2 },
      ]).groups,
    ).toEqual(['PAID', 'PAYMENT_ACTIVE', 'WEB']);
  });

  it('uses the same subscription previous expiry on blank PayPal cancellation', () => {
    const cancellation = {
      ...order,
      order_id: 2,
      txn_type: 'recurring_payment_profile_cancel',
      next_seconds: null,
    };
    const result = classify([order, cancellation]);

    expect(result.groups).toEqual(['PAID', 'PAYMENT_CANCELLED', 'WEB']);
    expect(result.nextPaymentDate).toBeNull();
    expect(result.accessValidUntil).toBe('2026-10-15T12:00:00.000Z');
    expect(classify([cancellation]).groups).not.toContain('PAID');
  });

  it('does not borrow expiry from another subscription', () => {
    const result = classify([
      order,
      {
        ...order,
        recurring_payment_id: 'subscription-b',
        order_id: 2,
        txn_type: 'recurring_payment_profile_cancel',
        next_seconds: null,
      },
    ]);

    expect(result.groups).toContain('PAID');
    expect(result.groups).toContain('PAYMENT_CANCELLED');
    expect(result.issues).toContain('PAYMENT_STREAM_REQUIRES_REVIEW');
  });

  it.each([null, 0])(
    'treats missing/zero expiry %s as no active paid access',
    (next_seconds) => {
      expect(classify([{ ...order, next_seconds }]).groups).not.toContain(
        'PAID',
      );
    },
  );

  it('keeps complimentary access separate from paid revenue', () => {
    expect(
      classify([], { is_free_access: 1, free_access_till_date: '2026-09-15' })
        .groups,
    ).toContain('COMPLIMENTARY');
    expect(
      classify([], { is_free_access: 1, free_access_till_date: '2026-09-14' })
        .groups,
    ).toContain('FREE');
  });

  it('maps google to subscription marker without inventing a paid or Android status', () => {
    expect(classify([], { device_type: 'google' }).groups).toEqual([
      'FREE',
      'GOOGLE_SUBSCRIBER',
    ]);
    expect(classify([], { device_type: '  ' }).groups).toEqual(['FREE', 'WEB']);
  });

  it('excludes source-deleted contacts from all current customer groups', () => {
    expect(classify([order], { status: -1 }).groups).toEqual([
      'SOURCE_DELETED',
    ]);
  });

  it('holds refund/revocation and decreasing expiry for review', () => {
    expect(classify([{ ...order, txn_type: 'REFUND' }]).issues).toContain(
      'REFUND_OR_REVOCATION_REQUIRES_REVIEW',
    );
    expect(
      classify([order, { ...order, order_id: 2, next_seconds: future - 86400 }])
        .issues,
    ).toContain('PAYMENT_EVENT_ORDER_REQUIRES_REVIEW');
  });

  it('reconciles overlapping groups and duplicate input as sets', () => {
    expect(
      reconcileGroups(
        ['PAID', 'PAID', 'PAYMENT_FAILED', 'WEB'],
        ['PAID', 'PAYMENT_ACTIVE', 'WEB', 'WEB'],
      ),
    ).toEqual({
      values: ['PAID', 'PAYMENT_ACTIVE', 'WEB'],
      added: ['PAYMENT_ACTIVE'],
      removed: ['PAYMENT_FAILED'],
    });
    expect(reconcileGroups(['PAID', 'WEB'], ['WEB', 'PAID']).added).toEqual([]);
  });
});

describe('source payment ownership', () => {
  it('does not guess between colliding twelve-character usernames', () => {
    const result = matchSourceOrders({
      members: [
        { ...member, username: '123456789012-a' },
        { ...member, member_id: 2, username: '123456789012-b' },
      ],
      orders: [{ ...order, username: '123456789012' }],
      subscriptions: [
        {
          username: '123456789012',
          subscription_id: 'subscription-a',
          payment_gateway_type: 'paypal',
        },
      ],
      readAt: now.toISOString(),
    });

    expect(result.ordersByMember.size).toBe(0);
    expect(result.issuesByMember.get(1)).toContain(
      'AMBIGUOUS_SUBSCRIPTION_USERNAME',
    );
    expect(result.issuesByMember.get(2)).toContain(
      'AMBIGUOUS_SUBSCRIPTION_USERNAME',
    );
  });

  it('uses a unique exact subscription reference to resolve blank order username', () => {
    const result = matchSourceOrders({
      members: [member],
      orders: [{ ...order, username: '' }],
      subscriptions: [
        {
          username: member.username,
          subscription_id: 'subscription-a',
          payment_gateway_type: 'paypal',
        },
      ],
      readAt: now.toISOString(),
    });

    expect(result.ordersByMember.get(1)).toHaveLength(1);
  });
});
