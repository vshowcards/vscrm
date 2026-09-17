# vShowcards customer sync and overlapping groups

Payment rule decision resolved: the user explicitly chose the existing saved-orders classification and withdrew the request to follow `check_subscription()`. Keep the latest order per matched subscription and the approved expiry/cancellation/complimentary rules. No live PayPal lookup is required. Existing review holds and pilot write limits remain in effect; see the implementation handover for current behavior.

Registration extension approved: include **Tried Register** immediately for all historical and new incomplete registrations from `member_temp` and `member_user_temp`. Add **Registration Date** to People, synchronized from source `date_added`; promote the same contact on completed registration and remove Tried Register. See the registration extension in [implementation and handover](CUSTOMER_SYNC_IMPLEMENTATION.md) for deduplication, date, identity, batch and verification rules. This extends the earlier source scope without enabling emails/SMS or new checkout tracking.
Implementation approval: the user explicitly approved building the local module on 2026-09-15. The dated discovery-only restrictions below are historical. See [implementation and handover](CUSTOMER_SYNC_IMPLEMENTATION.md) for delivered behavior, pilot controls, verification, and remaining limitations.


Date: 2026-09-15. Status: local implementation approved; historical discovery and design follow.

Re-audit: 2026-09-15. Confirmed user rules remain authoritative. The local module has now been implemented with a restricted pilot and explicit review holds. See the implementation handover for resolved capabilities and remaining payment validation.

Source follow-up: [CI3 payment and membership review](SOURCE_PAYMENT_REVIEW.md), local `D:/xampp/htdocs/vshowcards.com-newsite-1`, branch `gitesh`, commit `2b5a85d`. Source location and the PayPal cancellation/deleted-member decisions are now resolved. Remaining technical verification is listed in that review.

## Confirmed scope

- Source of truth: the existing vShowcards website/app backend and its MySQL data.
- Destination: this vShowcards/Twenty CRM, using the existing People object displayed as Contacts/Peoples. GoHighLevel is not a destination.
- Profile completion is deferred completely from this phase.
- User confirms PayPal, Apple, and Google webhooks save payment events into `orders`. Use `orders` as the payment input to the connector; do not build three competing payment integrations.
- User confirms a valid future `orders.next_payment_date` keeps the member Paid until that date, including after cancellation or payment failure. Retain Payment Cancelled or Payment Failed alongside Paid as appropriate. Apply this to the relevant current subscription state, not arbitrary historical orders. Refund/revocation handling remains to be checked separately.
- Email sending is explicitly excluded. The phase-one proposal remains local contact/payment sync, groups, and Sync Management; no email/SMS workflows or sends are to be enabled. Checkout tracking remains a proposed later milestone, and profile completion is deferred.
- User confirms missing/NULL or zero `next_payment_date` means no active payment subscription for the corresponding subscription state. This is a known inactive-payment condition, not an unknown-data condition.
- Confirmed exception: a PayPal cancellation with a blank next_payment_date retains Paid until the previous relevant valid expiry for the SAME subscription, alongside Payment Cancelled. Without a valid prior paid-through date, no paid entitlement is inferred.
- Confirmed deleted-member policy: status = -1 is excluded from initial import. If already mapped, mark the existing contact Source Deleted and preserve its CRM history; do not delete or recreate it.
- Device rule supplied by user: null/empty means Web, `apple` means Apple/iOS, `android` means Android.
- User confirms `device_type = google` identifies a Google payment subscriber. Preserve this source value and classify it as Google payment subscription; do not leave it unresolved or assume it proves a particular physical device.
- This document authorizes no data import, new CRM fields/views, source database changes, deployment, or marketing sends. Current work is documentation and read-only discovery.

## Verified findings

vsmcp exposes member identity, contact, status, and device fields, plus orders containing `username`, `payment_gateway_type`, `payment_status`, `txn_profile_status`, `next_payment_date`, `payment_date`, `time_created`, `order_id`, and provider transaction/subscription references.

The reviewed dataset has 1,927 members and 25,571 order rows. All member emails were populated and unique after trim/lowercase in the prior aggregate check; 1,920 member telephone values were missing. These are observations of the accessible database, not guarantees about future records or data stored elsewhere.

Read-only orders date audit:

| Gateway | Order rows | NULL next date | Zero next date |
|---|---:|---:|---:|
| PayPal | 22,137 | 1,106 | 952 |
| Apple | 1,823 | 0 | 9 |
| Google | 1,611 | 0 | 1 |

