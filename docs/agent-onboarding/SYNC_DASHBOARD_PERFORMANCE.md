# Sync Management performance — 2026-09-16

The original dashboard requested every result from the latest 20 runs every five seconds, including while automatic sync was paused. An earlier local measurement returned about 5.7 MB and 32,086 result rows in 3.4 seconds. This was unnecessary transfer and browser processing for a 20-row history table.

## Implementation

- `GET /app/customer-sync/summary` returns run metadata and result counts. PostgreSQL removes results and member-ID arrays before transferring records to the backend. History is fetched in a single scoped query, preserving its saved order. No source snapshot is captured.
- `GET /app/customer-sync/runs/:runId/results?page=0&exceptionsOnly=false` returns at most 25 result rows. It fetches only the requested run from storage, computes whole-run counts/group totals, filters exceptions before pagination, and clamps stale page numbers. Run IDs and page/filter parameters are validated.
- Both endpoints retain the existing workspace/admin authorization. Missing or wrong-workspace run records are not returned.
- The frontend loads result pages only after View is clicked. It aborts obsolete detail requests and displays a loader while fetching them. Whole-run totals remain whole-run totals, regardless of page or exception filter.
- Summary polling waits for the preceding request. It runs every three seconds while a task is active and every 30 seconds when automatic sync is enabled but idle. Hidden tabs skip polling requests. When automatic sync is paused and no task is active, periodic polling stops; Refresh history and window focus can refresh the summary.
- The original complete status endpoint remains for compatibility with local operator scripts. The browser no longer uses it.

No customer data, grouping rules, source records, scheduling preferences or saved history were deleted/changed by this performance work. The Windows-mounted development filesystem remains a separate source of cold-start and module-loading overhead; this change does not claim to eliminate that overhead.

## Verification

The backend suite passed 71 tests across seven suites, including bounded pages, filtering before pagination, whole-run totals and empty reports. A frontend behavior test verifies that a paused idle page makes no periodic requests and that View, Next and exception filtering request the expected pages. Runtime measurements are appended after loading the change locally.

### Local runtime measurements

Authenticated Windows HTTP measurements against the same 20 saved runs after restart:

| Request | Response bytes | First measurement | Warm repeat |
|---|---:|---:|---:|
| Legacy complete history | 6,613,157 | 7,922 ms | 7,072 ms |
| New summary | 8,323 | 115 ms | 66 ms |
| First result page (25 rows) | 5,349 | 62 ms | 59 ms |

These are local request measurements, not a browser end-to-end rendering benchmark or a guaranteed timing. Summary transfer size decreased by approximately 99.9%. All 20 run counts matched the legacy response; result-page order, total counts and exception filtering matched. Unauthenticated summary access returned 403 and a negative page returned 400. The frontend serves the new summary/pagination code with no legacy interval loop. Automatic sync remains paused. No sync was initiated for verification.

Both frontend/backend type checks, scoped lint, formatting and `git diff --check` passed. The frontend test confirmed no periodic fetch over one simulated idle minute and on-demand View/Next/filter requests. Backend and frontend tests total 72 passing checks. During development, a test needed to await asynchronous results before checking pagination; a repository lint rule also required replacing a useRef request guard with a per-component memoized single-flight closure. Both were corrected before final verification.

Cold backend startup still took approximately six minutes on the Windows bind mount. Moving the development runtime to Linux-backed storage remains separate future work; no project directories or infrastructure were moved in this change.