import { classifyCustomer, subscriptionHash } from './classify-customer';
import { matchSourceOrders } from './match-source-orders';
import { type SourceMember, type SourceOrder } from './customer-sync.types';

const member: SourceMember = {
  member_id: 1,
  username: 'example-member',
  full_name: 'Example Member',
  email: 'example@example.test',
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
const order: SourceOrder = {
  order_id: 1,
  username: member.username,
  payment_gateway_type: 'paypal',
  recurring_payment_id: 'subscription-a',
  txn_type: 'recurring_payment',
  payment_type: null,
  payment_status: 'Completed',
  txn_profile_status: 'Active',
  next_seconds: Date.parse('2030-01-01') / 1000,
};
const key = subscriptionHash('paypal', 'subscription-a');
const match = (orders = [order], members = [member]) =>
  matchSourceOrders({
    members,
    orders,
    subscriptions: [
      {
        username: member.username,
        subscription_id: 'subscription-a',
        payment_gateway_type: 'paypal',
      },
    ],
    readAt: '2026-11-06T00:00:00Z',
  });

describe('automatic payment ownership verification', () => {
  it('classifies an unambiguous snapshot without a manual allowlist', () => {
    const matched = match();
    const state = classifyCustomer({
      member,
      orders: matched.ordersByMember.get(1) ?? [],
      verifiedSubscriptionHashes:
        matched.verifiedSubscriptionHashesByMember.get(1),
      now: new Date('2026-11-06'),
      sourceDateOffset: '+00:00',
    });
    expect(state.groups).toEqual(['PAID', 'PAYMENT_ACTIVE', 'WEB']);
    expect(state.issues).toEqual([]);
  });

  it('uses a unique subscription owner for orders with blank usernames', () => {
    expect(
      match([
        { ...order, username: null },
      ]).verifiedSubscriptionHashesByMember.get(1),
    ).toEqual([key]);
  });

  it('accepts an exact order owner even when the subscription row is absent', () => {
    const matched = matchSourceOrders({
      members: [member],
      orders: [order],
      subscriptions: [],
      readAt: '2026-11-06T00:00:00Z',
    });
    expect(matched.verifiedSubscriptionHashesByMember.get(1)).toEqual([key]);
  });

  it('accepts a unique twelve-character app username but rejects colliding prefixes', () => {
    const appMember = { ...member, username: '123456789012-app' };
    const appOrder = {
      ...order,
      username: '123456789012',
      payment_gateway_type: 'apple',
    };
    const snapshot = {
      members: [appMember],
      orders: [appOrder],
      subscriptions: [],
      readAt: '2026-11-06T00:00:00Z',
    };
    expect(
      matchSourceOrders(snapshot).verifiedSubscriptionHashesByMember.get(1),
    ).toEqual([subscriptionHash('apple', 'subscription-a')]);
    const conflicting = matchSourceOrders({
      ...snapshot,
      members: [
        appMember,
        { ...member, member_id: 2, username: '123456789012-other' },
      ],
    });
    expect(conflicting.ordersByMember.size).toBe(0);
    expect(conflicting.issuesByMember.get(1)).toContain(
      'AMBIGUOUS_PAYMENT_OWNER',
    );
  });

  it('withholds the whole stream when any order names another member', () => {
    const other = { ...member, member_id: 2, username: 'other-member' };
    const matched = match(
      [order, { ...order, order_id: 2, username: other.username }],
      [member, other],
    );
    expect(
      matched.verifiedSubscriptionHashesByMember.get(1) ?? [],
    ).not.toContain(key);
    expect(matched.issuesByMember.get(1)).toContain('AMBIGUOUS_PAYMENT_OWNER');
    expect(matched.issuesByMember.get(2)).toContain('AMBIGUOUS_PAYMENT_OWNER');
  });

  it('does not accept an unrecognised nonblank order username through its reference', () => {
    const matched = match([{ ...order, username: 'unknown-owner' }]);
    expect(
      matched.verifiedSubscriptionHashesByMember.get(1) ?? [],
    ).not.toContain(key);
    expect(matched.issuesByMember.get(1)).toContain(
      'UNMATCHED_PAYMENT_USERNAME',
    );
  });

  it('withholds a stream when its subscription names an unresolved owner', () => {
    const matched = matchSourceOrders({
      members: [member],
      orders: [order],
      subscriptions: [
        {
          username: 'unknown-owner',
          subscription_id: 'subscription-a',
          payment_gateway_type: 'paypal',
        },
      ],
      readAt: '2026-11-06T00:00:00Z',
    });
    expect(
      matched.verifiedSubscriptionHashesByMember.get(1) ?? [],
    ).not.toContain(key);
    expect(matched.issuesByMember.get(1)).toContain(
      'UNMATCHED_PAYMENT_USERNAME',
    );
  });

  it('preserves opaque MCP keys and prevents cross-provider reference matches', () => {
    const matched = matchSourceOrders({
      members: [member],
      subscriptions: [
        {
          username: member.username,
          subscription_id: '',
          payment_gateway_type: 'paypal',
          subscription_key: key,
        },
      ],
      orders: [{ ...order, recurring_payment_id: null, subscription_key: key }],
      readAt: '2026-11-06T00:00:00Z',
    });
    expect(matched.verifiedSubscriptionHashesByMember.get(1)).toEqual([key]);
    expect(
      match([{ ...order, payment_gateway_type: 'apple', username: null }])
        .ordersByMember.size,
    ).toBe(0);
  });
});
