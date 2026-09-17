jest.mock('src/engine/core-modules/redis-client/redis-client.service', () => ({
  RedisClientService: class {},
}));
jest.mock(
  'src/engine/core-modules/user-workspace/user-workspace.entity',
  () => ({ UserWorkspaceEntity: class {} }),
);
jest.mock(
  'src/engine/metadata-modules/permissions/permissions.service',
  () => ({ PermissionsService: class {} }),
);
jest.mock('./customer-sync-target.service', () => ({
  CustomerSyncTargetService: class {},
}));
jest.mock('./customer-sync-store.service', () => ({
  CustomerSyncStoreService: class {},
}));

import { ForbiddenException } from '@nestjs/common';
import { PermissionFlagType } from 'twenty-shared/constants';

import { CustomerSyncService } from './customer-sync.service';

const buildService = (
  memberExists: boolean,
  deniedPermission?: PermissionFlagType,
) => {
  const source = { read: jest.fn() };
  const target = { reconcile: jest.fn() };
  const membership = {
    findOne: jest.fn(async () => (memberExists ? { id: 'membership' } : null)),
  };
  const permissions = {
    userHasWorkspaceSettingPermission: jest.fn(
      async ({ setting }: { setting: PermissionFlagType }) =>
        setting !== deniedPermission,
    ),
  };
  const args = [
    { require: () => ({ workspaceId: 'local-workspace' }) },
    source,
    target,
    {},
    {},
    {},
    permissions,
    membership,
  ] as unknown as ConstructorParameters<typeof CustomerSyncService>;

  return {
    service: new CustomerSyncService(...args),
    source,
    target,
    membership,
    permissions,
  };
};

describe('customer sync authorization', () => {
  it('rejects a different workspace before accessing its data', async () => {
    const { service, membership, source } = buildService(true);

    await expect(
      service.authorize('different-workspace', 'user'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(membership.findOne).not.toHaveBeenCalled();
    expect(source.read).not.toHaveBeenCalled();
  });

  it('rejects a user who is not a member of the configured workspace', async () => {
    const { service, permissions } = buildService(false);

    await expect(
      service.authorize('local-workspace', 'outsider'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      permissions.userHasWorkspaceSettingPermission,
    ).not.toHaveBeenCalled();
  });

  it.each([
    PermissionFlagType.WORKSPACE,
    PermissionFlagType.DATA_MODEL,
    PermissionFlagType.WORKSPACE_MEMBERS,
  ])('requires the %s administrator permission', async (permission) => {
    const { service, target } = buildService(true, permission);

    await expect(
      service.authorize('local-workspace', 'user'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(target.reconcile).not.toHaveBeenCalled();
  });

  it('accepts an authorized administrator in the configured workspace', async () => {
    const { service, permissions } = buildService(true);

    await expect(
      service.authorize('local-workspace', 'user'),
    ).resolves.toBeUndefined();
    expect(permissions.userHasWorkspaceSettingPermission).toHaveBeenCalledTimes(
      3,
    );
  });
});