Zero dates mean a textual timestamp starting with `0000`; they are not SQL NULL. Per the user's confirmed business rule, missing/NULL and zero dates indicate no active payment subscription. Never convert them into a valid access expiry. Apply this rule to the relevant current subscription state, not any arbitrary historical row. Counts are historical rows, not unique subscribers. Some future dates belong to historical events and do not alone establish current membership.

Payment values are heterogeneous. Examples include PayPal `Completed`, `success`, `Failed`, `Pending`, and `cancelled`; Apple `PURCHASE` and `RENEWAL`; Google numeric strings. PayPal failures can coexist with an `Active` profile status. Do not interpret a numeric Google value or a bare Active flag without checking the writer code.

Device values observed: null 910, apple 660, android 353, google 4. The user confirms the four `google` values identify Google payment subscribers. Retain the raw value and use the Google payment subscription classification. This is an explicit exception to interpreting device_type solely as a device field: it does not establish current paid status or the device used for every later action. Orders remain authoritative for current payment/subscription state.

The exposed `orders` schema has no generic `date_updated` column. Source review now confirms both insert and update paths, including API identity backfills. A sync cannot rely on member.date_updated or an order-ID watermark alone. Source readers use subscription references and sometimes 12-character username prefixes; vsmcp found 1,924 distinct prefixes for 1,927 members, so ambiguous prefix matching is unsafe. Exact end-to-end linkage and provider-event ordering still require validation. See the source review for evidence.

## Can one person belong to multiple groups?

Yes. Two existing CRM capabilities support this without duplicating contacts:

1. A built-in Multi-select custom field can hold several group labels on one People record.
2. Saved views persist filters and filter groups. The same contact can match several views, including filters against multi-select values.

Recommended first version: add a sync-managed Multi-select field named `Customer Groups`, and save a filtered People view for each useful group. Keep the underlying membership/payment fields as the explanation for those group labels. The connector recalculates the complete automatic group set whenever the source state changes, removing obsolete labels as well as adding new ones.

These are record segments, not security roles or workspace members. Creating a group/view does not by itself create a mailing list, initiate a campaign, or prove email/SMS automation is configured. Messaging capabilities require a separate focused review.

If manual grouping is needed later, use a separate Manual Tags field so automatic sync cannot overwrite user-added labels. For phase one, avoid a custom Groups object or separate copies of a person for each group.

Example: one contact can simultaneously be `Paid User`, `Payment Active`, and `Apple User`. A person who cancels renewal but retains paid access can be `Paid User`, `Payment Cancelled`, and `Apple User`. A free and currently paid segment should not overlap under the proposed definitions.

## State and group rules

Store independent dimensions rather than forcing everything into one status:

| Field | Purpose |
|---|---|
| Member ID | Reuse existing `memberId`; permanent source identity |
| Name, Emails, Phones | Reuse existing built-in fields |
| Status, Is Free Access, Device Type | Reuse existing source-value custom fields; retain raw values |
| Platform | Normalized Web / Apple / Android / Unknown |
| Account State | Active (source status 1) / Inactive (0) / Source Deleted (-1, existing mapped contacts only) / Unknown |
| Membership State | Free / Paid / Complimentary / Lapsed / Unknown |
| Payment State | Current / Inactive / Pending / Failed / Cancelled / Unknown; missing/zero next date means no active payment subscription, with failure/cancellation reason retained when known |
| Payment Provider | Provider of the relevant subscription; do not derive from device |
| Next Payment Date | Raw valid next-payment date from the relevant order stream |
| Access Valid Until | Valid future next_payment_date from the relevant current subscription, including cancellation/failure under the confirmed rule; refund/revocation exceptions require separate verification |
| Customer Groups | Multi-select computed from the above dimensions |
| Last Synced At | Last confirmed CRM data change by the connector; unchanged checks are recorded in sync-run history without rewriting this contact field |

Customer groups:

