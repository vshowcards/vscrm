jest.mock(
  'src/engine/core-modules/auth/token/services/access-token.service',
  () => ({ AccessTokenService: class {} }),
);
jest.mock('src/engine/twenty-orm/workspace-orm.manager', () => ({
  WorkspaceOrmManager: class {},
}));
jest.mock('./customer-sync-store.service', () => ({
  CustomerSyncStoreService: class {},
}));

import { type AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { type WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';

import { type CustomerSyncConfig } from './customer-sync.config';
import { type CustomerSyncStoreService } from './customer-sync-store.service';
import { CustomerSyncTargetService } from './customer-sync-target.service';
import { classifyCustomer } from './classify-customer';
import { type SourceMember } from './customer-sync.types';
import {
  prepareRegistrations,
  classifyRegistration,
} from './prepare-registrations';

const member: SourceMember = {
  member_id: 144,
  username: 'example',
  full_name: 'Example Person',
  email: 'person@example.edu',
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
const state = classifyCustomer({
  member,
  orders: [],
  now: new Date('2026-09-15'),
  sourceDateOffset: '+05:30',
});

const createTarget = (options = {}) => {
  let stored: Record<string, unknown> | null = null;
  const mappings = new Map<string, unknown>();
  const repository = {
    find: jest.fn(
      async ({
        where,
      }: {
        where: Record<string, unknown>;
        withDeleted?: boolean;
      }) =>
        stored &&
        Object.entries(where).every(
          ([key, value]) =>
            JSON.stringify(stored?.[key]) === JSON.stringify(value) ||
            (key === 'emails' &&
              (stored?.emails as { primaryEmail?: string })?.primaryEmail ===
                (value as { primaryEmail?: string }).primaryEmail),
        )
          ? [stored]
          : [],
    ),
    findOne: jest.fn(async () => stored),
    insert: jest.fn(async (value: Record<string, unknown>) => {
      stored = { ...value, updatedAt: '2026-09-15T00:00:00.000Z' };
    }),
    update: jest.fn(
      async (_criteria: unknown, value: Record<string, unknown>) => {
        stored = { ...stored, ...value };
      },
    ),
  };
  const orm = {
    getRepository: jest.fn(() => repository),
    executeInWorkspaceContext: jest.fn(
      async (callback: () => Promise<unknown>) => callback(),
    ),
  };
  Object.assign(repository, {
    createQueryBuilder: () => {
      let where: Record<string, unknown> = {};
      const builder = {
        addSelect: () => builder,
        where: (value: Record<string, unknown>) => {
          where = value;
          return builder;
        },
        withDeleted: () => builder,
        getRawAndEntities: async () => {
          const entities = await repository.find({ where, withDeleted: true });
          return {
            entities,
            raw: entities.map((entity) => ({ syncVersion: entity.updatedAt })),
          };
        },
      };
      return builder;
    },
  });
  const store = {
    get: jest.fn(
      async (_workspace: string, key: string) => mappings.get(key) ?? null,
    ),
    set: jest.fn(async (_workspace: string, _key: string, value: unknown) => {
      mappings.set(_key, value);
    }),
  };
  const configuration = {
    require: () => ({
      workspaceId: '20202020-1c25-4d02-bf25-6aeccf7ea419',
      writeMemberIds: [144],
      writeRegistrations: true,
      ...options,
    }),
  };
  const target = new CustomerSyncTargetService(
    configuration as unknown as CustomerSyncConfig,
    {} as AccessTokenService,
    orm as unknown as WorkspaceOrmManager,
    store as unknown as CustomerSyncStoreService,
  );

  return {
    target,
    repository,
    orm,
    store,
    record: () => stored,
    change: (value: Record<string, unknown>) => {
      stored = { ...stored, ...value };
    },
  };
};

describe('customer contact reconciliation', () => {
  it('skips test accounts before any destination reads or writes, even outside preview', async () => {
    const { target, repository, orm } = createTarget({ writeAllMembers: true });
    const result = await target.reconcile(
      { ...member, full_name: 'UUIDtest2' },
      state,
      false,
    );
    expect(result.outcome).toBe('skipped');
    expect(result.issues).toContain('EXCLUDED_TEST_ACCOUNT');
    expect(orm.executeInWorkspaceContext).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('leaves previously imported contacts untouched when the source becomes a test account', async () => {
    const { target, record, repository } = createTarget();
    await target.reconcile(member, state, false);
    const before = JSON.stringify(record());
    const result = await target.reconcile(
      { ...member, email: 'testuser@gmail.com' },
      state,
      false,
    );
    expect(result.outcome).toBe('skipped');
    expect(JSON.stringify(record())).toBe(before);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('imports members outside the pilot when all-member sync is enabled, without duplicates', async () => {
    const { target, repository } = createTarget({ writeAllMembers: true });
    const outsidePilot = { ...member, member_id: 145 };
    expect((await target.reconcile(outsidePilot, state, false)).outcome).toBe(
      'created',
    );
    expect((await target.reconcile(outsidePilot, state, false)).outcome).toBe(
      'unchanged',
    );
    expect(repository.insert).toHaveBeenCalledTimes(1);
  });

  it('imports payment-review contact details without assigning uncertain payment groups', async () => {
    const { target, record } = createTarget({
      writeAllMembers: true,
      importPaymentReviewContacts: true,
    });
    const result = await target.reconcile(
      { ...member, member_id: 145, status: 0 },
      {
        ...state,
        groups: [
          'PAID',
          'PAYMENT_ACTIVE',
          'GOOGLE_SUBSCRIBER',
          'WEB',
          'INACTIVE',
        ],
        membershipState: 'Paid',
        paymentState: 'Current',
        issues: ['PAYMENT_STREAM_REQUIRES_REVIEW', 'AMBIGUOUS_PAYMENT_OWNER'],
      },
      false,
    );
    expect(result.outcome).toBe('created');
    expect(result.issues).toContain('AMBIGUOUS_PAYMENT_OWNER');
    expect(record()).toMatchObject({
      memberId: 145,
      membershipState: 'Needs Review',
      paymentState: 'Needs Review',
      customerGroups: ['INACTIVE', 'WEB'],
      nextPaymentDate: null,
    });
  });

  it('keeps source validation and destination identity conflicts blocked in full sync', async () => {
    const { target, repository } = createTarget({
      writeAllMembers: true,
      importPaymentReviewContacts: true,
    });
    const invalid = await target.reconcile(
      member,
      {
        ...state,
        issues: ['PAYMENT_STREAM_REQUIRES_REVIEW', 'UNKNOWN_ACCOUNT_STATUS'],
      },
      false,
    );
    expect(invalid.outcome).toBe('review');
    expect(repository.insert).not.toHaveBeenCalled();
    await target.reconcile(member, state, false);
    const duplicate = await target.reconcile(
      { ...member, member_id: 145 },
      state,
      false,
    );
    expect(duplicate.issues).toContain(
      'EMAIL_ALREADY_EXISTS_WITHOUT_THIS_MEMBER_ID',
    );
    expect(repository.insert).toHaveBeenCalledTimes(1);
  });

  it('uses the full database timestamp when updating an existing contact', async () => {
    const { target, change, repository } = createTarget();
    await target.reconcile(member, state, false);
    change({ updatedAt: '2026-09-15 10:57:39.858147+00' });
    await target.reconcile(
      { ...member, joined_seconds: 1700000100 },
      state,
      false,
    );
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: '2026-09-15 10:57:39.858147+00' }),
      expect.anything(),
    );
  });
  const registration = () =>
    prepareRegistrations({
      members: [],
      orders: [],
      subscriptions: [],
      readAt: '',
      registrations: [
        {
          source: 'web',
          id: 1,
          username: member.username,
          full_name: member.full_name,
          email: member.email,
          device_type: 'web',
          joined_seconds: 1600000000,
        },
      ],
    })[0];

  it('imports an attempt once with no Member ID, then promotes the same contact and date', async () => {
    const { target, record, repository } = createTarget();
    const pending = registration();
    const first = await target.reconcile(
      pending,
      classifyRegistration(pending),
      false,
    );
    expect(first.memberId).toBeNull();
    expect(record()?.memberId).toBeNull();
    expect(record()?.registrationDate).toBe(
      new Date(1600000000000).toISOString(),
    );
    expect(record()?.customerGroups).toEqual(['TRIED_REGISTER', 'WEB']);
    expect(
      (await target.reconcile(pending, classifyRegistration(pending), false))
        .outcome,
    ).toBe('unchanged');
    const promoted = await target.reconcile(member, state, false);
    expect(promoted.contactId).toBe(first.contactId);
    expect(promoted.outcome).toBe('updated');
    expect(record()?.memberId).toBe(144);
    expect(record()?.registrationDate).toBe(
      new Date(1700000000000).toISOString(),
    );
    expect(record()?.createdAt).toBe(new Date(1600000000000).toISOString());
    expect(record()?.customerGroups).toEqual(['FREE', 'WEB']);
    expect(repository.insert).toHaveBeenCalledTimes(1);
    expect(
      (await target.reconcile(pending, classifyRegistration(pending), false))
        .issues,
    ).toEqual(['REGISTRATION_ALREADY_CONVERTED']);
  });

  it('removes Tried Register on conversion even when payment classification needs review', async () => {
    const { target, record } = createTarget();
    const pending = registration();
    await target.reconcile(pending, classifyRegistration(pending), false);
    await target.reconcile(
      member,
      {
        ...state,
        groups: ['PAID', 'WEB'],
        issues: ['PAYMENT_STREAM_REQUIRES_REVIEW'],
      },
      false,
    );
    expect(record()?.memberId).toBe(144);
    expect(record()?.customerGroups).toEqual(['WEB']);
    expect(record()?.membershipState).toBe('Needs Review');
  });

  it('holds a different username rather than taking over a pending contact', async () => {
    const { target, record } = createTarget();
    const pending = registration();
    await target.reconcile(pending, classifyRegistration(pending), false);
    expect(
      (
        await target.reconcile(
          { ...member, username: 'different' },
          state,
          false,
        )
      ).issues,
    ).toEqual(['REGISTRATION_PROMOTION_REQUIRES_REVIEW']);
    expect(record()?.memberId).toBeNull();
  });

  it('updates the explicit source date without changing the CRM creation date', async () => {
    const { target, record } = createTarget();
    await target.reconcile(member, state, false);
    await target.reconcile(
      { ...member, joined_seconds: 1700000100 },
      state,
      false,
    );
    expect(record()?.registrationDate).toBe(
      new Date(1700000100000).toISOString(),
    );
    expect(record()?.createdAt).toBe(new Date(1700000000000).toISOString());
    expect(
      (await target.reconcile({ ...member, joined_seconds: null }, state, true))
        .issues,
    ).toEqual(['SOURCE_SIGNUP_DATE_INVALID']);
  });
  it('creates once, suppresses automations, preserves signup time and skips no-op writes', async () => {
    const { target, repository, orm, record } = createTarget();
    const first = await target.reconcile(member, state, false);
    const checked = record()?.lastSyncedAt;
    const second = await target.reconcile(member, state, false);

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('unchanged');
    expect(second.contactId).toBe(first.contactId);
    expect(repository.insert).toHaveBeenCalledTimes(1);
    expect(repository.update).not.toHaveBeenCalled();
    expect(record()?.lastSyncedAt).toBe(checked);
    expect(record()?.createdAt).toBe(new Date(1700000000000).toISOString());
    expect(orm.getRepository).toHaveBeenCalledWith(
      'person',
      { shouldBypassPermissionChecks: true },
      { shouldSkipEventEmission: true },
    );
  });

  it('previews without writing contacts or identity mappings', async () => {
    const { target, repository, store } = createTarget();

    expect((await target.reconcile(member, state, true)).outcome).toBe(
      'created',
    );
    expect(repository.insert).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('keeps CRM-only details and guards updates against concurrent edits', async () => {
    const { target, repository, record, change } = createTarget();

    await target.reconcile(member, state, false);
    change({
      jobTitle: 'Keep me',
      companyId: 'keep-company',
      emails: {
        primaryEmail: member.email,
        additionalEmails: ['extra@example.edu'],
      },
      customerGroups: ['FREE', 'WEB', 'VIP'],
    });
    await target.reconcile(
      { ...member, email: 'changed@example.edu' },
      state,
      false,
    );

    expect(record()?.jobTitle).toBe('Keep me');
    expect(record()?.companyId).toBe('keep-company');
    expect(record()?.emails).toEqual({
      primaryEmail: 'changed@example.edu',
      additionalEmails: ['extra@example.edu'],
    });
    expect(record()?.customerGroups).toContain('VIP');
    expect(repository.update).toHaveBeenCalledWith(
      { id: record()?.id, updatedAt: '2026-09-15T00:00:00.000Z' },
      expect.objectContaining({ memberId: 144 }),
    );
  });

  it('holds duplicate Member IDs and trashed contacts without creating another', async () => {
    const { target, repository, change } = createTarget();

    repository.find.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    expect((await target.reconcile(member, state, false)).issues).toEqual([
      'DUPLICATE_MEMBER_ID',
    ]);
    change({ id: 'trashed', memberId: 144, deletedAt: '2026-09-01' });
    expect((await target.reconcile(member, state, false)).issues).toEqual([
      'CONTACT_IN_TRASH',
    ]);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('skips source-deleted members initially and preserves an existing record', async () => {
    const { target, record, repository } = createTarget();
    const deletedMember = { ...member, status: -1 };
    const deletedState = classifyCustomer({
      member: deletedMember,
      orders: [],
      now: new Date(),
      sourceDateOffset: '+05:30',
    });

    expect(
      (await target.reconcile(deletedMember, deletedState, false)).outcome,
    ).toBe('skipped');
    await target.reconcile(member, state, false);
    const originalId = record()?.id;

    await target.reconcile(deletedMember, deletedState, false);
    expect(record()?.id).toBe(originalId);
    expect(record()?.name).toEqual({
      firstName: member.full_name,
      lastName: '',
    });
    expect(record()?.customerGroups).toEqual(['SOURCE_DELETED']);
    expect(record()?.status).toBe(-1);
    expect(repository.insert).toHaveBeenCalledTimes(1);
  });

  it('recovers a timeout after a committed insert by reading the existing contact', async () => {
    const { target, repository, change } = createTarget();

    repository.insert.mockImplementationOnce(async (value) => {
      change({ ...value, updatedAt: '2026-09-15T00:00:00.000Z' });
      throw new Error('Simulated timeout after commit');
    });
    await expect(target.reconcile(member, state, false)).rejects.toThrow(
      'Simulated timeout',
    );
    expect((await target.reconcile(member, state, false)).outcome).toBe(
      'unchanged',
    );
    expect(repository.insert).toHaveBeenCalledTimes(1);
  });

  it('removes duplicate group entries while preserving valid overlapping groups', async () => {
    const { target, record, change } = createTarget();

    await target.reconcile(member, state, false);
    change({ customerGroups: ['FREE', 'WEB', 'WEB'] });
    expect((await target.reconcile(member, state, false)).outcome).toBe(
      'updated',
    );
    expect(record()?.customerGroups).toEqual(['FREE', 'WEB']);
  });
});
