import { paginateSyncResults } from './paginate-sync-results';
import { type SyncRun } from './customer-sync.types';

const run: SyncRun = {
  id: 'example',
  workspaceId: 'workspace',
  actorId: 'actor',
  mode: 'preview',
  status: 'completed-with-errors',
  ruleVersion: 'test',
  startedAt: '',
  results: Array.from({ length: 63 }, (_, index) => ({
    memberId: index + 1,
    outcome: index % 2 === 0 ? ('review' as const) : ('created' as const),
    groups: [],
    added: ['WEB'],
    removed: [],
    issues: [],
  })),
};

describe('sync result pagination', () => {
  it('returns bounded, non-overlapping pages in original order with full-run totals', () => {
    const first = paginateSyncResults(run, 0, false);
    const second = paginateSyncResults(run, 1, false);
    expect(first.results).toHaveLength(25);
    expect(second.results).toHaveLength(25);
    expect(second.results[0].memberId).toBe(26);
    expect(first.total).toBe(63);
    expect(first.counts).toEqual({ review: 32, created: 31 });
    expect(first.groupAdditions).toBe(63);
    expect(run.results).toHaveLength(63);
  });

  it('filters before pagination and keeps summary counts for the entire run', () => {
    const page = paginateSyncResults(run, 1, true);
    expect(page.total).toBe(32);
    expect(page.results).toHaveLength(7);
    expect(page.results.every((result) => result.outcome === 'review')).toBe(
      true,
    );
    expect(page.results[0].memberId).toBe(51);
    expect(page.counts.created).toBe(31);
  });

  it('clamps stale page numbers and handles an empty running report', () => {
    expect(paginateSyncResults(run, 999, false).page).toBe(2);
    expect(
      paginateSyncResults({ ...run, results: [] }, 4, false),
    ).toMatchObject({ page: 0, total: 0, results: [] });
  });
});