| Group | Proposed definition |
|---|---|
| Free User | No current paid entitlement and eligible for the product's free tier; exclude unknown/unmatched payment records |
| Paid User | At least one valid paid entitlement at the evaluation time |
| Payment Active | Relevant paid subscription has current successful payment state and has not entered cancellation/failure state |
| Payment Failed | Current relevant billing state is failed; historical failures superseded by recovery do not count |
| Payment Cancelled | Cancellation is currently effective for renewal; paid access may still exist until expiry |
| Lapsed User | Previously paid entitlement has ended and no other paid entitlement remains |
| Inactive User | Source account status explicitly marks inactive; not merely a lack of recent logins |
| Web / Apple / Android User | Normalized member device type according to confirmed mapping |
| Google Payment Subscriber | Source device_type is google, or a current linked subscription is confirmed as Google by orders; paid activity is evaluated separately |
| Source Deleted | Source status -1 on an already-mapped contact; preserve history and exclude from ordinary current customer audiences |

Complimentary/free access needs its own rule using `is_free_access` and `free_access_till_date`; do not label it as revenue-generating Paid membership merely because it grants premium features. Free versus lapsed eligibility also requires a business decision.

## Using next_payment_date safely

Suggested reducer:

1. Map orders to a member and group them by provider plus stable subscription reference. Do not assume username is immutable or guess an email match for unmatched orders.
2. Deduplicate events with provider references and event identity where available. Determine business-event order; database arrival order alone is insufficient for delayed callbacks.
3. Process current success, failure, cancellation, recovery, refund, reversal, and expiry information. Exclude test events using validated source markers; device type is not an environment marker.
4. Per the confirmed business rule, a valid future next_payment_date on the relevant current subscription keeps the member Paid until that date. This is also the required CRM classification after cancellation or payment failure. Source review must establish how to select the relevant order state; it must not silently replace this confirmed business rule.
5. Retain Payment Cancelled or Payment Failed alongside Paid when applicable. Once the date is reached, recompute membership across all subscriptions and complimentary-access rules. Explicit revocation/refund cases remain a separate rule to verify and report if they differ from cancellation/failure.
6. Evaluate all relevant subscriptions: cancelling an old Apple subscription must not erase a valid current PayPal entitlement. If multiple providers remain active, retain per-subscription state in the connector and flag ambiguity rather than silently choosing one.
7. Missing/NULL or zero next-payment dates mean no active payment subscription, except the confirmed PayPal cancellation case: consult the previous relevant valid paid-through date for the same subscription and retain Paid until then. Do not infer Free, Cancelled, or Lapsed from a missing date alone. Unmatched records and genuinely ambiguous statuses remain Unknown/Needs Review. An inactive historical subscription must not override another current paid subscription.
8. Re-evaluate date expiry on a schedule even when no new webhook arrives. Use a confirmed timezone and one consistent clock.

Do not use MAX(next_payment_date) across all historical orders or a simple latest-order-per-member rule. No final paid-member count has been established in this review.

## Proposed small implementation sequence

1. Review the existing webhook writers and account-status logic. Confirm identity joins, date semantics, event ordering, sandbox handling, and status maps for all three providers.
2. Produce a dry-run classification report containing aggregate segment counts and exceptions. Validate known examples with the user before enabling CRM writes.
3. Create only the missing fields through the built-in metadata API; reuse prior custom fields. Create Customer Groups and saved People views. Keep one record per Member ID and persist Member ID-to-CRM UUID mapping.
4. Add a small source-side connector: after the existing webhook successfully saves an order, durably enqueue the affected member for sync. Registration/profile identity/device/account changes also enqueue that member. No changes to checkout are required for payment segmentation.
5. A worker reads the authoritative source state, computes fields/groups, and updates the CRM through its supported API. Retry transient errors, deduplicate updates, serialize per member, and avoid sending stale state after newer state.
6. Reconcile periodically for missed events, edits to old orders, expiry, and complimentary-access expiry. For the small dataset, a narrow-column snapshot/diff may be a practical initial fallback if source event hooks are not yet available; establish query cost first. vsmcp is a discovery tool, not the deployed scheduler/connector.
7. Import a small pilot with no live marketing sends. Once validated, backfill the agreed audience and enable continuous sync. Store credentials server-side and avoid personal/payment payloads in logs.
8. Add the proposed Sync Management module described below so an authorized administrator can preview, run, monitor, and retry sync without using developer commands.

Target pilot freshness: within five minutes of a source change. This is a proposed target, not a measured service guarantee. Group membership changing must be tested separately from any workflow trigger or campaign behavior.

Checkout-start/abandonment is separate from paid membership. Successful payment webhooks do not reveal every abandoned Subscribe attempt. Leave this as a later explicit milestone until this segmentation pilot is proven; it is not silently removed from the broader client request. Profile completion is explicitly deferred by the user.

