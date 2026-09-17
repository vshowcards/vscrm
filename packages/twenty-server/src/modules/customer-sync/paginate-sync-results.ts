import { type SyncRun } from './customer-sync.types';

export const paginateSyncResults = (
  run: SyncRun,
  requestedPage: number,
  exceptionsOnly: boolean,
) => {
  const pageSize = 25;
  const counts: Record<string, number> = {};
  let groupAdditions = 0;
  let groupRemovals = 0;
  for (const result of run.results) {
    counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
    groupAdditions += result.added.length;
    groupRemovals += result.removed.length;
  }
  const filtered = exceptionsOnly
    ? run.results.filter((result) =>
        ['review', 'failed'].includes(result.outcome),
      )
    : run.results;
  const page = Math.min(
    requestedPage,
    Math.max(0, Math.ceil(filtered.length / pageSize) - 1),
  );
  return {
    runId: run.id,
    page,
    pageSize,
    total: filtered.length,
    counts,
    groupAdditions,
    groupRemovals,
    results: filtered.slice(page * pageSize, (page + 1) * pageSize),
  };
};
