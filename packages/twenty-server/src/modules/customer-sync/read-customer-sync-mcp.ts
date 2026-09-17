import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

import { type CustomerSyncConfiguration } from './customer-sync.config';
import { type SourceSnapshot } from './customer-sync.types';

const DATASETS = [
  'members',
  'registrations',
  'subscriptions',
  'orders',
] as const;
const identifier = z.number().int().positive().safe();
const nullableText = z.string().nullable();
const seconds = z.number().finite().nullable();
const validity = z.enum(['valid', 'null', 'zero', 'invalid']);
const subscriptionKey = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .nullable();
const memberSchema = z.object({
  member_id: identifier,
  username: nullableText,
  full_name: nullableText,
  email: nullableText,
  telephone: nullableText,
  address: nullableText,
  gender: nullableText,
  gender_other: nullableText,
  city: nullableText,
  country: nullableText,
  user_type: z.number().int().nullable(),
  isverify: z.number().int().nullable(),
  status: z.number().int().nullable(),
  is_free_access: z.number().int().nullable(),
  free_access_till_date: nullableText,
  free_access_till_date_validity: validity,
  device_type: nullableText,
  joined_seconds: seconds,
  date_added_validity: validity,
});
const registrationSchema = z.object({
  id: identifier,
  source: z.enum(['web', 'app']),
  source_id: z.string(),
  username: nullableText,
  full_name: nullableText,
  email: nullableText,
  device_type: nullableText,
  joined_seconds: seconds,
  date_added_validity: validity,
});
const subscriptionSchema = z.object({
  membership_subscription_id: identifier,
  username: nullableText,
  payment_gateway_type: nullableText,
  subscription_key: subscriptionKey,
});
const orderSchema = z.object({
  order_id: identifier,
  username: nullableText,
  payment_gateway_type: nullableText,
  subscription_key: subscriptionKey,
  txn_type: nullableText,
  payment_type: nullableText,
  payment_status: nullableText,
  txn_profile_status: nullableText,
  next_seconds: seconds,
  next_payment_date_validity: validity,
});
const countsSchema = z.object({
  members: z.number().int().nonnegative(),
  registrations: z.number().int().nonnegative(),
  subscriptions: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
});
const pageSchema = z.object({
  schema_version: z.literal('1'),
  read_at: z.iso.datetime(),
  snapshot_id: z.string().regex(/^[a-f0-9]{48}$/),
  consistency: z.literal('snapshot'),
  source_timezone: z.string(),
  dataset: z.enum(DATASETS),
  items: z.array(z.unknown()),
  next_cursor: z.string().nullable(),
  complete: z.boolean(),
  counts: countsSchema.optional(),
  expires_at: z.iso.datetime().optional(),
  cache_expires_at: z.iso.datetime(),
});

