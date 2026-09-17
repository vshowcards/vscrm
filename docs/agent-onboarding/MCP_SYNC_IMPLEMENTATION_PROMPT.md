# Implementation prompt: vShowcards customer-sync MCP tools

Copy this document to the coding agent working in the vShowcards MCP repository.

## Your task

Inspect the existing MCP repository, then implement typed, authenticated, read-only tools that expose the vShowcards MySQL data needed by our CRM customer sync. Deliver working code, tests, tool schemas, and setup/handover documentation. Follow the repository's existing language, MCP SDK, configuration, authentication, database adapter and test conventions. Do not assume its stack from this prompt.

This is an MCP implementation task. Do not modify the vShowcards application, deploy anything, change database grants/schema, run migrations, or modify the CRM as part of it. Ask before production/infrastructure actions. Preserve existing uncommitted work. Do not print credentials or customer records in logs, screenshots, test output, or the final report. Use synthetic fixtures in tests.

Start with Git status, applicable AGENTS.md instructions, manifests, existing tool registration, authentication, database access and tests. Reuse existing infrastructure where suitable. Ask only about material ambiguities that repository inspection cannot resolve; continue independent work while awaiting answers.

## Context and boundaries

- vShowcards is the source of truth; destination is our local Twenty-based CRM, not GoHighLevel.
- The source application uses CodeIgniter 3 and MySQL. Its locally reviewed path is `D:\xampp\htdocs\vshowcards.com-newsite-1`; use it only if accessible and relevant.
- CRM checkout: `D:\Aimsoft-Projects\vscrm`. Reference implementation: `packages/twenty-server/src/modules/customer-sync/`. This path is context, not an instruction to edit that repository.
- The CRM already implements grouping, contact upsert, identity mappings, retries, dry runs and Sync Management. It currently reads MySQL directly. Building these MCP tools does not automatically switch the CRM to MCP; report the separate adapter work required.
- No email/SMS, marketing delivery, profile completion, new checkout instrumentation, or live PayPal/Apple/Google API calls.
- Tools expose source facts and identity evidence. The CRM owns classification, group reconciliation and destination writes. Do not introduce a second, conflicting classification engine.
- Existing CRM pilot limits and payment-review holds must remain intact. These tools must not silently claim a full production import is approved or verified.

## Approved business rules the data must support

The user explicitly chose saved-order logic and withdrew a request to copy the PHP `check_subscription()` helper.

1. Evaluate the latest `order_id` **per matched provider + subscription**, not just the last order for a username, and not only the latest membership.
2. Future `next_payment_date` means Paid. Cancellation/payment failure may overlap Paid until expiry.
3. A PayPal cancellation with a blank/zero expiry may use the preceding valid expiry for the **same subscription**. Supply sufficient history for this; do not take a maximum across unrelated subscriptions.
4. Expired historical entitlement is Lapsed. Valid `is_free_access = 1` and inclusive `free_access_till_date` is Complimentary. No current or previous entitlement is Free. Complimentary is not proof of payment.
5. Refund/revocation, conflicting ownership, uncertain event ordering and unverified live/test environment remain review cases. Never invent environment or ownership evidence to clear a hold.
6. Member status: `1` active, `0` inactive, `-1` source-deleted. Include deleted source members in reads so CRM can preserve history and mark previously synced contacts. Do not hard-delete them or omit them silently.
7. Member device mapping: null/blank/whitespace = Web; `apple` = Apple; `android` = Android; `google` is a Google payment subscriber marker, not proof of current paid access or of a physical Android device. Preserve raw values.
8. Incomplete registrations come from `member_temp` (web) and **`member_user_temp`** (app; this is the correct spelling). Include all history immediately, with no waiting period. A row proves an attempted registration, not a provider-declined payment.
9. The CRM deduplicates attempts using normalized email with identity checks. Old attempts belonging to members must not put them back into Tried Register. On a confidently matched conversion, update the same CRM contact and remove Tried Register. MCP must supply evidence, not perform CRM merges.
10. `date_added` supplies the CRM Registration Date in all three customer tables. Repeated attempts use the earliest known attempt date; conversion uses `member.date_added` while preserving CRM creation history. Expose individual source rows and timestamps so this remains reproducible.

