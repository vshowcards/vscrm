# Source payment review for CRM sync

Date: 2026-09-15. Read-only source review; no PHP execution, callbacks, provider calls, mail, or source edits.

## Source baseline

- Local path: `D:/xampp/htdocs/vshowcards.com-newsite-1`.
- Branch: `gitesh`; commit: `2b5a85d`.
- Framework: CodeIgniter 3.1.2, verified in `system/core/CodeIgniter.php:58`.
- This checkout contains web, API, and admin code. Its deployed equivalence and actual callback configuration have not been established. Local source is not proof of the current live deployment.
- Existing untracked `AGENTS.md`, `README.md`, and `docs/` were preserved. No source repository files were changed.

## Resolved source mappings

| Item | Source behavior | CRM consequence |
|---|---|---|
| member.status = 1 | Login accepts status 1; admin marks Active | Active account |
| member.status = 0 | Admin saves unchecked status as 0; UI labels non-1 Inactive | Inactive account, separate from payment state |
| member.status = -1 | deleteMemberById sets -1; main admin query excludes status <= -1 | Confirmed: skip initial import; mark an existing mapped CRM contact Source Deleted and preserve its history |
| user_type = 1 / 2 / 3 | Admin filter labels Artists / Production-Crew / Casting Director | Preserve raw userType; optional labels can use these meanings. Unexpected 0 remains unmapped |
| isverify = 1 | Admin shows Yes; otherwise No | Verification flag only, not payment or marketing consent |
| is_free_access = 1 | check_subscription grants subscribed access only while free_access_till_date >= today's date | Complimentary entitlement, not proof of a paid payment |
| valid next_payment_date | is_next_payment_valid rejects NULL/zero and uses strtotime(date) >= time() | Confirms expiry-based access check for Apple/Google; use the user's confirmed future-date rule for CRM |

Evidence: `application/controllers/Member.php:185`, `:731`, `:759`; `application/views/admin/member_view.php:72`, `:649`; `application/models/Member_model.php:74`, `:198`; `application/models/user/Login_model.php:17`; `application/helpers/functions_helper.php:153`, `:196`.

## Provider event mapping from actual writers

### Google

`application/controllers/user/Rtdn.php`, app_rtdn:

- Fetches subscription details, splits obfuscatedExternalAccountId on `zz`, and takes the first component as username; the remaining components carry plan and currency. Do not join that account identifier directly to numeric member_id or member.uuid.
- Writes expiryTimeMillis / 1000 into orders.next_payment_date.
- Stores purchase token as recurring_payment_id and orderId as txn_id.
- Stores paymentState in payment_status and txn_profile_status; uses a mapped event name in txn_type.
- Event mapping in this checkout: 1 RECOVERED, 2 RENEWED, 3 CANCELED, 4 PURCHASED, 5 SUBSCRIPTION_ON_HOLD, 6 SUBSCRIPTION_IN_GRACE_PERIOD, 7 RESTARTED, 8 SUBSCRIPTION_PRICE_CHANGE_CONFIRMED, 9 SUBSCRIPTION_DEFERRED, 10 SUBSCRIPTION_PAUSED, 11 SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED, 12 SUBSCRIPTION_REVOKED, 13 EXPIRED. Use these observed stored strings; unhandled events require review.
- payment_date and time_created are populated from subscription startTimeMillis, not necessarily notification arrival or renewal-event time. Sorting by these fields alone cannot determine the latest notification.
- Writes the detailed notification table as well as orders. Orders remain the requested CRM payment input.

Evidence: `application/controllers/user/Rtdn.php:20-293`. The explicit app_rtdn route is in `application/config/routes.php:468`.

### Apple

`application/controllers/user/Rtdn.php`, ios_rtdn:

- Uses UUIDHelper to recover a username from appAccountToken when present. This is not a plain numeric Member ID.
- Writes expiresDate / 1000 into next_payment_date; purchaseDate into payment_date.
- Writes originalTransactionId into recurring_payment_id and transactionId into txn_id in the inspected primary path.
- Stores notificationType in txn_type, subtype in payment_type, transactionReason in payment_status, and subscription product type in txn_profile_status.
- Consequently, cancellation classification should inspect txn_type plus payment_type: DID_CHANGE_RENEWAL_STATUS/AUTO_RENEW_DISABLED differs from AUTO_RENEW_ENABLED. RENEWAL as payment_status alone does not establish the current billing state. Renewal failure, recovery, and expiry similarly require event context.
- Source handles both account-token-present and account-token-absent paths; some later API processing backfills identity. Process incomplete identity as retry/review, not an anonymous duplicate contact.
- Apple environment and signed timestamps are persisted to the detailed Apple notification table, not explicit fields of the exposed orders schema. Orders-only production/sandbox exclusion is not yet proven.
- ios_org_rtdn is another public implementation in the same file. Confirm which URL is configured in App Store Connect; do not assume that an alternate method is inactive merely from its name.