export type SyncMcpCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export const collectCustomerSyncSnapshot = async (
  call: SyncMcpCall,
  sourceTimezone: string,
): Promise<SourceSnapshot> => {
  const health = z
    .object({
      schema_version: z.literal('1'),
      connectivity: z.literal('available'),
      source_timezone: z.literal(sourceTimezone),
      timezone_verified: z.literal(true),
      required_tables: z.array(
        z.object({
          table: z.string(),
          compatible: z.literal(true),
          transactional: z.literal(true),
        }),
      ),
      supports_changes: z.literal(false),
    })
    .parse(await call('get_sync_health', {}));
  const tableNames = new Set(health.required_tables.map((row) => row.table));
  if (
    ![
      'member',
      'member_temp',
      'member_user_temp',
      'membership_subscription',
      'orders',
    ].every((name) => tableNames.has(name))
  )
    throw new Error('MCP_SOURCE_SCHEMA_INVALID');
  const first = pageSchema.parse(
    await call('get_sync_snapshot', { dataset: 'members', limit: 500 }),
  );
  const counts = countsSchema.parse(first.counts);
  if (
    !counts.members ||
    counts.members > 100000 ||
    counts.registrations > 100000 ||
    counts.subscriptions > 100000 ||
    counts.orders > 1000000
  )
    throw new Error('SOURCE_SIZE_OUTSIDE_PILOT_LIMIT');
  const rows: Record<(typeof DATASETS)[number], unknown[]> = {
    members: [],
    registrations: [],
    subscriptions: [],
    orders: [],
  };
  for (const dataset of DATASETS) {
    let page =
      dataset === 'members'
        ? first
        : pageSchema.parse(
            await call('get_sync_snapshot', {
              snapshot_id: first.snapshot_id,
              dataset,
              limit: 500,
            }),
          );
    const cursors = new Set<string>();
    while (true) {
      if (
        page.dataset !== dataset ||
        page.snapshot_id !== first.snapshot_id ||
        page.read_at !== first.read_at ||
        page.source_timezone !== sourceTimezone ||
        Date.parse(page.cache_expires_at) <= Date.now()
      )
        throw new Error('MCP_SNAPSHOT_CHANGED_OR_EXPIRED');
      if (
        page.counts &&
        DATASETS.some((name) => page.counts?.[name] !== counts[name])
      )
        throw new Error('MCP_SNAPSHOT_COUNT_CHANGED');
      rows[dataset].push(...page.items);
      if (rows[dataset].length > counts[dataset])
        throw new Error('MCP_SNAPSHOT_COUNT_MISMATCH');
      if (page.complete) {
        if (
          page.next_cursor !== null ||
          rows[dataset].length !== counts[dataset]
        )
          throw new Error('MCP_SNAPSHOT_INCOMPLETE');
        break;
      }
      if (
        !page.next_cursor ||
        !page.items.length ||
        cursors.has(page.next_cursor)
      )
        throw new Error('MCP_SNAPSHOT_CURSOR_INVALID');
      cursors.add(page.next_cursor);
      page = pageSchema.parse(
        await call('get_sync_snapshot', {
          snapshot_id: first.snapshot_id,
          dataset,
          limit: 500,
          cursor: page.next_cursor,
        }),
      );
    }
  }
  const members = rows.members.map((row) => memberSchema.parse(row));
  const registrations = rows.registrations.map((row) =>
    registrationSchema.parse(row),
  );
  const subscriptions = rows.subscriptions.map((row) =>
    subscriptionSchema.parse(row),
  );
  const orders = rows.orders.map((row) => orderSchema.parse(row));
  for (const keys of [
    members.map((row) => row.member_id),
    registrations.map((row) => `${row.source}:${row.id}`),
    subscriptions.map((row) => row.membership_subscription_id),
    orders.map((row) => row.order_id),
  ])
    if (new Set<string | number>(keys).size !== keys.length)
      throw new Error('MCP_DUPLICATE_SOURCE_ID');
  if (registrations.some((row) => row.source_id !== `${row.source}:${row.id}`))
    throw new Error('MCP_REGISTRATION_ID_INVALID');
  const joined = (row: {
    date_added_validity: string;
    joined_seconds: number | null;
  }) => (row.date_added_validity === 'valid' ? row.joined_seconds : null);
  return {
    members: members.map((row) => ({
      ...row,
      sourceIssues:
        row.free_access_till_date_validity === 'invalid'
          ? ['COMPLIMENTARY_DATE_INVALID']
          : [],
      username: row.username ?? '',
      full_name: row.full_name ?? '',
      email: row.email ?? '',
      user_type: row.user_type ?? -999,
      isverify: row.isverify ?? -999,
      status: row.status ?? -999,
      is_free_access: row.is_free_access ?? 0,
      free_access_till_date:
        row.free_access_till_date_validity === 'valid'
          ? row.free_access_till_date
          : null,
      joined_seconds: joined(row),
    })),
    registrations: registrations.map((row) => ({
      ...row,
      username: row.username ?? '',
      full_name: row.full_name ?? '',
      email: row.email ?? '',
      joined_seconds: joined(row),
    })),
    subscriptions: subscriptions.map((row) => ({
      ...row,
      username: row.username ?? '',
      payment_gateway_type: row.payment_gateway_type ?? '',
      subscription_id: '',
    })),
    orders: orders.map((row) => ({
      ...row,
      payment_gateway_type: row.payment_gateway_type ?? '',
      recurring_payment_id: null,
      next_seconds:
        row.next_payment_date_validity === 'valid' ? row.next_seconds : null,
    })),
    readAt: first.read_at,
    sourceTimezone,
  };
};

export const readCustomerSyncMcp = async (
  configuration: CustomerSyncConfiguration,
): Promise<SourceSnapshot> => {
  const mcp = configuration.mcp;
  if (!mcp) throw new Error('CUSTOMER_SYNC_MCP_NOT_CONFIGURED');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcp.entrypoint],
    stderr: 'pipe',
    env: {
      DOTENV_CONFIG_PATH: '/nonexistent/customer-sync.env',
      DB_HOST: configuration.source.host,
      DB_PORT: String(configuration.source.port),
      DB_USER: configuration.source.user,
      DB_PASSWORD: configuration.source.password,
      DB_NAME: configuration.source.database,
      SYNC_AUTH_MODE: 'local-stdio',
      SYNC_PRINCIPAL: configuration.serviceUserId,
      SYNC_SOURCE_ID: configuration.workspaceId,
      SYNC_SOURCE_TIMEZONE: mcp.sourceTimezone,
      SYNC_TIMEZONE_VERIFIED: String(mcp.timezoneVerified),
      SYNC_MAX_CACHE_BYTES: String(mcp.maximumCacheBytes),
    },
  });
  // Drain privately; child stderr may include database details on unexpected errors.
  transport.stderr?.on('data', () => undefined);
  const client = new Client({ name: 'vscrm-customer-sync', version: '1.0.0' });
  try {
    await client.connect(transport, { signal: AbortSignal.timeout(15000) });
    const signal = AbortSignal.timeout(180000);
    return await collectCustomerSyncSnapshot(async (name, args) => {
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        { signal, timeout: 120000 },
      );
      if (result.isError) throw new Error('MCP_TOOL_REPORTED_ERROR');
      if (!result.structuredContent)
        throw new Error('MCP_STRUCTURED_RESPONSE_MISSING');
      return result.structuredContent;
    }, mcp.sourceTimezone);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    throw new Error(
      /^(MCP|SOURCE|CUSTOMER_SYNC)_[A-Z_]{3,80}$/.test(code)
        ? code
        : 'MCP_SOURCE_READ_FAILED',
    );
  } finally {
    await client.close();
    await transport.close();
  }
};
