import { readFileSync } from 'node:fs';

import { CustomerSyncConfig } from './customer-sync.config';

jest.mock('node:fs', () => ({ readFileSync: jest.fn() }));

describe('CustomerSyncConfig production deployment', () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.CUSTOMER_SYNC_CONFIG_FILE = '/run/secrets/customer-sync.json';
    delete process.env.CUSTOMER_SYNC_ALLOW_PRODUCTION;
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    jest.resetAllMocks();
  });

  const configure = (targetUrl = 'http://127.0.0.1:3000') => {
    jest.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        workspaceId: '20202020-1c25-4d02-bf25-6aeccf7ea419',
        serviceUserId: '20202020-9e3b-46d4-a556-88b9ddc2b034',
        targetUrl,
        source: { host: 'source', database: 'source', user: 'reader' },
        sourceDateOffset: '+00:00',
        writeMemberIds: [],
        verifiedSubscriptionHashes: [],
        maximumUpdatesPerRun: 5000,
      }),
    );
  };

  it('rejects production without explicit opt-in', () => {
    configure();
    expect(() => new CustomerSyncConfig().read()).toThrow(
      'CUSTOMER_SYNC_CONFIGURATION_INVALID',
    );
  });

  it('permits explicitly enabled production with a loopback target', () => {
    configure();
    process.env.CUSTOMER_SYNC_ALLOW_PRODUCTION = 'true';
    expect(new CustomerSyncConfig().read()?.targetUrl).toBe(
      'http://127.0.0.1:3000',
    );
  });

  it('still rejects remote targets after production opt-in', () => {
    configure('https://example.com');
    process.env.CUSTOMER_SYNC_ALLOW_PRODUCTION = 'true';
    expect(() => new CustomerSyncConfig().read()).toThrow(
      'CUSTOMER_SYNC_CONFIGURATION_INVALID',
    );
  });
});
