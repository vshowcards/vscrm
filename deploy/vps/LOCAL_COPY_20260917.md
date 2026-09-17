# Local VSCMS copy to VPS — 2026-09-17

## Scope

The user authorized committing and pushing the current local version, then replacing only VSCRM on `vscrm.vshowcards.com` with local CRM data and configuration. Unrelated VPS applications, host databases, Nginx sites and certificates are outside this deployment.

Application commits: `8882382ccb` (customer sync, UI and branding) and `3b4b5f00fa` (explicit production sync opt-in). Production image: `vscrm:3b4b5f00fa`.

## Data and recovery

- Original deployment backup: `/opt/vscrm/backups/before-local-copy-20260917/`, including PostgreSQL dump, uploads, protected environment/secrets and Nginx configuration. Final cutover backups use `database-at-cutover.dump` and `files-at-cutover.tar.gz`.
- Imported PostgreSQL database: `vscrm_20260917`, within the existing isolated VSCRM PostgreSQL container.
- Imported uploads: Docker volume `vscrm-prod_files_20260917`.
- Fresh cache/queue volume: `vscrm-prod_redis_20260917`; development queues are not transferred.
- Prior `vscrm` database and original file/cache volumes are retained for rollback. They are not the active replacement data.
- Protected import artifacts and operational scripts: `/opt/vscrm/import-20260917/`. Do not publish their contents.
- Rollback script: `/opt/vscrm/import-20260917/rollback.sh`. It stops the replacement application and restores the prior compose/environment, database selection and volumes. Rollback discards access to changes made after cutover until reconciled; obtain current authorization before using it.

Verified local/restored counts before activation: 2,034 People, 1 company, 36 object definitions, 672 field definitions, 2,058 sync-state entries and one workspace. There are 1,005 user records, but only one workspace membership. The production copy disables the 1,004 orphan/demo users and removes their server-admin privileges, preserving their records. Alex remains the sole enabled user and server administrator.

## Configuration differences

- Public frontend/backend URL: `https://vscrm.vshowcards.com`.
- Database/cache endpoints remain private Docker services; only localhost port 3200 is published through the existing HTTPS proxy.
- Preserve the local encryption key securely so copied encrypted settings remain readable. Retain the production application secret rather than copying development login tokens.
- Disable sign-in prefilling and restrict workspace creation to server administrators.
- Enable `IS_CONFIG_VARIABLES_IN_DB_ENABLED` so copied settings (including OpenRouter) are loaded. The prior VPS had it disabled; the first verification detected and corrected this difference.
- Keep automatic customer sync paused. `CUSTOMER_SYNC_ALLOW_PRODUCTION=true` explicitly permits this module in production; its metadata target remains loopback `http://127.0.0.1:3000`.
- Sync configuration is mounted read-only at `/run/secrets/customer-sync.json`; MCP source code is mounted read-only at `/opt/vsmcp`.
- The source configuration currently points to MySQL on the user's PC (`host.docker.internal`). That source is not reachable from this VPS. Do not claim that new source syncs work until a reachable source is provided and verified. Imported sync history/data do not require source access.
- The copied OpenRouter configuration and one connected mailbox are retained. No external AI calls or email/SMS deliveries are part of deployment verification.
- System email uses the logger driver. Initial worker exclusions cover email, messaging, campaigns, calendars, account-sync webhooks, webhooks, workflows, triggers, delayed jobs and cron. These queues must be reviewed before enabling outbound/background automation; never resume accumulated outbound jobs blindly.

## Verification

Before cutover, 74 customer-sync tests, the dashboard request-volume test and server TypeScript check passed. The source archive, database dump and file archive checksums matched on both machines. The original VPS backup passed `pg_restore --list`, and the local dump was actually restored into the replacement database.

After cutover verify container health, public HTTPS, login/token exchange, People count, custom fields/groups, Sync Management history/paused status, uploaded assets and VSCMS branding. Record the actual results in this file; build preparation is not evidence of a successful live deployment.

## Completed live checks

Deployment completed on 2026-09-17. Production Docker build passed, with image manifest `sha256:9642b1260b8300a524a833a6380bc19b7188ca0049d8558fd77428626121c2fa`. Server, PostgreSQL and Redis are healthy; the worker is running.

- Public HTTPS `/healthz`: `ok`.
- Password login and token exchange for `alex@vshowcards.com`: passed using the existing local credential; no password is recorded here.
- Authenticated GraphQL: 2,034 People and 1 company.
- People metadata: 54 fields, including `customerGroups` and `registrationDate`.
- Sync summary: configured, paused, 20 historical runs, zero running/queued runs. No new sync was executed.
- Admin AI query: OpenRouter present, one available/enabled model. No billable completion request was sent.
- HTML and favicon: HTTP 200; favicon 53,882 bytes; manifest name VSCMS; HTML contains no development API URL.
- Browser: rendered VSCMS login logo and title, vShowcards workspace name, empty email input.
- Initial server/worker logs: zero `ERROR`, `FATAL` or `Unhandled` lines in the checked startup window. This is not an exhaustive audit.
- Uploaded-file archive was copied with matching SHA-256 and extracted into the new file volume with runtime ownership. Individual attachment download flows were not exercised.

New source synchronization remains unavailable until the local-PC MySQL source is replaced with an explicitly configured, reachable source. Automatic sync and outbound/background automation exclusions remain in force.
