import { readFileSync } from 'node:fs';

import { Injectable } from '@nestjs/common';

export type CustomerSyncConfiguration = {
  workspaceId: string;
  serviceUserId: string;
  targetUrl: string;
  sourceMode?: 'mysql' | 'mcp';
  mcp?: {
    entrypoint: string;
    sourceTimezone: string;
    timezoneVerified: boolean;
    maximumCacheBytes: number;
  };
  source: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  sourceDateOffset: string;
  writeMemberIds: number[];
  writeAllMembers?: boolean;
  importPaymentReviewContacts?: boolean;
  writeRegistrations?: boolean;
  verifiedSubscriptionHashes: string[];
  maximumUpdatesPerRun: number;
};

@Injectable()
export class CustomerSyncConfig {
  // A separate server-only file avoids exposing source credentials through the
  // instance configuration GraphQL API. Production requires explicit opt-in;
  // metadata requests must still stay inside the application container.
  read(): CustomerSyncConfiguration | null {
    const path = process.env.CUSTOMER_SYNC_CONFIG_FILE;

    if (!path) return null;

    try {
      const value: CustomerSyncConfiguration = JSON.parse(
        readFileSync(path, 'utf8'),
      );
      const url = new URL(value.targetUrl);
      if (
        value.sourceMode !== undefined &&
        !['mysql', 'mcp'].includes(value.sourceMode)
      )
        throw new Error();
      if (value.sourceMode === 'mcp') {
        if (
          !value.mcp?.entrypoint ||
          value.mcp.timezoneVerified !== true ||
          typeof value.mcp.sourceTimezone !== 'string' ||
          !value.mcp.sourceTimezone ||
          !Number.isSafeInteger(value.mcp.maximumCacheBytes) ||
          value.mcp.maximumCacheBytes < 1048576 ||
          value.mcp.maximumCacheBytes > 1073741824
        )
          throw new Error();
        new Intl.DateTimeFormat('en', {
          timeZone: value.mcp.sourceTimezone,
        }).format();
      }

      if (
        (process.env.NODE_ENV === 'production' &&
          process.env.CUSTOMER_SYNC_ALLOW_PRODUCTION !== 'true') ||
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.protocol !== 'http:' ||
        !/^[0-9a-f-]{36}$/i.test(value.workspaceId) ||
        !/^[0-9a-f-]{36}$/i.test(value.serviceUserId) ||
        !value.source?.host ||
        !value.source?.database ||
        !value.source?.user ||
        !/^[+-]\d{2}:\d{2}$/.test(value.sourceDateOffset) ||
        !Array.isArray(value.writeMemberIds) ||
        [value.writeAllMembers, value.importPaymentReviewContacts].some(
          (flag) => flag !== undefined && typeof flag !== 'boolean',
        ) ||
        (value.writeRegistrations !== undefined &&
          typeof value.writeRegistrations !== 'boolean') ||
        !value.writeMemberIds.every(
          (id) => Number.isSafeInteger(id) && id > 0,
        ) ||
        !Array.isArray(value.verifiedSubscriptionHashes) ||
        !value.verifiedSubscriptionHashes.every((hash) =>
          /^[a-f0-9]{64}$/.test(hash),
        ) ||
        !Number.isInteger(value.maximumUpdatesPerRun) ||
        value.maximumUpdatesPerRun < 1 ||
        value.maximumUpdatesPerRun > 10000
      )
        throw new Error();

      return value;
    } catch {
      throw new Error('CUSTOMER_SYNC_CONFIGURATION_INVALID');
    }
  }

  require(): CustomerSyncConfiguration {
    const configuration = this.read();

    if (!configuration) throw new Error('CUSTOMER_SYNC_NOT_CONFIGURED');

    return configuration;
  }
}