## Required validation and duplicate-safe group reconciliation

User requirement: every sync must validate the contact and existing group membership. Do not add a contact or a group membership again when it already exists. When source status changes, remove obsolete automatic memberships and add the correct memberships, preserving all other still-valid groups.

The sync operation must be idempotent: running the same input repeatedly produces the same contact and group state, without duplicate records, repeated group entries, or repeated transition notifications.

For each member:

1. Validate source Member ID, target workspace, supported status values, relevant payment records, date handling, and group-option mappings. Incomplete source reads or an unavailable payment source must fail/retry; they must not be interpreted as an empty group set or no subscription.
2. Resolve the existing CRM contact using the stored Member ID-to-contact ID mapping and verify the contact's Member ID. If the mapping is missing, look up Member ID before creating anything. Conflicting or duplicate existing matches go to Needs Review; do not arbitrarily merge, overwrite, or create another contact. Email can assist initial matching but is not the permanent identity key.
3. Compute the complete desired automatic group set from current source state. Use stable group option IDs/API values, not display labels, and remove duplicate values from the computed set.
4. Read the contact's current sync-managed groups. Calculate `toAdd = desired - current`, `toRemove = current - desired`, and `unchanged = current intersect desired`.
5. If groups and other synchronized fields are unchanged, record Unchanged and skip the CRM write. Existing memberships are not added again.
6. Where supported, update the synchronized status fields and the complete Customer Groups multi-select value in one record update. Do not implement movement as a delete-contact/create-contact operation or as a series of independent tag writes that can leave contradictory partial state. Preserve unrelated CRM data and any separate Manual Tags field.
7. Serialize work for each workspace/Member ID across webhook, manual, and scheduled runs. Use a unique identity mapping, a per-member lock, and an appropriate create/update conflict strategy. Re-read current source state on retry so an older queued event cannot undo a newer result.
8. Verify the returned/stored state before recording success. If a request times out after the CRM may have committed it, read the contact before retrying. Record source fingerprint/version, rule version, destination ID, and outcome; do not advance a successful checkpoint for an unverified update.
9. Emit any future journey transition only after a confirmed state change and deduplicate it by member and transition/version. An unchanged reconciliation or a retried request must not restart marketing. Campaign delivery is still outside this document's implementation approval.

Examples:

| Before | Source change | After |
|---|---|---|
| Free User, Web User | Payment confirmed and current paid access established | Paid User, Payment Active, Web User |
| Paid User, Payment Active, Apple User | Current payment fails | Remove Payment Active; add Payment Failed; retain Apple User and retain Paid User only if source access rules still grant paid access |
| Payment Failed, Android User | Payment recovers | Remove Payment Failed; add Paid User and Payment Active; retain Android User |
| Paid User, Payment Cancelled, Apple User | Paid access expires with no other entitlement | Remove Paid User; add Lapsed User; retain Apple User and retain Payment Cancelled only while its agreed current-state definition still applies |
| Paid User, Payment Active, Web User | No source change | No group or contact write |

Saved views are filters over the same contact and reflect its new field values; there is no separate copy of the user to move between views. Some groups overlap legitimately, so a status change must not clear every group indiscriminately.

## Re-audit additions: field ownership, identity, and recovery

### Complete contact mapping

The earlier requested member-field mapping remains part of contact sync, not just the subset listed in the state model:

| Source field | Existing CRM destination |
|---|---|
| member_id | memberId |
| full_name | built-in name composite |
| email | emails.primaryEmail |
| telephone | phones primary phone components |
| address | addressCustom |
| gender | gender |
| gender_other | genderOther |
| city | city |
| country | country |
| user_type | userType |
| isverify | isVerified |
| status | status |
| is_free_access | isFreeAccess |
| device_type | deviceType |
| date_added | Creation date, subject to verifying supported historical timestamp import |