Evidence: `application/controllers/user/Rtdn.php:296`, `:322-435`, `:496-525`, `:644`; `application/helpers/uuid_helper.php`. No cryptographic configuration values are reproduced here.

### PayPal

- Explicit paypal_ipn route resolves to user/register/paypal_ipn (`application/config/routes.php:276`).
- Callback parses username from the product-name suffix, stores recurring_payment_id, and stores txn_type, payment_status, profile_status and payment dates in orders.
- recurring_payment_profile_cancel explicitly writes an empty next_payment_date and empty payment_date. This is not necessarily absence of a previously paid period.
- Admin display has special handling: for a cancellation, it reads the previous order for the subscription and can show Active + Cancelled if that previous relevant next-payment date is still valid.
- The shared website check_subscription helper does NOT currently use only orders for PayPal. It calls getSubscriptionDetailsByPaypalApi. Therefore an orders-only CRM classifier is a deliberate user-requested design, not a byte-for-byte reuse of website entitlement logic.

Evidence: `application/controllers/user/Register.php:714`, `:884-970`; `application/controllers/Member.php:773-829`; `application/models/user/User_model.php:500`; `application/helpers/functions_helper.php:153-200`, `:218`.

**User confirmed:** for a PayPal cancellation with a blank date, preserve Paid through the prior relevant valid paid-through date from the same subscription and retain Payment Cancelled. This is an explicit exception to the general missing-date rule. If no such valid prior period exists, do not infer paid access. Never use a maximum across unrelated subscriptions/history.

## Identity and incremental-sync constraints

1. `user/User_model.php:511` selects membership by the first 12 username characters and latest membership_subscription_id. Account-detail readers select by recurring_payment_id and descending order_id. This shows current reader behavior, not a safe unique identity contract.
2. A read-only vsmcp aggregate found 1,927 members but only 1,924 distinct 12-character username prefixes; 637 usernames exceed 12 characters. Prefix collisions are real. Never auto-link an ambiguous prefix; prefer validated exact usernames and provider subscription mappings with explicit exceptions.
3. `user/Membership_model.php:158` and `api/Membership_model.php:157` insert orders. Both also expose update_order, updating by recurring_payment_id. `api/Register.php:325` and `:485` call it to backfill existing order data, including identity.
4. Orders are therefore not an immutable append-only event log. Record order_id for tie-breaking/checkpoint evidence, but do not assume it captures later updates or correct provider-event ordering. A connector must cover insert AND update paths plus reconciliation.
5. Candidate source-side integration points are the actual web/API order write methods and member updates. They currently use simple Query Builder writes; a durable change queue is proposed new work, not an existing CI3 facility. Do not call registration or callback controllers to run a sync: they have unrelated side effects.
6. get_current_datetime uses the timezone from the config table, while expiry conversion uses PHP date/strtotime and runtime defaults. Establish deployed PHP/MySQL/config timezone handling before comparing timestamps. Do not execute entitlement helpers as a read-only check: they may call PayPal.

## Reliability boundaries to preserve in the plan

- The reviewed order writers do not demonstrate transactional event deduplication around related subscription/order writes. Connector idempotency is still required even if the source has duplicates.
- Apple primary callback decodes signed payloads; signature verification and live callback configuration need separate confirmation before representing recorded events as independently verified payment evidence. This review does not authorize payment-security changes.
- Read only the necessary member and order fields. Do not import payment tokens, provider secrets, password fields, or raw notification payloads into the CRM.
- For an orders-only pilot, explicitly resolve how to exclude Apple sandbox and Google test activity. Supporting metadata may require a narrow source-side enrichment or an approved read of existing notification metadata; do not quietly import test events as live customers.
- Source grouping rules distinguish account activity, payment status, and complimentary entitlement. The existing admin sometimes labels any expired Apple/Google subscription Cancelled; CRM's separate Cancelled/Lapsed groups should use the user's agreed definitions and event evidence instead.

## Remaining questions and proposed next step

User decisions resolved: the PayPal cancellation blank-date exception is approved; source-deleted members are skipped on initial import, while already-mapped contacts are marked Source Deleted with history preserved. Source location is resolved and does not need requesting again.

Technical checks still required before writes: confirm this checkout matches the deployed callback handlers; validate exact member/order joins and exception counts; confirm timezone; establish sandbox exclusion; inspect relevant CRM import/field permissions. These checks should be performed read-only or with isolated test data, without provider requests or email sends.

Next deliverable is a dry-run mapping and group-count report with unmatched/ambiguous records summarized, not a production sync. No source modifications, CRM imports, or emails were performed during this review.
