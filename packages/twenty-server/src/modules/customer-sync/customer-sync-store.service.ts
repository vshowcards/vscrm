import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { type SyncRun } from './customer-sync.types';

@Injectable()
export class CustomerSyncStoreService {
  constructor(
    @InjectRepository(KeyValuePairEntity)
    private readonly repository: Repository<KeyValuePairEntity>,
  ) {}

  async getRunSummaries(workspaceId: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.repository
      .createQueryBuilder('entry')
      .select(
        `("entry"."value" - 'results' - 'memberIds') || jsonb_build_object('results', '[]'::jsonb, 'resultCount', jsonb_array_length(COALESCE("entry"."value"->'results', '[]'::jsonb)))`,
        'summary',
      )
      .where('entry.workspaceId = :workspaceId', { workspaceId })
      .andWhere('entry.key IN (:...keys)', {
        keys: ids.map((id) => `customer-sync:run:${id}`),
      })
      .andWhere('entry.userId IS NULL AND entry.applicationId IS NULL')
      .getRawMany<{ summary: SyncRun & { resultCount: number } }>();
    const byId = new Map(rows.map(({ summary }) => [summary.id, summary]));
    return ids.flatMap((id) => {
      const run = byId.get(id);
      return run ? [run] : [];
    });
  }

  async get<TValue>(workspaceId: string, key: string): Promise<TValue | null> {
    const row = await this.repository.findOne({
      where: {
        workspaceId,
        key: `customer-sync:${key}`,
        userId: IsNull(),
        applicationId: IsNull(),
      },
    });

    return (row?.value as unknown as TValue) ?? null;
  }

  async set(workspaceId: string, key: string, value: unknown): Promise<void> {
    await this.repository.upsert(
      {
        workspaceId,
        key: `customer-sync:${key}`,
        userId: null,
        applicationId: null,
        type: KeyValuePairType.USER_VARIABLE,
        value: value as JSON,
      },
      {
        conflictPaths: ['key', 'workspaceId'],
        indexPredicate: '"userId" IS NULL AND "applicationId" IS NULL',
      },
    );
  }

  async remove(workspaceId: string, key: string): Promise<void> {
    await this.repository.delete({
      workspaceId,
      key: `customer-sync:${key}`,
      userId: IsNull(),
      applicationId: IsNull(),
    });
  }
}
