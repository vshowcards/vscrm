# Full local customer sync — 2026-09-16

Subsequent user request: [test-account exclusions](TEST_ACCOUNT_SYNC_FILTER.md) now skip matching members and registration candidates in future runs. Historical import totals below include existing test contacts; these have not been deleted.

The user authorized removing the pilot restriction and importing the complete customer audience into the local CRM. This supersedes earlier instructions limiting imports to Member 144. It does not authorize production deployment or email/SMS delivery.

## Current behavior

- `writeAllMembers: true` enables all current and future source members; `writeMemberIds` remains available for deployments using a selected audience.
- `writeRegistrations: true` includes all eligible historical and new incomplete registrations.
- `maximumUpdatesPerRun: 5000` accommodates the current dataset. The supported ceiling is 10,000. If the dataset exceeds the configured limit, remaining changes are reported as `BATCH_LIMIT_RUN_SYNC_AGAIN`; subsequent runs continue without duplicates. The old pilot-wide preflight failure has been removed.
- `importPaymentReviewContacts: true` allows member contact details to import when only payment classification is uncertain. Such contacts have Membership State and Payment State **Needs Review**, with no asserted payment provider, payment dates, or Paid/Free/Lapsed/Cancelled/Failed groups. Known platform and inactive-account groups remain. The Google Payment Subscriber marker is retained only when directly supplied by the member's `device_type = google`.
- Payment issues remain visible in run reports, including for unchanged contacts. These contacts can later be reclassified when evidence resolves the issue. Subscription hashes are not automatically marked verified.
- Identity conflicts, invalid source identity/date/phone, unknown account values, and ambiguous temporary registrations remain review exceptions. Source-deleted members are skipped on initial import; existing CRM history is preserved.
- Built-in custom fields and multi-select groups remain the destination. Repeated syncs update existing mapped contacts and reconcile managed groups without duplicates, preserving unrelated groups and CRM history.
- Source access remains read-only through MCP snapshots. No source tables, webhook behavior, or provider subscriptions are changed.
- Automatic scheduling remains paused; manual full sync is enabled.

## Operator steps

Open Settings → Sync Management. Confirm **Member sync scope: All members**, run Preview if desired, then Full reconciliation or Sync changes. Both read a consistent full source snapshot and apply the same classification and matching rules. Review the run report for records needing correction; a completed-with-errors report can include successfully imported contacts whose payment classification still needs review.

## Recovery and validation

Before the first full import, the local PostgreSQL database was backed up to the ignored `.devenv/backups/customer-sync-before-full-20260916.dump`. The previous private configuration is in `.devenv/customer-sync-before-full.json`. Both are private and must not be published. Do not restore the whole database over newer CRM work as a routine rollback.

Regression coverage includes all-member scope, repeated-run idempotence, payment-review contact import without payment claims, and retained source/destination identity validation. Runtime import totals and final verification are recorded below after execution.

Checks passed before import:

- Focused Jest suite: 48 tests across five suites.
- `tsgo -p packages/twenty-server/tsconfig.json --noEmit` and the corresponding frontend command.
- Scoped type-aware oxlint for the sync module and Sync Management page.
- Scoped `oxfmt --check` and `git diff --check`.
- Incremental compilation of 13 local backend files using the existing Nest SWC settings.
## Verified full import

Local run `23613675-bfc2-4e4c-9a0c-c5d3b6752050` completed with review exceptions and no top-level or contact-write failures:

| Result | Members | Incomplete registrations |
|---|---:|---:|
| Created | 1,757 | 336 |
| Updated | 1 | 0 |
| Unchanged | 0 | 27 |
| Source-deleted initial import skipped | 159 | 0 |
| Not imported: review required | 10 | 204 |

Post-import database verification: **2,121 active contacts**, comprising **1,758 member contacts** and **363 registration contacts**. All synced contacts have Registration Date. Duplicate Member IDs, registration keys, and group entries: **zero**. The original company and person rows match their pre-run fingerprints exactly, including their existing deletion state.

Of the imported members, **1,524 have payment classification Needs Review**. They are present as contacts; their payment membership is not verified. The remaining classified members are 78 Free and 156 Complimentary. This import must not be described as a completed validation of all payment groups.

The 214 candidates not imported comprise three members with invalid identity, seven members with invalid/unqualified phone values, two registration candidates with invalid identity, and 202 registration identity conflicts. These are operational exceptions, not a remaining audience allowlist. Source-deleted accounts remain excluded under the approved deletion policy.

The full report is available in Sync Management run history; an ignored private local copy is `.devenv/customer-full-full-results.json`. Source records were not modified. Automatic reconciliation remains paused. No production deployment or email/SMS delivery occurred.

A fresh post-import preview returned all 1,758 member contacts and 363 registration contacts Unchanged, with zero proposed creations or updates. Review exceptions and the 159 source-deleted skips remained unchanged. This confirms convergence for the current source snapshot.

## User-requested People reset — 2026-09-16

After enabling test-account exclusions, the user explicitly requested deleting all People so they could resync. The local CRM database was backed up to ignored `.devenv/backups/people-before-clear-20260916.dump`. With scheduling paused and no active run, an advisory-locked transaction deleted all 2,122 People rows (including one trashed row), their three dependent timeline entries via existing foreign keys, and 2,123 sync state rows (member/registration mappings, retry backlog and stale active-run pointer). Companies were fingerprint-verified unchanged. Workspace users, custom fields, saved group views, configuration and historical run reports remain intact. Source vShowcards data was not changed.

Post-transaction counts: zero People and zero member/registration mappings. This intentionally supersedes the historical imported totals above. No real resync was started; the user will run it from Sync Management. The test-account filter remains enabled.