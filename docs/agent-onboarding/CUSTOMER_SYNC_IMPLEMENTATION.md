> Current scope update (2026-09-16): the user authorized all-member local sync. See [Full customer sync](FULL_CUSTOMER_SYNC.md). Earlier pilot limits and whole-contact payment holds below describe the previous rollout stage.

# Local customer sync: implementation and handover

Implementation started 2026-09-15 following the user's explicit approval. This document supersedes the earlier plan's documentation-only restriction. The source backend remains unchanged. Production deployment and marketing delivery are outside this implementation.

MCP follow-up: see [vsmcp verification and adapter](VSMCP_SYNC_VERIFICATION.md) for the new local stdio reader and the timezone correction found during real-source checks. The local source mode now selects MCP snapshots. Earlier direct-SQL timestamp verification below is historical: DATETIME was interpreted using the MySQL India session, whereas the source application configuration/helper uses Europe/London. Existing contact dates have not been rewritten by this read-only verification. Current payment holds and member pilot limits remain in effect.

## Registration extension — 2026-09-15

The user approved **immediate** inclusion of incomplete registrations and inclusion of historical attempts (the reply "yes" was interpreted and stated as all history). The source reader now includes `member_temp` (web) and `member_user_temp` (app) in the same read-only transaction. All five source tables must be InnoDB. Passwords, order tokens, device UUIDs and payment payloads are never selected.

- **Tried Register** is the fourteenth managed group and saved People view. It means registration is incomplete, not that a provider declined payment. No waiting period or new checkout instrumentation is added.
- Attempts are deduplicated by trimmed, case-normalized email. Different usernames for the same email, username collisions with members, unknown app platforms and invalid dates are held for review. Existing member emails, including deleted members, exclude old attempts from new prospect creation.
- Temporary contacts have a null Member ID. Their source identity is a unique `Source Registration Key` (SHA-256 of normalized email), backed by durable mappings with a username hash. Reports use `web:<id>` / `app:<id>` references, never pretend these IDs are Member IDs.
- The built-in **Registration Date** custom field maps source `date_added` on every eligible sync. Repeated attempts use the earliest known `date_added`. On conversion it changes to `member.date_added`; the original CRM creation timestamp is preserved. Invalid/missing dates are review exceptions, not replaced with import time.
- When email and username match a connector-owned pending contact, registration promotes that same contact to its Member ID and removes Tried Register. Payment-review cases promote identity/date but use Needs Review with platform groups only; they do not assert paid entitlement. Manually created contacts are never automatically merged. Conflicting identities require review.
- Temporary tables have no phone field. Sync imports name/email/date and platform without clearing CRM phone/address enrichment or inventing verification/account-status values. App `google` attempts use Android without implying a paid Google subscription.
- `writeRegistrations` is an optional server-only boolean, false when absent. When enabled, all eligible historical/new attempts are in scope, as are later updates to contacts originally imported this way. The existing member pilot list still applies to other members.
- The existing per-run change limit also bounds registration writes. Further candidates receive `BATCH_LIMIT_RUN_SYNC_AGAIN`; run **Sync changes** again (or resume the five-minute schedule) to continue. Previously imported unchanged contacts do not consume the next batch. Retry always rechecks temporary sources, independently of member retry IDs. Source temp-row disappearance alone never deletes a CRM contact.
- Setup appends missing group options while preserving existing option IDs/custom options, creates the unique registration identity field, and adds Registration Date to managed group views.

Verification: 37 tests across four suites passed after this extension, covering deduplication, immediate/history inclusion, stale attempts, conversion, date updates, payment-review conversion, identity conflicts, exact timestamp concurrency, and existing member behavior. Direct server/frontend type checks and scoped lint passed; formatting and `git diff --check` passed. Incremental compilation used the existing ignored Nest-SWC helper.

Source snapshot: 1,730 temporary rows produce 567 distinct non-member emails; 365 pass source checks and 202 are held. Destination preview adds two review cases, yielding 363 proposed imports and 204 review cases. Setup created Registration Date and the unique Source Registration Key, appended Tried Register, and repeated successfully with exactly fourteen group options.