## Source tables and minimal field allowlists

Verify actual column names, types, primary keys, engine and time semantics before coding. The following were inspected in the connected source. Do not use `SELECT *`.

| Table | Fields needed |
|---|---|
| `member` | `member_id`, `username`, `full_name`, `email`, `telephone`, `address`, `gender`, `gender_other`, `city`, `country`, `user_type`, `isverify`, `status`, `is_free_access`, `free_access_till_date`, `device_type`, `date_added` |
| `member_temp` | `id`, `username`, `fullname`, `email`, `date_added`, `date_updated` |
| `member_user_temp` | `id`, `username`, `full_name`, `email`, `device_type`, `date_added`, `date_updated` |
| `membership_subscription` | `membership_subscription_id` (verify), `username`, `subscription_id`, `payment_gateway_type` |
| `orders` | `order_id`, `username`, `payment_gateway_type`, `recurring_payment_id`, `txn_type`, `payment_type`, `payment_status`, `txn_profile_status`, `next_payment_date` |

Neither temporary table has a verified phone column. Return phone as unavailable, not fabricated. Do not return password columns, password hashes, `order_token`, device UUIDs, raw webhook payloads, credentials, or purchase/receipt tokens.

Payment references are used internally for exact linkage. Return a stable opaque `subscription_key` in tool responses instead of raw subscription/purchase references. To align with the existing CRM verification-hash convention, use SHA-256 of `lowercase-provider:exact-source-reference`, without changing reference case or trimming reference contents. Missing references produce null, not a fabricated key. Do not use this hash as authentication or as evidence of verified ownership/payment environment.

Explicitly document this response-contract difference from the CRM's current direct SQL reader, which consumes raw references internally. A future MCP adapter must use the returned key consistently and must not hash it again. Include compatibility tests using synthetic references.

## Shared tool response contract

Use a versioned structured response, validated by schemas. Reuse native MCP structured-content/error conventions where supported by the installed SDK.

For successful list responses provide:

```json
{
  "schema_version": "1",
  "read_at": "2026-09-15T00:00:00Z",
  "snapshot_id": "opaque-id-if-applicable",
  "consistency": "snapshot",
  "source_timezone": "verified-timezone",
  "items": [],
  "next_cursor": null,
  "complete": true
}
```

- The example is a contract illustration, not real source data. `complete` means that the requested dataset is exhausted, not that other datasets were read or the entire sync is finished.
- Distinguish independent/live paginated reads from immutable snapshot reads using `consistency`. Do not claim independent calls share a transaction.
- Preserve source IDs. Scope temporary IDs by table/source, e.g. `web:123` and `app:123`. They are not Member IDs.
- Return source field names consistently; normalize web `fullname` to `full_name`, retaining its source table. Retain raw status/device/event values.
- Return relevant datetimes as ISO UTC plus a validity marker (`valid`, `null`, `zero`, `invalid`). For compatibility, include `joined_seconds` and `next_seconds` where applicable. Preserve whether a null timestamp came from a null, zero or invalid source value.
- Date-only complimentary expiry remains `YYYY-MM-DD`; do not silently reinterpret it as a UTC midnight timestamp.
- Verify the MySQL session timezone and the source application's timezone. Do not assume the MCP host timezone. Report a mismatch or an unresolved timezone explicitly.
- Default page size 100, maximum 500, unless repository transport limits require a smaller documented bound. Validate all limits and IDs. Use deterministic keyset pagination, not offset pagination.
- Treat cursors as opaque, validate their shape and bind them to tool, filters, schema version and snapshot where relevant. Reject mismatched, malformed and expired cursors.
- Errors must have stable codes and retryability without raw SQL, connection strings, tokens or customer values. Examples: `INVALID_ARGUMENT`, `NOT_FOUND`, `SOURCE_UNAVAILABLE`, `SNAPSHOT_EXPIRED`, `SNAPSHOT_TOO_LARGE`, `UNSUPPORTED_CHANGE_TRACKING`.
- A failed read is an error, never a successful empty population. A genuine empty result must be distinguishable and accurately reported.

## Implement these tools

### 1. `get_sync_snapshot` — priority

