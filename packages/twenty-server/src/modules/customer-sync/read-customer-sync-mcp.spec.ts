import { collectCustomerSyncSnapshot } from './read-customer-sync-mcp';
import { classifyCustomer, subscriptionHash } from './classify-customer';
import { matchSourceOrders } from './match-source-orders';

const key = subscriptionHash('paypal', 'synthetic-subscription');
const member = {
  member_id: 144,
  username: 'example',
  full_name: 'Example',
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
  free_access_till_date_validity: 'null',
  device_type: null,
  joined_seconds: 1700000000,
  date_added_validity: 'valid',
};
const datasets = {
  members: [member],
  registrations: [],
  subscriptions: [
    {
      membership_subscription_id: 1,
      username: 'example',
      payment_gateway_type: 'paypal',
      subscription_key: key,
    },
  ],
  orders: [
    {
      order_id: 1,
      username: 'example',
      payment_gateway_type: 'paypal',
      subscription_key: key,
      txn_type: 'recurring_payment',
      payment_type: null,
      payment_status: 'Completed',
      txn_profile_status: 'Active',
      next_seconds: Date.parse('2030-01-01') / 1000,
      next_payment_date_validity: 'valid',
    },
  ],
};
const fixture = () => {
  const call = jest.fn(
    async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      if (name === 'get_sync_health')
        return {
          schema_version: '1',
          connectivity: 'available',
          source_timezone: 'Europe/London',
          timezone_verified: true,
          supports_changes: false,
          required_tables: [
            'member',
            'member_temp',
            'member_user_temp',
            'membership_subscription',
            'orders',
          ].map((table) => ({ table, compatible: true, transactional: true })),
        };
      const dataset = args.dataset as keyof typeof datasets;
      return {
        schema_version: '1',
        read_at: '2026-09-15T00:00:00Z',
        snapshot_id: 'a'.repeat(48),
        consistency: 'snapshot',
        source_timezone: 'Europe/London',
        cache_expires_at: '2099-01-01T00:00:00Z',
        dataset,
        items: datasets[dataset],
        complete: true,
        next_cursor: null,
        counts: { members: 1, registrations: 0, subscriptions: 1, orders: 1 },
      };
    },
  );
  return call;
};
describe('MCP customer snapshot adapter', () => {
  it('exhausts every dataset and preserves opaque keys without hashing twice', async () => {
    const snapshot = await collectCustomerSyncSnapshot(
      fixture(),
      'Europe/London',
    );
    const matched = matchSourceOrders(snapshot);
    expect(matched.unmatchedOrders).toBe(0);
    const state = classifyCustomer({
      member: snapshot.members[0],
      orders: matched.ordersByMember.get(144) ?? [],
      now: new Date('2026-09-15'),
      sourceDateOffset: '+05:30',
      sourceTimezone: snapshot.sourceTimezone,
      verifiedSubscriptionHashes: [key],
    });
    expect(state.groups).toEqual(['PAID', 'PAYMENT_ACTIVE', 'WEB']);
    expect(state.issues).toEqual([]);
    expect(snapshot.orders[0].recurring_payment_id).toBeNull();
  });
  it('refuses a timezone mismatch rather than falling back to the old reader', async () => {
    await expect(
      collectCustomerSyncSnapshot(fixture(), 'Asia/Calcutta'),
    ).rejects.toThrow();
  });
  it.each(['count', 'snapshot', 'cursor', 'duplicate', 'error'])(
    'rejects an invalid %s response',
    async (kind) => {
      const base = fixture();
      await expect(
        collectCustomerSyncSnapshot(async (name, args) => {
          const result = (await base(name, args)) as Record<string, unknown>;
          if (name === 'get_sync_health') return result;
          if (kind === 'count') return { ...result, items: [] };
          if (kind === 'snapshot' && args.dataset === 'orders')
            return { ...result, snapshot_id: 'b'.repeat(48) };
          if (kind === 'cursor')
            return { ...result, complete: false, next_cursor: null };
          if (kind === 'duplicate')
            return {
              ...result,
              counts: {
                members: 2,
                registrations: 0,
                subscriptions: 1,
                orders: 1,
              },
              items:
                args.dataset === 'members' ? [member, member] : result.items,
            };
          if (kind === 'error') return { error: { code: 'SNAPSHOT_EXPIRED' } };
          return result;
        }, 'Europe/London'),
      ).rejects.toThrow();
    },
  );
  it('uses the source calendar day for complimentary access across daylight saving', async () => {
    const snapshot = await collectCustomerSyncSnapshot(
      fixture(),
      'Europe/London',
    );
    const state = classifyCustomer({
      member: {
        ...snapshot.members[0],
        is_free_access: 1,
        free_access_till_date: '2026-07-01',
      },
      orders: [],
      now: new Date('2026-07-01T23:30:00Z'),
      sourceDateOffset: '+05:30',
      sourceTimezone: snapshot.sourceTimezone,
    });
    expect(state.groups).not.toContain('COMPLIMENTARY');
  });
});