The first write exposed an existing optimistic-concurrency defect: PostgreSQL `updatedAt` had microseconds, while JavaScript Date discarded them. This blocked the pilot Member 144 date update. Reconciliation now reads the exact text timestamp and the entity in one query, retaining the exact database version in the update predicate. The batch and its automatic retries imported 27 unique registration contacts, all with Registration Date and null Member ID. The configured change limit is per processing attempt; automatic retries can advance additional registration batches. Automatic scheduling remains paused. Backup: ignored `.devenv/backups/customer-sync-before-registrations.dump`.

Final post-fix runtime verification: backend health 200; Member 144 updated successfully with `registrationDate = 2020-06-17T09:27:18.000Z`, then returned Unchanged. A fresh full preview returned 27 unchanged registrations, 336 proposed registrations and 204 registration review cases, with no contact writes or duplicate identities. All 27 imported registration contacts have non-null Registration Date and null Member ID. Browser verification showed the updated Sync Management screen with all historical registrations enabled, limit 10 and automatic scheduling paused. Conversion was verified with isolated tests, not by changing source registration/payment records. The earlier implementation/verification record below describes the original thirteen-group pilot and is retained as history.

## Entry points

Registration UI verification: Contacts/Peoples > Tried Register displays 27 contacts and a visible Registration Date column. The browser was left on that saved view (`viewId=96c78b02-fe88-535b-bdf3-4450c5997899`). To continue importing eligible historical attempts, use Sync Management > Sync changes; automatic scheduling remains paused.

- CRM: Settings > Sync Management (`/settings/customer-sync`).
- Backend: authenticated `/app/customer-sync` controller in `packages/twenty-server/src/modules/customer-sync/`.
- Source: fixed narrow SELECT queries against `member`, `orders`, and `membership_subscription`. The latter supplies identity linkage only; `orders` supplies payment state.
- Destination: existing People object and existing member fields, plus nine new built-in custom fields. `Customer Groups` is a multi-select, and thirteen saved views filter that field.
- Source signup time is inserted as `createdAt` through Twenty's workspace repository on first creation; existing CRM creation timestamps are preserved.

## Safety and ownership

The connector is deliberately restricted to a configured local HTTP destination and one workspace. It refuses production NODE_ENV. The browser cannot supply a source connection, destination, workspace override, or service identity.

Read, initialize, run, retry, and schedule operations require a current workspace user with WORKSPACE, DATA_MODEL, and WORKSPACE_MEMBERS permissions. The same checks run again for the initiating user and the configured service user before background processing. Connector configuration is server-only, not returned to the browser or placed in the instance configuration API.

Contact writes use Twenty's workspace repository with `shouldSkipEventEmission: true`. This suppresses workflow triggers, outgoing webhooks, and timeline event emission for these writes. No email/SMS send, consent assumption, source update, or hard contact deletion is implemented.

The source connection opens an InnoDB repeatable-read, read-only transaction. All three source tables must be present and transactional. A failed/incomplete source read fails the run; it is never converted into an empty customer/payment population.

## Implemented rules

