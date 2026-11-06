# Payment group verification — 2026-11-06

Production had zero Payment Active contacts because the sync relied on an empty manual subscription-hash allowlist. There were 1,479 contacts with membership/payment state Needs Review. Automatic source reconciliation was paused.

## Change

Rule version `2026-11-06.1` computes verified payment streams from the same MCP snapshot used for classification. It scopes references by provider, checks subscription and order ownership across the entire stream, and supplies the verified hashes separately for each member. A conflicting event invalidates earlier events too. Missing/unknown owners remain review exceptions. Legacy configuration hashes cannot bypass ownership checks. Expiry, cancellation/failure overlap, PayPal previous-expiry fallback, complimentary access, test filtering, source-deletion and contact identity checks are preserved.

The source backend confirms twelve-character username handling for app payment account lookups. Unique truncated candidates can be matched; colliding prefixes are never silently selected.

## Source access

The configured source database is on the developer PC, not directly reachable by production. The review uses an SSH reverse Unix socket and container-local proxy, with no public database listener or permanent SSH configuration changes. Original source configuration is backed up and restored after the manual reconciliation. Automatic source sync remains paused. Future production sync requires a persistent, authenticated source connection; this temporary tunnel is not an unattended sync service.

MCP captures source tables in a consistent, read-only snapshot. Source database writes, migrations, provider changes and email sending are outside this operation. The source has no trustworthy live/sandbox marker; classifications reflect the configured database, not independent PayPal/Apple/Google API verification.

## Validation and recovery

Ownership regression tests were first run against the previous implementation and failed. The complete backend build and all 90 tests across 10 sync suites passed before deployment. Focused strict TypeScript checking of the ownership matcher, classifier, types and regression tests also passed. The initial dependency-only test image could not resolve `twenty-shared/constants` for the authorization suite; the complete build supplies that dependency.

Full `tsgo -p packages/twenty-server/tsconfig.json --noEmit` remains blocked by the same existing build-environment issues documented in the previous SMTP deployment: missing `twenty-sdk/front-component-renderer/build` and missing declarations for `lodash.kebabcase`. No error was reported in the changed sync files. Tests ran with Docker network access disabled.

Private backup: `/opt/vscrm/backups/before-payment-review-20261106` contains the database dump, compose configuration, application environment and source configuration. Never publish those files. Runtime rollback uses the prior image `vscrm:268aedb0d1` and backed-up configuration; restoring the database wholesale could erase subsequent CRM work.

## Production reconciliation

- Image: `vscrm:payment-review-20261106-v2`; manifest `sha256:eb50b946437580b51cfb2282b42056cd3f01ec80afba501d92bb5420474e9f33`.
- Source snapshot: 1,927 members, 3,169 subscription rows, 25,571 orders and 1,730 retained registration attempts. Source access was read-only.
- Preview: `472ee28b-0894-45e5-8746-517bfde933c9`.
- Applied run: `59392a1a-7c7a-49ba-b8b0-7aee10674acb`, completed with review exceptions and no top-level/contact-write failures. It updated 1,090 contacts, left 942 unchanged, skipped 251 candidates (including source-deleted/test records), and retained 211 import/identity review candidates. No contacts were created.
- Production still has 2,034 active contacts and 1,703 distinct Member IDs across 1,703 member contacts; no duplicate Member IDs were introduced.
- Payment Needs Review decreased from 1,479 to 391 contacts. These imported payment-review contacts are distinct from the 211 candidates whose import/identity review blocks writing.

| Saved group | Count |
|---|---:|
| Paid User | 248 |
| Payment Active | 176 |
| Payment Cancelled | 498 |
| Payment Failed | 93 |
| Lapsed User | 732 |
| Free User | 153 |
| Complimentary User | 179 |

Groups overlap. The 391 remaining payment-review contacts include unresolved payment usernames (192), conflicting subscription states (126), decreasing expiry/event ordering (60), conflicting owners (43), refund/revocation (10), unknown payment status (2), and subscriptions without matched orders (2). Reasons overlap and should not be summed. Do not clear these by populating the legacy allowlist.

An ignored local CSV at `.devenv/sync-payment-review/payment-review-exceptions.csv` contains the 391 Member IDs, CRM links and reason codes, without names or email addresses. The full applied report is also available in Sync Management history.

Verification preview `4b47c4cd-8f7a-4e18-9c00-3de09de99341` returned 2,032 Unchanged contacts, 251 skipped candidates and the same 211 import/identity review candidates, with zero proposed creations/updates or failures. The existing ALL Members list remains at 2,034 members and 2,034 unique person IDs.

The original private source configuration was restored after reconciliation. Both container-local proxies and the temporary SSH tunnel were stopped; the Unix socket, proxy and temporary source snapshot were removed. Automatic source sync remains paused. A future manual/automatic source sync needs a working source connection; the production configuration still points to the developer-host database and does not constitute persistent connectivity.

The production homepage/health and server/worker state were checked after deployment. No campaign or email send was requested. Contact writes use the existing sync path with outbound automation suppression.
