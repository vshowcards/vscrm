import { type SourceOrder, type SourceSnapshot } from './customer-sync.types';
import { subscriptionHash } from './classify-customer';

export const matchSourceOrders = (snapshot: SourceSnapshot) => {
  const ordersByMember = new Map<number, SourceOrder[]>();
  const issuesByMember = new Map<number, Set<string>>();
  const referenceMembers = new Map<string, Set<number>>();
  const verifiedSubscriptionHashesByMember = new Map<number, string[]>();
  const unresolvedReferences = new Set<string>();
  const referenceKey = (
    provider: string,
    reference: string,
    opaqueKey?: string | null,
  ) => `${provider.trim().toLowerCase()}:${opaqueKey ?? reference}`;
  const orderReferences = new Set(
    snapshot.orders.map((order) =>
      referenceKey(
        order.payment_gateway_type,
        order.recurring_payment_id ?? '',
        order.subscription_key,
      ),
    ),
  );
  const exact = new Map<string, number[]>();
  const prefixes = new Map<string, number[]>();
  const issue = (memberId: number, code: string) => {
    const values = issuesByMember.get(memberId) ?? new Set<string>();

    values.add(code);
    issuesByMember.set(memberId, values);
  };

  for (const member of snapshot.members) {
    exact.set(member.username, [
      ...(exact.get(member.username) ?? []),
      member.member_id,
    ]);
    const prefix = member.username.slice(0, 12);

    prefixes.set(prefix, [...(prefixes.get(prefix) ?? []), member.member_id]);
  }
  const orderOwners = (username: string | null) => {
    if (!username?.trim()) return [];
    // Some source payment tables retain only the first twelve characters.
    return (
      exact.get(username) ??
      (username.length === 12 ? prefixes.get(username) : undefined) ??
      []
    );
  };
  for (const subscription of snapshot.subscriptions) {
    const candidates =
      exact.get(subscription.username) ??
      prefixes.get(subscription.username) ??
      [];
    const key = referenceKey(
      subscription.payment_gateway_type,
      subscription.subscription_id,
      subscription.subscription_key,
    );
    const members = referenceMembers.get(key) ?? new Set<number>();

    candidates.forEach((id) => members.add(id));
    referenceMembers.set(key, members);
    if (subscription.username.trim() && !candidates.length)
      unresolvedReferences.add(key);
    if (candidates.length > 1)
      candidates.forEach((id) => issue(id, 'AMBIGUOUS_SUBSCRIPTION_USERNAME'));
    if (!orderReferences.has(key)) {
      candidates.forEach((id) =>
        issue(id, 'SUBSCRIPTION_WITHOUT_MATCHED_ORDERS'),
      );
    }
  }
  // Check every event before trusting any event in the same payment stream.
  // A later conflicting owner must also invalidate the earlier events.
  for (const order of snapshot.orders) {
    const key = referenceKey(
      order.payment_gateway_type,
      order.recurring_payment_id ?? '',
      order.subscription_key,
    );
    if (!order.recurring_payment_id && !order.subscription_key) continue;
    const candidates = orderOwners(order.username);
    const owners = referenceMembers.get(key) ?? new Set<number>();
    candidates.forEach((id) => owners.add(id));
    referenceMembers.set(key, owners);
    if (order.username?.trim() && !candidates.length)
      unresolvedReferences.add(key);
  }
  let unmatchedOrders = 0;

  for (const order of snapshot.orders) {
    const candidates = new Set(orderOwners(order.username));
    const key = referenceKey(
      order.payment_gateway_type,
      order.recurring_payment_id ?? '',
      order.subscription_key,
    );
    const linked = referenceMembers.get(key);

    linked?.forEach((id) => candidates.add(id));
    if (candidates.size !== 1 || unresolvedReferences.has(key)) {
      unmatchedOrders++;
      candidates.forEach((id) =>
        issue(
          id,
          candidates.size > 1
            ? 'AMBIGUOUS_PAYMENT_OWNER'
            : 'UNMATCHED_PAYMENT_USERNAME',
        ),
      );
      (prefixes.get((order.username ?? '').slice(0, 12)) ?? []).forEach((id) =>
        issue(id, 'UNMATCHED_PAYMENT_USERNAME'),
      );
      continue;
    }
    const id = [...candidates][0];

    ordersByMember.set(id, [...(ordersByMember.get(id) ?? []), order]);
    if (
      (order.subscription_key || order.recurring_payment_id) &&
      ['paypal', 'apple', 'google'].includes(
        order.payment_gateway_type.trim().toLowerCase(),
      )
    ) {
      const hash =
        order.subscription_key ??
        subscriptionHash(
          order.payment_gateway_type.trim().toLowerCase(),
          order.recurring_payment_id ?? '',
        );
      const hashes = verifiedSubscriptionHashesByMember.get(id) ?? [];
      if (!hashes.includes(hash)) hashes.push(hash);
      verifiedSubscriptionHashesByMember.set(id, hashes);
    }
  }

  return {
    ordersByMember,
    issuesByMember,
    unmatchedOrders,
    verifiedSubscriptionHashesByMember,
  };
};