- Member ID is the permanent source identity. Setup enables the built-in unique constraint on the existing Member ID field. An existing matching Member ID is reused. Duplicate IDs, conflicting mappings, trashed contacts, and existing primary-email contacts without this Member ID are held for review. There is no automatic email-based merge.
- Reserved destination IDs are deterministic UUIDs scoped to the workspace and source Member ID. PostgreSQL-backed identity mappings survive retries. Confirmed mappings pointing to missing contacts are not recreated.
- Source account status 1 is active, 0 inactive, -1 source-deleted. Deleted members are skipped on first import. Previously mapped contacts are marked Source Deleted and retain CRM history.
- Blank device is Web; apple is Apple; android is Android; google adds Google Payment Subscriber without asserting a physical Android device or active payment.
- Future current-subscription expiry means Paid, including cancellation/failure. Cancelled/Failed groups overlap Paid until expiry. A blank PayPal cancellation expiry uses the preceding valid expiry from the same subscription.
- Complimentary access uses `is_free_access` and the inclusive end date; it is separate from Paid. With no current entitlement, a member with prior dated entitlement is Lapsed; otherwise Free. These are implemented presentation defaults, not claims about product free-tier eligibility.
- Multiple subscription streams are evaluated separately. Provider/state summaries list distinct values instead of selecting an arbitrary provider.
- Refund/revocation, decreasing expiry, uncertain payment identity, missing subscription orders, and unverified payment streams remain review exceptions. No arbitrary historical maximum is used to grant entitlement.
- Customer Groups are reconciled as a set. Obsolete managed values are removed, current values are retained once, and additional custom option values are preserved. Other CRM fields, ownership, relations, additional emails, and additional phones are preserved.
- Unchanged checks skip contact updates, including Last Synced At. Updates use the observed `updatedAt` as an optimistic concurrency condition. A successful write is read back before its mapping is confirmed. Mappings retain the rule version and a SHA-256 source/classification fingerprint, never the raw payment payload.
- Phone values require a valid international number for this pilot. Ambiguous local numbers are held for correction, with no invented country code. Empty telephone is valid.

## Payment verification boundary

### Source access helper review — superseded as the sync specification

On 2026-09-15 the user supplied `check_subscription()` as the reference for subscription access. Verified in local CI3 `application/helpers/functions_helper.php:153`, with dependencies in `application/models/user/User_model.php:483` and `:511`:

- Valid complimentary access returns `subscribed` before membership lookup. This denotes access, not proof of payment; retain the separate Complimentary group.
- `get_user_membership()` selects the highest `membership_subscription_id` matching the first twelve username characters. This differs from the connector's current multi-stream classification. Prefix collisions must remain explicit review cases rather than silently copying an ambiguous match.
- No membership returns `unsubscribed`.
- Apple and Google select the highest `order_id` for that membership's subscription reference. The implemented query does not additionally restrict username or provider. `is_next_payment_valid()` rejects null/zero dates and compares the full timestamp with `>= time()`.
- PayPal calls the live OAuth/subscription APIs. The argument `false` controls the returned shape only; it does not suppress network calls. This differs from the connector's current saved-order expiry and approved cancellation fallback.
- The PayPal helper truncates `next_billing_time` to a calendar date before comparing with current time, potentially ending access earlier on the billing day. Missing responses/dates and unhandled statuses do not have a reliable total boolean result. Do not copy those failure paths into CRM or downgrade access on an API outage.
- This helper supplies access status only. Separate order-event logic is still needed for Cancelled and Payment Failed groups, and Tried Register remains based on temporary registrations without a member match.

Resolved by the user's subsequent explicit instruction: disregard the supplied function as the sync specification and retain the implemented orders-based rules for all providers. Use the latest order by `order_id` within each matched subscription, future expiry for Paid, overlapping cancellation/failure until expiry, the approved previous-valid-expiry fallback for a blank PayPal cancellation date within the same subscription, Lapsed for expired historical entitlement, Complimentary for valid free access, and Free when there is no current or previous entitlement. No live PayPal integration or latest-membership-only replacement is required. The helper findings above are historical comparison notes, not instructions to change this behavior. This decision does not remove payment identity/environment review holds or expand the existing member write allowlist.

The source orders mix historical/test and live data and do not have a reliable environment flag or universal event timestamp. Therefore payment stream hashes must be explicitly verified before writes for those members are eligible. Until then, preview exposes candidate groups with `PAYMENT_STREAM_REQUIRES_REVIEW`; it must not be presented as a verified count of live paid subscribers.

`verifiedSubscriptionHashes` contains SHA-256 of `lowercase-provider:exact-subscription-reference`. Raw Apple/Google purchase references never enter run history. Verification must establish the source owner, live environment, current event ordering, and deployed writer behavior. Merely adding a hash to clear an exception is not verification. Refund/revocation and ordering exceptions remain blocked even for verified hashes.

## Runs, recovery, and scheduling

BullMQ uses the existing Redis connection. PostgreSQL `core.keyValuePair`, scoped by workspace and the `customer-sync:` prefix, stores run reports, mappings, pause state, and actor audit. No new core database entity or hand-written migration is introduced; the built-in metadata API applies the required People columns and unique index.

