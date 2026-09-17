# Campaigns using the existing SMTP account

The implementation is now deployed to the VPS; see [the live deployment record](../../deploy/vps/CAMPAIGN_DEPLOYMENT_20260917.md). The local-only state below records the original implementation verification. Production public unsubscribe verification and Mailgun authentication have since passed without email delivery.

## Scope and current state

Implemented September 17, 2026. Campaigns can reuse a connected SMTP account (including Mailgun), its encrypted credentials, and the existing SMTP client. Ordinary People email keeps its existing routing. No dependency, database schema, or migration change is required.

Sending has NOT been exercised against a real provider. Verification uses mocked SMTP and HTTP. The new transport is opt-in and is not activated merely by deploying this code. Public DNS/HTTPS must be configured before real campaign use. No production or DNS changes are part of this local implementation.

The local development environment selects the existing `alex@vshowcards.com` SMTP account. Its public unsubscribe URL remains unset and its domain has no ACTIVE unsubscribe hostname, so marketing sends remain blocked. No passwords were copied or changed.

## Configuration

Set these environment variables on both the CRM server and campaign worker:

```dotenv
CAMPAIGN_SMTP_CONNECTED_ACCOUNT_ID=<existing connectedAccount UUID>
CAMPAIGN_UNSUBSCRIBE_BASE_URL=https://unsubscribe.vshowcards.com
```

The hostname above is a proposed hostname, not a claim that it is configured. The account ID is not a password. Credentials stay in the existing encrypted connected account; do not copy them into source control or these variables. Only the exact sender address of that account is routed to SMTP, in its own workspace. Workspace settings permission remains required for campaign operations. This explicit instance configuration authorizes the selected account for workspace campaign use.

An empty SMTP account ID keeps the existing domain driver. A missing/invalid configured SMTP account fails closed. Other sender addresses keep the existing domain-driver behavior. The local default LOG driver simulates delivery, so never interpret a LOG result as actual mail delivery.

The campaign sender selector includes SMTP connected accounts and shared email senders, with duplicate addresses removed. This does not automatically provision a sending domain: the campaign still needs a matching verified, active emailing-domain record. The local LOG provider's Verified badge is not proof of Mailgun DNS verification. Confirm sender verification in Mailgun before activation.

## Public unsubscribe setup

1. Choose a public HTTPS origin. `unsubscribe.vshowcards.com` is proposed; a public CRM origin can also be used.
2. Configure DNS to reach the intended CRM installation and obtain a valid TLS certificate. Proxy `/emailing/unsubscribe` and all its subpaths to the backend, preserving query strings, GET/POST bodies, and content types. Do not route these requests to the frontend SPA or an authentication page.
3. Deploy the public unsubscribe controller, including `/emailing/unsubscribe/verify`, and its suppression database on the same installation that sends campaigns.
4. Set `CAMPAIGN_UNSUBSCRIBE_BASE_URL` to the HTTPS origin only, without a path, query, credentials, or fragment. Set it on both server and worker.
5. The CRM checks the endpoint with a signed preview token before campaign preparation and again before SMTP handoff. The endpoint must decrypt that installation's token and return its SHA-256 challenge. HTTPS failures, redirects, wrong installations, and unreachable routes block sending. This check sends no email and changes no subscription preferences.
6. An already ACTIVE unsubscribe hostname can still be used with the URL override empty, preserving the existing verified-hostname flow.

A localhost CRM cannot use a production unsubscribe service backed by an unrelated database. Unsubscribe actions must update the same suppression data used by the sender. For local testing, either expose this local backend through an approved public HTTPS endpoint or perform the eventual real sending test on the deployed CRM. Do not simply mark the hostname ACTIVE in SQL.

DNS and VPS configuration require the user's infrastructure authorization and access. They remain outstanding until the hostname and target installation are confirmed.

## Delivery behavior

- Existing campaign queue, audience snapshots, delivery claims, credit checks, rate limits, and campaign statistics remain in use.
- Marketing sends route through `CampaignSmtpService` only for the explicitly configured account. Ordinary transactional sends continue on their existing route.
- Each recipient gets a separate message, personalized body/subject, unsubscribe footer, and one-click unsubscribe headers. Addresses are never combined into a visible campaign To list.
- Existing global/topic unsubscribe and hard suppression checks run before the batch handoff; suppressed indexes remain correctly mapped to delivery records.
- Replies go to the actual SMTP account address, not the demo shared-channel forwarding address.
- Campaign SMTP requires TLS certificate verification; stored credentials are reused, not exposed.
- Accepted recipients are returned individually. A per-recipient SMTP failure does not throw away earlier successes or retry the entire batch. Errors are sanitized to exclude credential/connection details.
- SMTP acceptance is not proof of inbox delivery. A lost acknowledgement can be ambiguous. Review Mailgun logs before manually retrying an unconfirmed recipient. Exactly-once delivery cannot be guaranteed over SMTP.
- Mailgun delivery/bounce/complaint webhook ingestion is not added here. Existing CRM suppressions are honored, but new Mailgun events are not automatically imported by this change. Provider limits, billing, and provider-side suppression still apply.

## Dashboard workflow after configuration

1. Open Campaigns and choose the existing SMTP email address in **From**.
2. Select the list in **To**, enter a subject, and compose the personalized body.
3. Review audience counts and unsubscribe topic settings.
4. Only after explicit authorization to send, use **Test** with a controlled recipient, then review the received message and unsubscribe behavior before a campaign launch.

Do not click Test or Send as a configuration check when the user has prohibited email delivery.

## Verification and maintenance

New tests:

- `campaign-smtp.service.spec.ts`: opt-in behavior, workspace/sender isolation, unsubscribe guards, wrong endpoint, unsafe URL, personalized separate messages, partial failures, credential-safe errors.
- `emailing-domain-sender.service.spec.ts`: transactional routing unchanged, SMTP marketing routing, suppression filtering and index mapping, domain/suspension checks.
- `unsubscribe.controller.spec.ts`: preview-only readiness proof; invalid, expired and non-preview tokens rejected without subscription writes.

Run from repository root with existing dependencies:

```bash
node_modules/.bin/jest --config packages/twenty-server/jest.config.mjs --runInBand --runTestsByPath packages/twenty-server/src/modules/emailing/services/campaign-smtp.service.spec.ts packages/twenty-server/src/modules/emailing/services/emailing-domain-sender.service.spec.ts packages/twenty-server/src/modules/emailing/controllers/unsubscribe.controller.spec.ts
cd packages/twenty-server && ../../node_modules/.bin/tsgo --noEmit -p tsconfig.json
cd ../twenty-front && ../../node_modules/.bin/tsgo --noEmit -p tsconfig.json
```

Verification completed: all 22 tests across the three new suites passed; server and frontend `tsgo --noEmit` passed; scoped type-aware Oxlint reported zero warnings/errors. Changed backend files were compiled locally with the existing SWC toolchain. No mail provider call was used for verification.

Local smoke checks after restart: backend `/healthz` returned 200; the new unsubscribe verification endpoint returned 400 for an invalid token; the sender query returned `alex@vshowcards.com`; Vite served the updated campaign component with SMTP sender support. The account is also represented by the existing shared sender with the same address; the explicit SMTP mapping determines campaign transport. Sending was not invoked. Public endpoint verification remains pending DNS/HTTPS setup.

Rollback: pause campaign jobs first, clear `CAMPAIGN_SMTP_CONNECTED_ACCOUNT_ID` on server/worker, and restart. Clearing the setting restores the domain driver, which might itself be a live provider; it is not a global email kill switch. No migration rollback is needed.
