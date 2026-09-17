jest.mock(
  'src/engine/core-modules/key-value-pair/key-value-pair.entity',
  () => ({
    KeyValuePairEntity: class {},
    KeyValuePairType: { USER_VARIABLE: 'USER_VARIABLE' },
  }),
);

import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CustomerListAudienceService,
  parseAudienceGroup,
} from './customer-list-audience.service';

const setup = (rule: object | null = null) => {
  const repository = {
    findOne: jest.fn(async () => (rule ? { value: rule } : null)),
    upsert: jest.fn(),
    update: jest.fn(),
  };
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM core.workspace'))
      return [{ databaseSchema: 'workspace_test' }];
    if (sql.includes('FOR UPDATE')) return [{ id: 'list', name: 'Test list' }];
    if (sql.includes('WITH matching'))
      return [{ matching: 2, additions: 1, removals: 1 }];
    return [];
  });
  const manager = { query, getRepository: () => repository };
  const dataSource = {
    transaction: async (callback: (value: typeof manager) => unknown) =>
      callback(manager),
    query: jest.fn(async () => []),
  };
  const service = new CustomerListAudienceService(
    ...([
      dataSource,
      { read: () => ({ workspaceId: 'workspace' }) },
    ] as unknown as ConstructorParameters<typeof CustomerListAudienceService>),
  );
  return { service, query, repository, dataSource };
};

describe('customer group list audience', () => {
  it.each(['__proto__', 'unknown', null, 4])(
    'rejects invalid group %s',
    (group) => {
      expect(() => parseAudienceGroup(group)).toThrow(BadRequestException);
    },
  );

  it('previews without changing list members or policy', async () => {
    const { service, query, repository } = setup();
    expect(
      await service.preview('workspace', 'list', 'TRIED_REGISTER'),
    ).toMatchObject({ matching: 2, additions: 1, removals: 1 });
    expect(
      query.mock.calls.some(([sql]) => /INSERT|UPDATE .*SET/.test(sql)),
    ).toBe(false);
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('does not resume a disabled list in an automatic worker', async () => {
    const { service, repository, query } = setup({
      group: 'TRIED_REGISTER',
      automatic: false,
    });
    expect(await service.apply('workspace', 'list')).toBeNull();
    expect(repository.upsert).not.toHaveBeenCalled();
    expect(query.mock.calls).toHaveLength(2);
  });

  it('stops automatic updates without removing members', async () => {
    const { service, repository, query } = setup({
      group: 'TRIED_REGISTER',
      automatic: true,
    });
    await service.disable('workspace', 'list', 'admin');
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace' }),
      expect.objectContaining({
        value: expect.objectContaining({ automatic: false, actorId: 'admin' }),
      }),
    );
    expect(query.mock.calls).toHaveLength(2);
  });

  it('does not access another list if it is missing in the authorized workspace', async () => {
    const { service, query, repository } = setup();
    query.mockImplementation(async (sql) =>
      sql.includes('FROM core.workspace')
        ? [{ databaseSchema: 'workspace_test' }]
        : [],
    );
    await expect(
      service.apply('workspace', 'other-list', {
        group: 'TRIED_REGISTER',
        automatic: true,
        actorId: 'admin',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(repository.upsert).not.toHaveBeenCalled();
  });
});