Only one active request per configured workspace is queued. PostgreSQL advisory locks serialize reconciliation and setup across processes. This is stronger than per-member serialization for the local pilot. Queue recovery rechecks source and destination, rather than replaying a stale preview.

Preview is read-only for source and CRM customer data; it persists an operational run report. Full and incremental modes both obtain a complete narrow snapshot, compare desired/current values, and skip unchanged contacts. This deliberately covers edits to existing orders and expiry without depending on a nonexistent order update watermark. No webhook/outbox integration is installed in CI3.

Automatic reconciliation checks every five minutes when explicitly resumed. Pause prevents the next automatic run from being enqueued; work already in progress finishes. Manual operations remain available while paused. The schedule is paused by default. The first version retains the latest twenty run reports; identity mappings and the retry-member backlog are retained separately. Failed jobs retry up to three attempts with exponential backoff, rereading the source. Manual retry revisits unresolved members and can repeat a failed full source read.

Writes require membership in `writeMemberIds` and are bounded by `maximumUpdatesPerRun` (maximum 100). Full reconciliation does not override the pilot audience. A run with review/failed members is completed-with-errors. Group counts can overlap and must never be summed as unique customers.

## Configuration

Set `CUSTOMER_SYNC_CONFIG_FILE` to an ignored, server-readable JSON file. Local setup uses `.devenv/customer-sync.json`, loaded by `.devenv/start.sh`. Do not commit it, show its contents in chat, or include it in a public support bundle.

Required keys (values intentionally omitted):

```text
workspaceId
serviceUserId
targetUrl
source.host
source.port
source.user
source.password
source.database
sourceDateOffset
writeMemberIds[]
verifiedSubscriptionHashes[]
maximumUpdatesPerRun
```

The source session reports system timezone Asia/Calcutta. SQL UNIX_TIMESTAMP converts source timestamps using that session. `sourceDateOffset` controls the inclusive complimentary-access date boundary; local configuration uses +05:30. Revalidate the deployed PHP/database timezone before any live rollout. A separate SELECT-only database principal is recommended for future deployment; this implementation does not change database grants.

## Operator sequence

1. Start the existing local development stack with the connector configuration available to the server.
2. Open Settings > Sync Management and prepare custom fields/views. Setup reuses matching fields, validates types and group option values, and does not import contacts.
3. Preview. Review outcome counts, unmatched-order count, and member-specific exceptions. No payment-active totals are final while payment verification is incomplete.
4. Enable only inspected members in the server-side pilot allowlist. Keep automatic sync paused during initial verification.
5. Sync one member. Re-run it and confirm Unchanged, one contact, no duplicate groups, and preserved source signup time. Check the saved group views.
6. Resolve exceptions from source evidence, then expand the audience in small batches. Do not change business rules or bypass review holds to make a bulk import pass.
7. Resume scheduled reconciliation only when the pilot is validated. Pause before changing identity/payment rules. Correct source or mappings and reconcile affected IDs; do not restore an entire CRM database over unrelated work.

## Verification record — 2026-09-15

