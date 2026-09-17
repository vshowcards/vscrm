import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { DataSource, type EntityManager, IsNull } from 'typeorm';

import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { CustomerSyncConfig } from './customer-sync.config';
import { CUSTOMER_GROUPS, type CustomerGroup } from './customer-sync.types';

type AudienceRule = {
  group: CustomerGroup;
  automatic: boolean;
  updatedAt: string;
  actorId: string;
  lastReconciledAt: string;
};
const PREFIX = 'customer-sync:list-audience:';

export const parseAudienceGroup = (group: unknown): CustomerGroup => {
  if (
    typeof group !== 'string' ||
    !Object.prototype.hasOwnProperty.call(CUSTOMER_GROUPS, group)
  )
    throw new BadRequestException('Select a valid customer group.');
  return group as CustomerGroup;
};

@Injectable()
export class CustomerListAudienceService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(CustomerListAudienceService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configuration: CustomerSyncConfig,
  ) {}

  onModuleInit() {
    if (!this.configuration.read()) return;
    this.timer = setInterval(() => void this.reconcileAutomatic(), 60000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async context(
    manager: EntityManager,
    workspaceId: string,
    listId: string,
  ) {
    const workspaces: { databaseSchema: string }[] = await manager.query(
      'SELECT "databaseSchema" FROM core.workspace WHERE id = $1',
      [workspaceId],
    );
    const schema = workspaces[0]?.databaseSchema;
    if (!schema || !/^workspace_[a-zA-Z0-9_]+$/.test(schema))
      throw new NotFoundException();
    const lists: { id: string; name: string }[] = await manager.query(
      `SELECT id, name FROM "${schema}"."messageList" WHERE id = $1 AND "deletedAt" IS NULL FOR UPDATE`,
      [listId],
    );
    if (!lists[0]) throw new NotFoundException('List not found.');
    const repository = manager.getRepository(KeyValuePairEntity);
    const entry = await repository.findOne({
      where: {
        workspaceId,
        key: `${PREFIX}${listId}`,
        userId: IsNull(),
        applicationId: IsNull(),
      },
    });
    return {
      schema,
      list: lists[0],
      rule: (entry?.value as unknown as AudienceRule) ?? null,
      repository,
    };
  }

  async status(workspaceId: string, listId: string) {
    return this.dataSource.transaction(async (manager) => {
      const { list, rule } = await this.context(manager, workspaceId, listId);
      return {
        list,
        rule,
        groups: Object.entries(CUSTOMER_GROUPS).map(([value, label]) => ({
          value,
          label,
        })),
      };
    });
  }

  private async previewWithManager(
    manager: EntityManager,
    schema: string,
    listId: string,
    group: CustomerGroup,
  ) {
    const counts: { matching: number; additions: number; removals: number }[] =
      await manager.query(
        `
      WITH matching AS (SELECT id FROM "${schema}".person WHERE "deletedAt" IS NULL AND $2 = ANY("customerGroups"::text[])),
      current_members AS (SELECT "personId" FROM "${schema}"."messageListMember" WHERE "listId" = $1 AND "deletedAt" IS NULL)
      SELECT (SELECT count(*)::int FROM matching) AS matching,
      (SELECT count(*)::int FROM matching WHERE id NOT IN (SELECT "personId" FROM current_members)) AS additions,
      (SELECT count(*)::int FROM current_members WHERE "personId" NOT IN (SELECT id FROM matching)) AS removals`,
        [listId, group],
      );
    const sample: { id: string; name: string }[] = await manager.query(
      `
      SELECT id, concat_ws(' ', "nameFirstName", "nameLastName") AS name FROM "${schema}".person
      WHERE "deletedAt" IS NULL AND $1 = ANY("customerGroups"::text[]) ORDER BY id LIMIT 10`,
      [group],
    );
    return { ...counts[0], sample };
  }

  async preview(workspaceId: string, listId: string, group: CustomerGroup) {
    return this.dataSource.transaction(async (manager) => {
      const { schema } = await this.context(manager, workspaceId, listId);
      return this.previewWithManager(manager, schema, listId, group);
    });
  }

  async apply(
    workspaceId: string,
    listId: string,
    input?: { group: CustomerGroup; automatic: boolean; actorId: string },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const { schema, rule, repository } = await this.context(
        manager,
        workspaceId,
        listId,
      );
      if (!input && !rule?.automatic) return null;
      const selection = input ?? rule!;
      const group = parseAudienceGroup(selection.group);
      const preview = await this.previewWithManager(
        manager,
        schema,
        listId,
        group,
      );
      // Direct transactional writes deliberately avoid email, workflow, and webhook events.
      await manager.query(
        `UPDATE "${schema}"."messageListMember" SET "deletedAt" = now(), "updatedAt" = now()
        WHERE "listId" = $1 AND "deletedAt" IS NULL AND "personId" NOT IN
        (SELECT id FROM "${schema}".person WHERE "deletedAt" IS NULL AND $2 = ANY("customerGroups"::text[]))`,
        [listId, group],
      );
      await manager.query(
        `INSERT INTO "${schema}"."messageListMember" ("listId", "personId")
        SELECT $1, id FROM "${schema}".person WHERE "deletedAt" IS NULL AND $2 = ANY("customerGroups"::text[])
        ON CONFLICT ("personId", "listId") WHERE "deletedAt" IS NULL DO NOTHING`,
        [listId, group],
      );
      const now = new Date().toISOString();
      const nextRule: AudienceRule = {
        group,
        automatic: selection.automatic,
        actorId: selection.actorId,
        updatedAt: input ? now : rule!.updatedAt,
        lastReconciledAt: now,
      };
      await repository.upsert(
        {
          workspaceId,
          key: `${PREFIX}${listId}`,
          userId: null,
          applicationId: null,
          type: KeyValuePairType.USER_VARIABLE,
          value: nextRule as unknown as JSON,
        },
        {
          conflictPaths: ['key', 'workspaceId'],
          indexPredicate: '"userId" IS NULL AND "applicationId" IS NULL',
        },
      );
      return { ...preview, rule: nextRule };
    });
  }

  async disable(workspaceId: string, listId: string, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const { rule, repository } = await this.context(
        manager,
        workspaceId,
        listId,
      );
      if (rule)
        await repository.update(
          {
            workspaceId,
            key: `${PREFIX}${listId}`,
            userId: IsNull(),
            applicationId: IsNull(),
          },
          {
            value: {
              ...rule,
              automatic: false,
              actorId,
              updatedAt: new Date().toISOString(),
            } as unknown as JSON,
          },
        );
      return { disabled: true };
    });
  }

  async reconcileAutomatic() {
    if (this.running) return;
    const configuration = this.configuration.read();
    if (!configuration) return;
    this.running = true;
    try {
      const entries: { key: string }[] = await this.dataSource.query(
        `SELECT key FROM core."keyValuePair"
        WHERE "workspaceId" = $1 AND "userId" IS NULL AND "applicationId" IS NULL
        AND key LIKE $2 AND value->>'automatic' = 'true'`,
        [configuration.workspaceId, `${PREFIX}%`],
      );
      for (const { key } of entries) {
        try {
          await this.apply(configuration.workspaceId, key.slice(PREFIX.length));
        } catch (error) {
          if (!(error instanceof NotFoundException))
            this.logger.warn(
              'Campaign list audience update failed; it will retry next minute.',
            );
        }
      }
    } catch {
      this.logger.warn(
        'Campaign list audience schedule unavailable; it will retry next minute.',
      );
    } finally {
      this.running = false;
    }
  }
}
