import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue, Worker } from 'bullmq';
import { PermissionFlagType } from 'twenty-shared/constants';
import { DataSource, Repository } from 'typeorm';

import { RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';

import { CustomerSyncConfig } from './customer-sync.config';
import { CustomerSyncSourceService } from './customer-sync-source.service';
import { CustomerSyncStoreService } from './customer-sync-store.service';
import { CustomerSyncTargetService } from './customer-sync-target.service';
import {
  CUSTOMER_SYNC_RULE_VERSION,
  type SyncOutcome,
  type SyncRun,
} from './customer-sync.types';
import { classifyCustomer } from './classify-customer';
import { paginateSyncResults } from './paginate-sync-results';
import { matchSourceOrders } from './match-source-orders';
import {
  prepareRegistrations,
  classifyRegistration,
} from './prepare-registrations';

@Injectable()
export class CustomerSyncService implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue;
  private worker?: Worker;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly configuration: CustomerSyncConfig,
    private readonly source: CustomerSyncSourceService,
    private readonly target: CustomerSyncTargetService,
    private readonly store: CustomerSyncStoreService,
    private readonly redis: RedisClientService,
    private readonly dataSource: DataSource,
    private readonly permissions: PermissionsService,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaces: Repository<UserWorkspaceEntity>,
  ) {}

  async authorize(workspaceId: string, userId: string): Promise<void> {
    const configuration = this.configuration.require();

    if (workspaceId !== configuration.workspaceId)
      throw new ForbiddenException();
    const membership = await this.userWorkspaces.findOne({
      where: { workspaceId, userId },
    });

    if (!membership) throw new ForbiddenException();
    for (const setting of [
      PermissionFlagType.WORKSPACE,
      PermissionFlagType.DATA_MODEL,
      PermissionFlagType.WORKSPACE_MEMBERS,
    ]) {
      if (
        !(await this.permissions.userHasWorkspaceSettingPermission({
          workspaceId,
          userWorkspaceId: membership.id,
          setting,
        }))
      )
        throw new ForbiddenException();
    }
  }

  async onModuleInit() {
    if (!this.configuration.read()) return;
    const connection = this.redis.getQueueClient();

    this.queue = new Queue('customer-sync-local', { connection });
    this.worker = new Worker(
      'customer-sync-local',
      async (job) => this.process(job.data.runId),
      {
        connection,
        concurrency: 1,
        lockDuration: 120000,
      },
    );
    // BullMQ errors must not leak connection strings or source query payloads.
    this.worker.on('error', () => undefined);
    this.timer = setInterval(
      () => void this.schedule().catch(() => undefined),
      300000,
    );
    this.timer.unref();
    const configuration = this.configuration.require();
    const active = await this.store.get<string>(
      configuration.workspaceId,
      'active',
    );

    if (active) {
      const run = await this.store.get<SyncRun>(
        configuration.workspaceId,
        `run:${active}`,
      );

      if (run && ['queued', 'running'].includes(run.status))
        await this.queue.add(
          'run',
          { runId: run.id },
          {
            jobId: configuration.workspaceId,
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
    }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.queue?.close();
  }

  async status(workspaceId: string, summariesOnly = false) {
    const configuration = this.configuration.require();
    const ids = (await this.store.get<string[]>(workspaceId, 'history')) ?? [];
    const runs = summariesOnly
      ? await this.store.getRunSummaries(workspaceId, ids)
      : (
          await Promise.all(
            ids.map((id) => this.store.get<SyncRun>(workspaceId, `run:${id}`)),
          )
        ).filter((run): run is SyncRun => run !== null);

    return {
      configured: true,
      workspaceId,
      target: configuration.targetUrl,
      source:
        configuration.sourceMode === 'mcp'
          ? 'vShowcards MCP (read-only snapshot)'
          : 'vShowcards (read-only)',
      paused: (await this.store.get<boolean>(workspaceId, 'paused')) ?? true,
      intervalMinutes: 5,
      ruleVersion: CUSTOMER_SYNC_RULE_VERSION,
      pilotMemberCount: configuration.writeMemberIds.length,
      allMembersEnabled: configuration.writeAllMembers === true,
      registrationsEnabled: configuration.writeRegistrations === true,
      maximumUpdatesPerRun: configuration.maximumUpdatesPerRun,
      eventsSuppressed: true,
      runs,
    };
  }

  async resultsPage(
    workspaceId: string,
    runId: string,
    page: number,
    exceptionsOnly: boolean,
  ) {
    const run = await this.store.get<SyncRun>(workspaceId, `run:${runId}`);
    if (!run || run.workspaceId !== workspaceId) throw new NotFoundException();
    return paginateSyncResults(run, page, exceptionsOnly);
  }

  async initialize(workspaceId: string) {
    return this.withLock(`run:${workspaceId}`, async () => {
      const { objectId, fields } = await this.target.validateFields(true);

      await this.target.prepareViews(objectId, fields);

      return { initialized: true };
    });
  }

  async pause(workspaceId: string, actorId: string, paused: boolean) {
    await this.store.set(workspaceId, 'paused', paused);
    await this.store.set(workspaceId, 'schedule-audit', {
      actorId,
      paused,
      changedAt: new Date().toISOString(),
    });

    return { paused };
  }

  async start(
    workspaceId: string,
    actorId: string,
    mode: SyncRun['mode'],
    memberIds?: number[],
  ) {
    if (!this.queue) throw new Error('CUSTOMER_SYNC_NOT_CONFIGURED');

    return this.withLock(`enqueue:${workspaceId}`, async () => {
      const existing = await this.queue?.getJob(workspaceId);

      if (
        existing &&
        !['completed', 'failed'].includes(await existing.getState())
      ) {
        return { runId: existing.data.runId, coalesced: true };
      }
      if (mode === 'retry') {
        const history =
          (await this.store.get<string[]>(workspaceId, 'history')) ?? [];
        const retryIds = new Set<number>(
          (await this.store.get<number[]>(workspaceId, 'retry-members')) ?? [],
        );
        const seenIds = new Set<number>();
        let retryFullRead = false;

        for (const id of history) {
          const previous = await this.store.get<SyncRun>(
            workspaceId,
            `run:${id}`,
          );

          if (
            id === history[0] &&
            previous?.status === 'failed' &&
            !previous.results.length
          )
            retryFullRead = true;
          for (const result of previous?.results ?? []) {
            if (result.memberId === null) continue;
            if (seenIds.has(result.memberId)) continue;
            seenIds.add(result.memberId);
            if (
              !result.issues.includes('EXCLUDED_TEST_ACCOUNT') &&
              (['failed', 'review'].includes(result.outcome) ||
                result.issues.length)
            )
              retryIds.add(result.memberId);
            else retryIds.delete(result.memberId);
          }
        }
        memberIds = retryFullRead ? undefined : [...retryIds];
      }
      const run: SyncRun = {
        id: randomUUID(),
        workspaceId,
        actorId,
        mode,
        memberIds,
        status: 'queued',
        ruleVersion: CUSTOMER_SYNC_RULE_VERSION,
        startedAt: new Date().toISOString(),
        results: [],
      };
      const history =
        (await this.store.get<string[]>(workspaceId, 'history')) ?? [];

      await this.store.set(workspaceId, `run:${run.id}`, run);
      await this.store.set(workspaceId, 'active', run.id);
      await this.store.set(
        workspaceId,
        'history',
        [run.id, ...history].slice(0, 20),
      );
      for (const expired of history.slice(19))
        await this.store.remove(workspaceId, `run:${expired}`);
      await this.queue?.add(
        'run',
        { runId: run.id },
        {
          jobId: workspaceId,
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );

      return { runId: run.id, coalesced: false };
    });
  }

  private async schedule() {
    const configuration = this.configuration.require();

    if (
      (await this.store.get<boolean>(configuration.workspaceId, 'paused')) !==
      false
    )
      return;
    await this.authorize(
      configuration.workspaceId,
      configuration.serviceUserId,
    );
    await this.start(
      configuration.workspaceId,
      configuration.serviceUserId,
      'incremental',
    );
  }

  private async process(runId: string) {
    const configuration = this.configuration.require();
    const workspaceId = configuration.workspaceId;

    await this.withLock(`run:${workspaceId}`, async () => {
      const run = await this.store.get<SyncRun>(workspaceId, `run:${runId}`);

      if (!run) throw new Error('SYNC_RUN_NOT_FOUND');
      try {
        await this.authorize(workspaceId, run.actorId);
        await this.authorize(workspaceId, configuration.serviceUserId);
        run.status = 'running';
        run.results = [];
        delete run.error;
        await this.store.set(workspaceId, `run:${run.id}`, run);
        await this.target.validateFields();
        const snapshot = await this.source.read();
        const { ordersByMember, issuesByMember, unmatchedOrders } =
          matchSourceOrders(snapshot);

        run.sourceReadAt = snapshot.readAt;
        run.unmatchedOrders = unmatchedOrders;
        const selectedMembers = run.memberIds
          ? snapshot.members.filter((member) =>
              run.memberIds?.includes(member.member_id),
            )
          : snapshot.members;
        const members = [
          ...selectedMembers,
          ...(run.mode === 'member' ? [] : prepareRegistrations(snapshot)),
        ];
        const now = new Date();
        const candidates: {
          member: (typeof members)[number];
          state: ReturnType<typeof classifyCustomer>;
          preview: SyncOutcome;
        }[] = [];

        for (const member of members) {
          const state = member.registration
            ? classifyRegistration(member)
            : classifyCustomer({
                member,
                orders: ordersByMember.get(member.member_id) ?? [],
                now,
                verifiedSubscriptionHashes:
                  configuration.verifiedSubscriptionHashes,
                sourceDateOffset: configuration.sourceDateOffset,
                sourceTimezone: snapshot.sourceTimezone,
              });

          if (!member.registration && member.status !== -1)
            state.issues.push(...(issuesByMember.get(member.member_id) ?? []));
          const preview = await this.target.reconcile(member, state, true);

          candidates.push({ member, state, preview });
        }
        for (const missingId of (run.memberIds ?? []).filter(
          (id) => !members.some((member) => member.member_id === id),
        )) {
          run.results.push({
            memberId: missingId,
            outcome: 'review',
            groups: [],
            added: [],
            removed: [],
            issues: ['SOURCE_MEMBER_NOT_FOUND'],
          });
        }
        let remainingUpdates = configuration.maximumUpdatesPerRun;
        for (const { member, state, preview } of candidates) {
          try {
            const enabled =
              (configuration.writeAllMembers && !member.registration) ||
              (configuration.writeRegistrations &&
                (member.registration || preview.registrationManaged)) ||
              configuration.writeMemberIds.includes(member.member_id);
            const changes =
              enabled && ['created', 'updated'].includes(preview.outcome);
            if (run.mode !== 'preview' && changes && remainingUpdates === 0) {
              run.results.push({
                ...preview,
                outcome: 'skipped',
                issues: ['BATCH_LIMIT_RUN_SYNC_AGAIN'],
              });
              continue;
            }
            if (run.mode !== 'preview' && changes) remainingUpdates--;
            run.results.push(
              run.mode === 'preview'
                ? preview
                : await this.target.reconcile(member, state, false),
            );
          } catch {
            run.results.push({
              memberId: member.registration ? null : member.member_id,
              ...(member.registration
                ? { sourceKey: member.registration.references.join(', ') }
                : {}),
              outcome: 'failed',
              groups: [],
              added: [],
              removed: [],
              issues: ['CONTACT_WRITE_FAILED_RETRY_WITH_FRESH_SOURCE'],
            });
          }
          if (run.results.length % 25 === 0)
            await this.store.set(workspaceId, `run:${run.id}`, run);
        }
        run.status = run.results.some(
          (result) =>
            ['review', 'failed'].includes(result.outcome) ||
            (result.outcome !== 'skipped' && result.issues.length > 0),
        )
          ? 'completed-with-errors'
          : 'completed';
      } catch (error) {
        run.status = 'failed';
        // Known fixed codes are safe; arbitrary database/API messages are not.
        const code = error instanceof Error ? error.message : '';

        run.error = /^[A-Z][A-Z_]{3,80}$/.test(code)
          ? code
          : 'SYNC_CONNECTION_OR_VALIDATION_FAILED';
      } finally {
        run.finishedAt = new Date().toISOString();
        await this.store.set(workspaceId, `run:${run.id}`, run);
        const retryIds = new Set<number>(
          (await this.store.get<number[]>(workspaceId, 'retry-members')) ?? [],
        );

        for (const result of run.results) {
          if (result.memberId === null) continue;
          if (
            !result.issues.includes('EXCLUDED_TEST_ACCOUNT') &&
            (['failed', 'review'].includes(result.outcome) ||
              result.issues.length)
          )
            retryIds.add(result.memberId);
          else retryIds.delete(result.memberId);
        }
        await this.store.set(workspaceId, 'retry-members', [...retryIds]);
      }
      if (
        run.status === 'failed' ||
        run.results.some((result) => result.outcome === 'failed')
      ) {
        throw new Error(run.error ?? 'MEMBER_WRITES_REQUIRE_RETRY');
      }
    });
  }

  private async withLock<TResult>(
    key: string,
    callback: () => Promise<TResult>,
  ): Promise<TResult> {
    const runner = this.dataSource.createQueryRunner();

    await runner.connect();
    try {
      const result: { acquired: boolean }[] = await runner.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [`customer-sync:${key}`],
      );

      if (!result[0]?.acquired)
        throw new ConflictException('A sync operation is already running.');

      return await callback();
    } finally {
      await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [
        `customer-sync:${key}`,
      ]);
      await runner.release();
    }
  }
}
