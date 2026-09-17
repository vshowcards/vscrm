import { Injectable } from '@nestjs/common';

import { createConnection, type RowDataPacket } from 'mysql2/promise';

import { CustomerSyncConfig } from './customer-sync.config';
import { readCustomerSyncMcp } from './read-customer-sync-mcp';
import {
  type SourceMember,
  type SourceOrder,
  type SourceSnapshot,
  type SourceRegistration,
} from './customer-sync.types';

@Injectable()
export class CustomerSyncSourceService {
  constructor(private readonly configuration: CustomerSyncConfig) {}

  async read(): Promise<SourceSnapshot> {
    const configuration = this.configuration.require();
    if (configuration.sourceMode === 'mcp')
      return readCustomerSyncMcp(configuration);
    const connection = await createConnection({
      ...configuration.source,
      connectTimeout: 10000,
      dateStrings: true,
      multipleStatements: false,
    });

    try {
      await connection.query(
        'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ',
      );
      await connection.query(
        'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',
      );
      const [engines] = await connection.query<RowDataPacket[]>(
        "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('member', 'orders', 'membership_subscription', 'member_temp', 'member_user_temp')",
      );

      if (
        engines.length !== 5 ||
        engines.some((row) => row.ENGINE !== 'InnoDB')
      ) {
        throw new Error('SOURCE_SNAPSHOT_NOT_TRANSACTIONAL');
      }

      const [members] = await connection.query<
        (SourceMember & RowDataPacket)[]
      >({
        sql: `SELECT member_id, username, full_name, email, telephone, address,
          gender, gender_other, city, country, user_type, isverify, status,
          is_free_access, free_access_till_date, device_type,
          UNIX_TIMESTAMP(date_added) AS joined_seconds FROM member ORDER BY member_id`,
        timeout: 30000,
      });
      const [orders] = await connection.query<(SourceOrder & RowDataPacket)[]>({
        sql: `SELECT order_id, username, payment_gateway_type, recurring_payment_id,
          txn_type, payment_type, payment_status, txn_profile_status,
          UNIX_TIMESTAMP(next_payment_date) AS next_seconds FROM orders ORDER BY order_id`,
        timeout: 30000,
      });
      const [subscriptions] = await connection.query<
        (SourceSnapshot['subscriptions'][number] & RowDataPacket)[]
      >({
        sql: 'SELECT username, subscription_id, payment_gateway_type FROM membership_subscription',
        timeout: 30000,
      });

      const [registrations] = await connection.query<
        (SourceRegistration & RowDataPacket)[]
      >({
        sql: `SELECT 'web' AS source, id, username, fullname AS full_name, email,
          'web' AS device_type, UNIX_TIMESTAMP(date_added) AS joined_seconds FROM member_temp
          UNION ALL SELECT 'app' AS source, id, username, full_name, email,
          device_type, UNIX_TIMESTAMP(date_added) AS joined_seconds FROM member_user_temp`,
        timeout: 30000,
      });

      if (
        !members.length ||
        members.length > 100000 ||
        orders.length > 1000000 ||
        registrations.length > 100000
      ) {
        throw new Error('SOURCE_SIZE_OUTSIDE_PILOT_LIMIT');
      }

      await connection.commit();

      return {
        members,
        orders,
        subscriptions,
        registrations,
        readAt: new Date().toISOString(),
      };
    } finally {
      // Closing also rolls back if a read failed; no source writes are issued.
      await connection.end();
    }
  }
}