The local module is running at [Sync Management](http://localhost:3101/settings/customer-sync). Automated reconciliation remains paused. The server-side write allowlist contains **Member ID 144 only**, which is the verified pilot; a full run does not import other members until that allowlist is deliberately expanded.

| Check | Verified result |
|---|---|
| Complete source read | 1,927 members, 25,571 orders, 3,169 identity subscription rows; all three tables InnoDB |
| Full preview | 234 proposed creations, 159 source-deleted skips, 1,534 review exceptions; no contact writes |
| Unmatched source orders | 2,738 rows; this is a global snapshot count, not a per-member count |
| Metadata setup | Nine new fields, thirteen group options, thirteen new saved views; sixteen People views including the three pre-existing ones |
| Setup repeated | Still sixteen views; no duplicate views/options created |
| First pilot sync | One new contact, Member ID 144, with Complimentary User and Web User |
| Repeat pilot sync | Unchanged; same CRM ID, exactly one matching contact, unique group entries, unchanged Last Synced At |
| Original signup date | Imported as 2020-06-17T09:27:18.000Z using source UNIX_TIMESTAMP, rather than import time |
| Overlapping saved groups | Both Web and Complimentary filters match the same pilot contact |
| Duplicate run requests | Second active request returned the same run ID with coalesced=true |
| Authorization | Unauthenticated HTTP 403; invalid Member ID HTTP 400; cross-workspace/non-member/missing-permission unit cases pass |
| Simulated unavailable source | Failed run, zero members processed; contact count, groups, and Last Synced At unchanged; original connection restored in a finally block |
| Recovery retry | Re-read all 1,927 members; one unchanged pilot contact, 392 skips, 1,534 review exceptions, no additional imports |
| Browser | Settings navigation and screen rendered; single-member action submitted successfully; run history and results visible |
| Existing work preserved | Original person and company COPY rows exactly match the pre-pilot backup; source CI3 Git status unchanged |
| Durable state | Confirmed identity includes a 64-character source fingerprint; 1,534 review IDs remain in the retry backlog independently of run-history retention |

Review reasons can overlap. The recovery report includes 1,488 payment streams needing verification, 179 members with differing subscription states, 79 decreasing-expiry/event-order exceptions, 43 ambiguous payment-owner cases, 11 refund/revocation cases, 7 unmatched username cases, 6 subscriptions without matched orders, 5 phone-normalization cases, and 3 unknown payment-status cases. These are exception occurrences per member, not distinct customer totals or validated subscriber counts.

Commands executed inside the existing Docker app:

```text
yarn workspace twenty-server add mysql2@3.15.3 --mode=skip-build
nx build twenty-shared --skip-nx-cache
nx build twenty-oxlint-rules --skip-nx-cache
cd packages/twenty-server && nest build --path ./tsconfig.build.json
tsgo -p packages/twenty-server/tsconfig.json --noEmit
tsgo -p packages/twenty-front/tsconfig.json --noEmit
jest --config packages/twenty-server/jest.config.mjs --runInBand packages/twenty-server/src/modules/customer-sync
cd packages/twenty-server && oxlint --type-aware -c .oxlintrc.json src/modules/customer-sync src/app.module.ts
cd packages/twenty-front && oxlint --type-aware -c .oxlintrc.json src/pages/settings/customer-sync/SettingsCustomerSync.tsx src/modules/app/components/SettingsRoutes.tsx src/modules/settings/hooks/useSettingsNavigationItems.tsx
```

The focused suite has **27 passing tests across three suites**. Direct frontend/server type checks passed; both builds passed; scoped frontend/backend lint and formatting checks passed. The local runtime was incrementally recompiled with `.devenv/build-customer-sync.cjs`, using Nest's SWC module/decorator/path settings. Normal builds should continue to use the documented Nest command.

The MySQL reader adds `mysql2` and updates the lockfile. Yarn reported existing peer-dependency warnings; no unrelated dependency upgrades were performed. Initial lint found the custom plugin unbuilt, then flagged the missing custom-permission marker and CSS property order; these were fixed. Startup identified a missing WorkspaceCacheStorageModule import for JwtAuthGuard; it was added, and backend health now returns 200. Cold Windows bind-mount build/startup was slow. A temporary Linux copy of dist was prepared for diagnosis but was not used by the running app.

Ignored backups exist at `.devenv/backups/customer-sync-before-pilot.dump` (workspace before setup) and `.devenv/backups/customer-sync-ready-pilot.dump` (full local database after setup and before the first import). Do not publish these files; they contain private CRM data. Do not restore the full backup as a routine sync rollback.

The source CI3 repository was not modified. Existing CRM company/contact records and all prior uncommitted code/documentation changes were preserved.

## Remaining work beyond this local version

Verify live payment environment/event ordering, then validate representative paid/failure/cancelled/recovery records. Production requires an explicit rollout, credentials/grants review, queue persistence/monitoring review, and a deployed-source parity check. Source webhook outbox integration, advanced scheduling, checkout tracking, profile completion, campaigns, and email/SMS sending are not implemented here.