Suggested inputs: `{ snapshot_id?, dataset?, cursor?, limit? }`, where dataset is one of `members`, `registrations`, `subscriptions`, `orders`.

The first call creates an immutable, complete narrow snapshot of all five tables in one InnoDB repeatable-read, read-only transaction. Commit/close promptly after materialization. Return an opaque snapshot ID, capture time, expiry, per-dataset row counts, and the first requested page (default dataset: members). Subsequent calls page through that exact snapshot.

Use an existing private bounded cache if available. Otherwise a bounded in-process cache is acceptable for the first version; disclose restart expiry and multi-instance limitations. Do not add Redis, cloud storage, schema migrations or infrastructure solely for this feature. Never hold a database transaction open while waiting for future MCP calls. Do not spill personal data into public files or logs.

Require all five tables to be transactional. Fail the entire capture on missing tables, size/time limits or partial reads. Enforce configurable row/byte, concurrency and TTL bounds; expire snapshots and clean up on success, failure and cancellation. Scope cache access to the authorized caller/source. An opaque ID is not a substitute for authorization.

Do not silently fall back to an inconsistent live scan if snapshot capture fails. If the repository cannot support bounded materialization safely, explain the concrete blocker before choosing an alternative contract.

### 2. `list_members`

Inputs: `{ cursor?, limit?, snapshot_id? }`. Return allowlisted member fields ordered by `member_id` ascending. Include inactive and source-deleted members. Snapshot mode should use the shared snapshot cache; live mode must disclose weaker consistency.

### 3. `get_member` — priority

Inputs: `{ member_id, snapshot_id? }`. Require a positive integer within the source ID range. Return one allowlisted member record or explicit `NOT_FOUND`. Do not accept an arbitrary SQL predicate.

### 4. `list_registration_attempts`

Inputs: `{ source?: "web" | "app" | "all", cursor?, limit?, snapshot_id? }`.

Return raw individual attempts from both temporary tables with source, source ID, username, name, email, raw device value and timestamps. Label web origin from the table. Do not apply a one-hour delay, historical cutoff, payment-failure assumption, or lossy server-side deduplication. Order by a documented stable tuple such as source + ID.

### 5. `get_member_subscriptions`

Inputs: `{ member_id, cursor?, limit?, snapshot_id? }`.

Return all candidate subscriptions with provider, opaque subscription key, source row ID and ownership evidence. Do not select only the latest membership. Prefer exact usernames; a twelve-character truncated username can be used only as an explicitly identified candidate match when unique. Report collisions and conflicting ownership rather than choosing the first row.

### 6. `get_subscription_orders` — priority

Inputs: `{ payment_gateway_type, subscription_key, cursor?, limit?, snapshot_id? }`.

Validate the provider allowlist and opaque key. Resolve it internally and query by exact provider + subscription reference. Return orders by `order_id` descending, including the event/status fields and expiry validity. Support pagination through full relevant history, including the preceding valid PayPal cancellation expiry. Do not return only the last row or filter away refunds, failures, zero dates or cancellations.

Use bounded indexed lookups or a snapshot reference index; avoid unbounded full scans for each member. If suitable indexes are missing, report the concern without creating indexes on the source database.

### 7. `resolve_customer_identity`

Inputs: exactly one of `{ member_id }` or `{ registration_source, registration_id }`, plus optional `snapshot_id`.

Return `matched`, `unmatched` or `ambiguous`, candidate source IDs, matching basis, and stable review-reason codes. Use trimmed, case-normalized email for registration comparison, but preserve raw values in source records. Do not use fuzzy names or assume a shared twelve-character prefix proves identity. An email/username disagreement or multiple candidate members must be visible. Include deleted-member matches so old attempts do not resurrect them.

This tool provides evidence only: no source updates, CRM merge, group changes or auto-verification. Missing or malformed email is a review condition, not a universal deduplication key.

### 8. `get_sync_changes`

Inputs: `{ cursor?, limit? }` only after a genuine change-feed contract is established.

First inspect whether reliable tracking exists for inserts, updates, backfills and deletions across all five tables. Order IDs or `date_added` alone are not a change cursor. An `updated_at` column without deletion tracking is not a complete feed.