- Do not create duplicate fields merely because source snake_case differs from CRM camelCase. Verify existing field names, types, and writability before running.
- Preserve full_name exactly when mapping to the CRM name composite; do not guess culturally dependent surname boundaries. A conservative initial mapping is the whole source name in firstName and an empty lastName, subject to the CRM display check.
- Source email/phone fields own only their mapped primary values. Preserve additional emails, additional phones, notes, company relations, owners, and other CRM-only data. Define any deliberate primary-value replacement in the mapping.
- Normalize valid phone numbers with country context where available; ambiguous/invalid values should be reported, not assigned an invented country code. A blank telephone is a valid missing-contact value, not a failed whole-record import.
- An explicitly empty authoritative source field may clear its mapped CRM value under the agreed mapping. An omitted field, incomplete read, parse error, or source outage must not clear existing data.
- Creation date needs a capability check: source signup time and CRM import time are different. If the supported API cannot set historical createdAt correctly, document that limitation and obtain a decision on a separate Source Joined At field. Do not silently replace historical signup dates with import time or bypass immutable-field rules.
- Unexpected source enum values go to Needs Review without relabelling users from guessed codes. Retain raw deviceType=google as the confirmed Google payment subscription indicator; do not treat it as proof of current payment activity or physical Android usage.

### Identity and group administration

- Scope contact identity and locking by source system, source member ID, and target workspace. Enforce uniqueness in the mapping store; verify whether a unique custom memberId constraint is supported and suitable for the target CRM before relying on it.
- Before linking a manually created contact without Member ID, require an unambiguous identity match under an agreed policy. Existing duplicate emails/phones or conflicting Member IDs must stop automatic linking for that member. Do not overwrite a mapped contact based on email alone.
- A mapped CRM contact that was trashed/deleted is not automatically recreated. Flag it for review until a restore/recreate policy is agreed; active-only lookups alone can cause duplicates.
- Group renames may change display labels but not stable option values. If a required sync-managed group option is deleted or its type changes, fail validation rather than silently creating a new option or clearing memberships.
- Automatic Customer Groups are connector-owned. Keep manual classifications in the separate Manual Tags field if introduced. Verify whether the installed CRM can make automatic fields read-only for ordinary users; if not, disclose that manual edits will be corrected on reconciliation.
- Aggregate group counts may exceed the contact count because groups overlap. Do not present their sum as the number of unique customers.
- A single contact-level Payment Provider/State is a summary, not a replacement for per-subscription state. Define deterministic aggregation before implementation; retain conflicting concurrent subscription states as exceptions rather than selecting an arbitrary provider.

### Reliability and rollout

- Prefer recording source change intent durably in the same transaction as the relevant source update when feasible. A network call after commit alone can be lost; periodic reconciliation is required even with an event queue.
- Do not advance a global high-water mark past failed work unless that work has a durable retry record. Use bounded, stable pagination and overlapping/repeated reconciliation to cover records changing during a run.
- A full run must establish complete source coverage before declaring success. Source connectivity/schema failures stop processing. A configurable unexpected-change threshold should pause a suspicious mass membership change for investigation, without treating a successful full initial backfill as an error.
- Dry-run results are a preview, not a stale write batch. Re-evaluate source state and rule version when execution starts. Include target workspace, rule version, and counts in the preview.
- Handle expired/revoked connector credentials and API rate limits explicitly. Never log credentials or complete payment webhook payloads. Run history should use IDs, change categories, and sanitized errors with a bounded retention policy.
- Initial import must suppress unintended existing workflow triggers as well as connector-generated events. Verify the CRM's actual trigger behavior before importing real members; an assumption that the connector sends no email is insufficient.
- Provide a basic Pause Automatic Sync control for administrators. Pause stops new automatic work from starting; in-flight member updates finish safely. Preserve queued work and make backlog visible for resume. This is an operational control, not a sophisticated scheduling UI.
- Rollback should start by pausing sync and correcting/recomputing the affected mappings/groups from the source. Never restore an entire CRM database over unrelated newer work as a routine sync rollback. Take a scoped backup/export before the first write-enabled pilot.
- No source member hard deletion, CRM contact deletion, or real marketing sends are implicit in contact synchronization. Explicit inactive-account signals should update classification and later marketing suppression without deleting the contact, subject to the confirmed account-status rules.

### Scope decisions raised in this audit

1. User explicitly excludes email sending. The first milestone remains proposed as local contact/payment sync, overlapping groups, and Sync Management, with no email/SMS sends enabled. Checkout tracking remains proposed for later; profile completion is explicitly deferred. The current 7–11 day estimate covers only that first milestone.
2. Resolved: the user confirms that future next_payment_date keeps a member Paid after cancellation/payment failure, alongside the applicable Cancelled/Failed group. NULL/zero dates are already resolved as no active payment subscription.
3. Source location resolved: D:/xampp/htdocs/vshowcards.com-newsite-1. Read-only inspection confirmed status codes, complimentary-access expiry, provider order fields, and both insert/update paths. See SOURCE_PAYMENT_REVIEW.md for remaining linkage, timezone, test-marker, and deployed-equivalence checks.

