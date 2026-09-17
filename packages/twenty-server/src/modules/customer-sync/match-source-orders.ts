import { type SourceOrder, type SourceSnapshot } from './customer-sync.types';

export const matchSourceOrders = (snapshot: SourceSnapshot) => {
  const ordersByMember = new Map<number, SourceOrder[]>();
  const issuesByMember = new Map<number, Set<string>>();
  const referenceMembers = new Map<string, Set<number>>();
  const referenceKey = (
    provider: string,
    reference: string,
    opaqueKey?: string | null,
  ) =>
    opaqueKey ? `key:${opaqueKey}` : `${provider.toLowerCase()}:${reference}`;
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
    if (candidates.length > 1)
      candidates.forEach((id) => issue(id, 'AMBIGUOUS_SUBSCRIPTION_USERNAME'));
    if (!orderReferences.has(key)) {
      candidates.forEach((id) =>
        issue(id, 'SUBSCRIPTION_WITHOUT_MATCHED_ORDERS'),
      );
    }
  }
  let unmatchedOrders = 0;

  for (const order of snapshot.orders) {
    const candidates = new Set(exact.get(order.username ?? '') ?? []);
    const linked = referenceMembers.get(
      referenceKey(
        order.payment_gateway_type,
        order.recurring_payment_id ?? '',
        order.subscription_key,
      ),
    );

    linked?.forEach((id) => candidates.add(id));
    if (candidates.size !== 1) {
      unmatchedOrders++;
      candidates.forEach((id) => issue(id, 'AMBIGUOUS_PAYMENT_OWNER'));
      (prefixes.get((order.username ?? '').slice(0, 12)) ?? []).forEach((id) =>
        issue(id, 'UNMATCHED_PAYMENT_USERNAME'),
      );
      continue;
    }
    const id = [...candidates][0];

    ordersByMember.set(id, [...(ordersByMember.get(id) ?? []), order]);
  }

  return { ordersByMember, issuesByMember, unmatchedOrders };
};