If no reliable feed exists, implement a clear `UNSUPPORTED_CHANGE_TRACKING` response and advertise `supports_changes: false` in health. Direct consumers to snapshots. Do not invent a watermark, silently miss updates, or add triggers/binlog infrastructure in this task. If a feed does exist, document cursor ordering, restart recovery, retention, tombstones and expired-cursor recovery, and test them.

### 9. `get_sync_health`

No credentials or connection details in its response. Return connectivity status, contract version, verified source timezone, required-table compatibility, supported tools, snapshot limits/TTL, and whether changes are supported. Expose only whether source environment is verified live/test/unknown; do not infer it from record contents. Keep health checks lightweight and authenticated under the existing policy.

## Security and operational requirements

- Register tools through existing MCP mechanisms with explicit input/output schemas and appropriate read-only annotations. An annotation alone is not an authorization or SQL safety control.
- Reuse existing authentication and caller/source scoping. Do not expose these customer-data tools anonymously or weaken existing tool permissions. No caller-supplied host/database/credentials or arbitrary identifiers.
- Use fixed SQL and parameter binding. Validate enum filters, numeric IDs, cursors and limits. Disable multi-statements where supported. Do not run PHP controllers/helpers as a read mechanism; they may send email or call payment APIs.
- Prefer an already provisioned SELECT-only database principal. Do not create grants/users. Enforce read-only transactions even when existing credentials are broader, and disclose that broader credentials remain a deployment consideration.
- Set bounded connection/query timeouts and concurrency; release connections on errors, cancellation and snapshot expiry. Avoid a query per order/member when a batched read/index can answer it.
- Logs may contain request IDs, timings, counts and sanitized error codes, not customer names/emails, payment references, passwords or raw tool payloads. Do not echo confidential source configuration in health or exceptions.
- Reuse dependencies where practical. Explain any necessary dependency addition, avoid unrelated upgrades, and preserve the lockfile except for deliberate required changes.

## Required acceptance tests

Use synthetic fixtures and the repository's existing test framework. Add isolated database integration tests when an existing disposable test database is available; never seed or change production to test this.

1. Each tool validates inputs and rejects injection-like arguments, arbitrary SQL, invalid providers/IDs, excessive limits and mismatched cursors.
2. Unauthorized callers cannot read customer data or another caller/source's snapshot.
3. Snapshot pages use one captured population despite later source inserts/updates/deletes. Expired/restarted/partial snapshots fail explicitly.
4. Null, zero, invalid and valid dates remain distinguishable; epoch/ISO conversion is correct for the verified source timezone, including date-only complimentary expiry.
5. Members marked inactive/deleted remain available; real empty results differ from query failures.
6. Repeated temporary registrations remain individually traceable; identical numeric IDs across the two tables do not collide; phone is not invented.
7. Identity cases cover exact match, unique truncated candidate, prefix collision, conflicting email/username, multiple members and a deleted-member match.
8. Subscription lookups isolate provider + reference; descending order pagination exposes latest cancellation plus prior valid expiry without mixing streams.
9. Opaque subscription keys match the existing SHA-256 convention and never expose raw purchase references in output/logs.
10. Secret/PII leakage tests cover error paths and logging; source responses contain only allowlisted fields.
11. Unsupported change tracking returns the explicit capability/error, not an incomplete pretend feed.
12. Existing tools still work, resources close on failure, and response sizes/concurrency stay bounded.

## Deliverables and completion report

- Implemented tool registrations, schemas and shared reader/snapshot/identity helpers.
- Passing focused tests, plus appropriate existing lint/type checks. Report exact commands and results; do not claim checks you did not run.
- A short operator README with configuration **names only**, synthetic examples for all tools, cursor/snapshot lifetime, error codes, source assumptions and known limitations.
- A sample synthetic workflow: capture snapshot, exhaust all four datasets, inspect a member and subscription history, and handle a review case.
- A handover mapping these responses to the CRM reader, identifying the opaque-reference adapter requirement and any unsupported change-feed capability.
- Summarize changed files, verified capabilities, unresolved issues and deployment prerequisites. Leave production deployment and the CRM's switch to MCP for a separate explicitly authorized task. Do not commit or push unless requested.

Implement the small practical version first. Do not stop at a design proposal when the repository provides enough information to build and test the tools.