Email exclusion, cancellation/failure classification, source location, the PayPal blank-date exception, and deleted-member policy are resolved. The inspected local branch/commit is gitesh/2b5a85d; deployed equivalence is not established. Any further identity/field-import issues should be documented with concrete examples and a proposed default, without publishing customer details or secrets.

## Proposed new module: Sync Management

Yes, add a small custom Sync Management module to this CRM. This is proposed new functionality, not an assertion that an existing built-in sync dashboard is available. Its UI controls the connector/worker; it must not query production MySQL directly from the browser or depend on the interactive vsmcp tool.

### Initial administrator screen

- Connection summary: source and target workspace/environment, configured state, and last successful check. Never display credentials.
- Preview / Dry Run: calculate proposed contact changes, additions, removals, unchanged records, and exceptions without CRM/customer-data writes or campaign triggers.
- Sync One Member: validate and reconcile a specified Member ID for investigation and testing.
- Run Incremental Sync: enqueue known changes since the last successful processing point. A webhook outbox/change queue or validated snapshot comparison is required; orders has no general date_updated field.
- Run Full Reconciliation: evaluate the agreed source population against existing CRM contacts and memberships. Full means reconcile, not delete/reimport contacts or reset the workspace.
- Retry Failed: retry failed members with a fresh source read, preserving completed progress.
- Run history: queued/running/completed/completed-with-errors/failed status, start/end times, processed count, contacts created/updated/unchanged, group additions/removals, failures, and a sanitized error summary. Group-change totals and contact totals are separate metrics.
- Schedule status: show whether automatic webhook processing and reconciliation are enabled and the last successful run. Keep advanced scheduling controls out of the first version unless needed.

### Backend behavior

- Use background jobs and a shared reconciliation service for all entry points. An HTTP request starts a job and returns its run ID; it does not wait for the entire database sync.
- Authorize read/run/retry operations server-side for the intended workspace administrator. A hidden sidebar item alone is not access control.
- Reject or coalesce duplicate active full-run requests, and use per-member serialization to handle overlap with incremental events. Disabling a button alone is insufficient.
- Persist run/checkpoint/member-result state for retry and recovery. Use bounded batches, retry/backoff for transient errors, rate limiting, and a clear Needs Review outcome for invalid source data.
- Keep a failed member visible even if other members complete. Mark the run completed-with-errors instead of presenting partial progress as full success.
- A member missing from a partial read is not a deletion instruction. Account deletion/disable behavior requires an explicit source signal and an agreed rule.
- Include the basic pause/resume and backlog behavior specified in the re-audit additions. Authorize these controls server-side and record who initiated each manual run, retry, pause, or resume.
- Keep the connector's business rules centralized. The module does not implement a second set of payment or group rules in its UI.

Validate the existing CRM extension, authorization, and job infrastructure before choosing exact code locations. Prefer the installed framework and queue facilities; do not introduce a separate application or additional infrastructure solely for this screen.

### Effort adjustment

Allow an additional 2–3 developer days for the minimal Sync Management UI, run-history API, authorization, and control/recovery tests, assuming the core worker and run tracking are delivered with the sync work. Combined provisional scope is 7–11 developer days for segmentation, sync, and this module. A sophisticated scheduler, detailed audit viewer, live progress streaming, campaign builder, and checkout instrumentation are excluded.

## Acceptance cases

