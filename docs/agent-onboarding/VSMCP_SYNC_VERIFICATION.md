> Current scope update (2026-09-16): the user authorized all-member local sync. See [Full customer sync](FULL_CUSTOMER_SYNC.md). Earlier pilot limits and whole-contact payment holds below describe the previous rollout stage.

# vsmcp sync-tool verification and CRM adapter

Date: 2026-09-15. Scope: local read-only source verification and CRM integration. No production deployment, source mutation, payment API calls, or marketing delivery.

## Findings

- The existing Codex `vsmcp` connection launches `src/server.js`, the legacy SQL/NL server. The nine sync tools live in the separate `src/sync-server.js` local stdio entry point. They were tested directly using the MCP SDK, not falsely claimed available through the legacy connection. Codex configuration was not changed.
- The MCP repository's existing 77 tests passed (`npm test`). Those tests use synthetic/inert sources; real source checks below were additional.
- Real tool discovery found all nine tools. Health verified all five tables as compatible InnoDB tables. No suitable provider/reference composite index was reported; no indexes were created. Source environment remains unknown, and payment verification holds remain necessary.
- `config.time_zone` is Europe/London. The inspected CI3 `get_current_datetime()` and `get_current_date()` helpers use that setting. MySQL session Asia/Calcutta is not a valid substitute for the application zone when interpreting DATETIME values. The initial Asia/Calcutta MCP configuration correctly failed with `SOURCE_TIMEZONE_UNVERIFIED`.
- The default 128 MiB materialization allowance failed with `SNAPSHOT_TOO_LARGE`. An isolated launch using 256 MiB passed without changing database schema, source data or the MCP repository's default limits.
- One real immutable snapshot was exhausted across all four datasets: 1,927 members, 1,730 registration rows, 3,169 subscriptions and 25,571 orders. Page counts matched the declared counts and cursors terminated.
- `list_members`, `get_member`, `list_registration_attempts`, `get_member_subscriptions`, `get_subscription_orders` and `resolve_customer_identity` returned valid structured results. Sample subscription history was descending by order ID. Member ID 0 and limit 501 were rejected as `INVALID_ARGUMENT`.
- `get_sync_changes` returned `UNSUPPORTED_CHANGE_TRACKING`, as intended. Full snapshot comparison remains the correct reconciliation mechanism; “Sync changes” is not a database change-feed consumer.
- Responses did not contain password, order-token, device-UUID or raw subscription/purchase-reference fields. No raw customer records were printed by the verification harness.

## CRM adapter

The CRM adds the already-tested MCP SDK version 1.25.2 and a local stdio snapshot reader. `sourceMode: mcp` selects it explicitly; failures never silently fall back to MySQL. The existing direct reader remains available for comparison and explicit configuration rollback.

The adapter launches a private child process per read, provides only required source/configuration environment variables, discards child stderr, uses bounded requests, and closes the transport on success/failure. It validates health, schema version, source timezone, immutable snapshot ID/read time, expiry, dataset/count consistency, cursor termination and unique source IDs before returning a population for reconciliation.

Opaque `subscription_key` values are used directly for matching and the existing subscription-verification hash list. They are not hashed again or converted into pretend raw references. The adapter preserves invalid payment-date evidence for review, retains source-deleted members and all registration rows, and preserves the existing member pilot limits, registration scope and event suppression.

MCP DATETIME values use Europe/London; MySQL TIMESTAMP values retain their UTC instant. Complimentary access compares the calendar date in the snapshot's named timezone, including daylight saving, instead of applying a fixed India offset. Historical provider writers may have used other timezone conventions; this verification does not establish universal historical payment timestamp provenance.

## Local launch configuration

Additional private CRM configuration names:

```text
sourceMode
mcp.entrypoint
mcp.sourceTimezone
mcp.timezoneVerified
mcp.maximumCacheBytes
```

The intended local values are the sync entry point under `/opt/vsmcp/src/`, Europe/London, and a 256 MiB cache. Existing source credentials remain private and are supplied to the child process; no credentials appear in this document. `timezoneVerified` records the inspected current configuration/helper semantics, not proof of every historical writer.

The development container needs read-only access to MCP source/package metadata and compatible installed dependencies. This is a local stdio setup, not a new public network service. Do not expose the local-stdio principal model over HTTP. A remote integration needs an authenticated transport and its own deployment authorization.

## Verification status

The CRM focused suite passed 45 tests across five suites. Direct server type checking, scoped lint, formatting and `git diff --check` passed. Two initial TypeScript errors (mixed numeric/string ID sets and stderr stream typing) were corrected. The adapter compiled with the existing Nest-SWC development helper. Yarn added the MCP SDK and its dependencies; existing monorepo peer warnings remain.

An actual adapter read inside the Docker app exhausted all four datasets. Comparing it with the old direct reader confirmed all 25,571 opaque order-reference keys match the old SHA-256 convention. All 1,927 member DATETIME values and 680 app-registration DATETIME values receive the named-zone interpretation; all 1,050 web-registration TIMESTAMP instants remain unchanged. This is a read-only comparison, not a bulk correction of CRM dates or proof of historical payment-date provenance.

Local configuration now selects MCP and supplies the sync server from read-only source/package mounts under `/opt/vsmcp`. The child uses the CRM container's installed dependencies. No network listener was added. A private configuration backup exists at ignored `.devenv/customer-sync-before-mcp.json`; it must not be shared because it contains credentials. The local app container was recreated to apply mounts; PostgreSQL/Redis volumes were preserved. Automated scheduling was verified paused with no active run before restart.

Final dashboard dry run completed through `vShowcards MCP (read-only snapshot)`. It reported 567 distinct registration candidates: 27 unchanged, 336 proposed creations and 204 review cases. Member 144 is a proposed update because its Registration Date has the corrected DATETIME interpretation. The run's `completed-with-errors` status denotes review cases; it had no top-level source error. A checksum of every People row before and after the preview matched, proving no contact data was changed by the run.

Backend health returned 200. Automatic reconciliation remains paused, the unrelated member pilot list still contains one member, and registration syncing remains enabled under the existing batch limit. To inspect proposed changes use Settings > Sync Management > Preview / Dry Run. Subsequent eligible write runs can apply the proposed date correction; no historical CRM dates were bulk-rewritten in this task. The source application and MCP implementation files were left unchanged.