- Free to paid; payment failure to recovery; no stale failed/free group after success.
- Cancel renewal with a future paid-through date: cancelled group and paid group may coexist.
- Date passes with no webhook: lapsed classification updates on schedule.
- Refund/revocation despite future next date follows source entitlement rules.
- Missing/NULL or zero next date produces no active payment subscription, except a PayPal cancellation retains Paid through its prior relevant valid expiry for the same subscription. Neither case becomes Unknown merely because the cancellation date is absent. Another valid paid subscription remains effective.
- Unmatched usernames and unknown statuses are held for review.
- Duplicate and late events do not duplicate contacts or revert newer state.
- Repeating the same full/member sync leaves exactly one contact per Member ID and one instance of each group value, with no repeated transition notification.
- A current group membership is retained without a duplicate add; an obsolete membership is removed; unrelated still-valid memberships and Manual Tags remain.
- A payment-source outage or incomplete read produces a retry/error, never mass removal of paid groups.
- A timeout after a committed update is reconciled by reading current CRM state before retrying.
- Two simultaneous Run Sync requests and overlapping webhook events do not create duplicate contacts or conflicting group state.
- Dry run makes no CRM/customer-data changes and triggers no marketing; it reports the expected additions and removals.
- Unauthorized users cannot start or inspect another workspace's sync. Partial failures are visible and failed-only retry does not duplicate successful changes.
- Concurrent subscriptions across providers are evaluated correctly.
- null/empty/whitespace device becomes Web; apple becomes Apple; android becomes Android; google identifies a Google payment subscriber. The google value alone does not establish active paid status.
- Email change updates the same Member ID record.
- One contact appears in multiple saved views; obsolete automatic groups disappear.
- CRM edits cannot become the authoritative source of payment status.
- Local pilot and live CRM destinations remain explicitly separated.
- Source status -1 is skipped initially; an already-mapped contact is marked Source Deleted, excluded from current customer audiences, and keeps its history without deletion/recreation.
- Colliding 12-character username prefixes are held for review unless a validated exact identity/subscription mapping resolves them.
- Original source signup time is preserved through a supported mapping or a documented alternative; import time is not silently substituted.
- CRM-only fields and additional contact details survive sync; incomplete source responses do not erase fields.
- Missing/deleted group options, trashed mapped contacts, and ambiguous manual-contact matches produce reviewable exceptions, not duplicates.
- No-op checks update run history without rewriting Last Synced At or restarting record-change workflows.
- A failed batch followed by restart resumes/reconciles without skipping failed members or duplicating successful writes.
- First import does not trigger real campaigns; pause/resume retains pending work and unrelated new CRM edits are preserved during recovery.

## Technical validation before expanding the pilot

1. Validate current-event ordering, timezone, refund/revocation exceptions, and deployed callback selection. Both append and update paths are source-verified. Future dates and the PayPal cancellation exception are confirmed user rules.
2. Source codes are resolved: status 1 active, 0 inactive, -1 deleted; user_type 1 Artist, 2 Production/Crew, 3 Casting Director; is_free_access 1 plus a nonexpired free_access_till_date grants complimentary access. Unexpected codes remain exceptions. Confirm the presentation of Complimentary versus Free/Lapsed groups.
3. Definitions of Free, Lapsed, Payment Active, and Payment Cancelled, including multi-subscription precedence.
4. Reliable source member/subscription identity mapping and test/live exclusion. The google device value is already confirmed as Google payment subscription.
5. Pilot destination and audience; application-code access and connector credentials. Do not ask for secrets in chat.
6. Email sending is excluded and is not an implementation blocker. Delivery configuration, consent, unsubscribe handling, and SMS belong to a separately scoped future messaging phase; no sends are authorized here.

Provisional effort for segmentation and sync only: 1–2 developer days validating source rules, 1 day for CRM fields/views, 2–3 days for connector/backfill/reconciliation, and 1–2 days for pilot testing/handover: 5–8 developer days. This excludes profile completion, checkout instrumentation, campaign delivery setup, and significant source webhook repairs. Re-estimate once the above decisions are resolved; it replaces neither a signed estimate nor a promise that messaging is already available.

## Code evidence and verification boundary

- [Multi-select settings form](../../packages/twenty-front/src/modules/settings/data-model/fields/forms/select/components/SettingsDataModelFieldSelectSettingsFormCard.tsx): accepts SELECT and MULTI_SELECT and passes options/default values into the editor.
- [Record filter matching](../../packages/twenty-front/src/modules/object-record/record-filter/utils/isRecordMatchingFilter.ts): MULTI_SELECT delegates to multi-select filter matching.
- [Create view from current state](../../packages/twenty-front/src/modules/views/view-picker/hooks/useCreateViewFromCurrentState.ts): creates named views and copies current filter state when requested.
- [Persist view and filters](../../packages/twenty-front/src/modules/views/hooks/useCreateViewFromCurrentView.ts): persists views, fields, filters/filter groups, and sorts.
- Source database reviewed with vsmcp schema and aggregate SELECTs only. No customer rows were imported or changed.
- CI3 webhook and membership source has now been inspected; see SOURCE_PAYMENT_REVIEW.md. No source controllers were executed. Native mobile code, deployed callback configuration, runtime group workflows, and email/SMS delivery remain unverified. Database evidence, inspected code behavior, and user-supplied rules remain distinguished.
