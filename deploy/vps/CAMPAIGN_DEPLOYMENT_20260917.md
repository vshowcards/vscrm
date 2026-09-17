# Campaign and audience deployment — September 17, 2026

## Scope

User authorized committing/pushing the current checkout and replacing the VPS CRM with current local code, database, uploads, and configuration. Only the VSCRM installation is in scope. No email delivery is part of verification.

Application commit and image tag: `3c655eaf54` / `vscrm:3c655eaf54`.

## Replacement and recovery

- New database: `vscrm_3c655eaf54` in the existing VSCRM PostgreSQL container.
- Upload volume: `vscrm-prod_files_3c655eaf54`.
- Fresh cache/queue volume: `vscrm-prod_redis_3c655eaf54`. Local and previous production queues are not imported.
- MCP source: `/opt/vscrm/vsmcp-3c655eaf54`, mounted read-only.
- Source checkout: `/opt/vscrm/releases/3c655eaf54`.
- Previous deployment backup: `/opt/vscrm/backups/before-3c655eaf54`, including database dump, uploads, environment, secrets, and Nginx configuration. Cutover adds a final database/upload snapshot.
- Protected import artifacts/scripts: `/opt/vscrm/import-3c655eaf54`.
- Rollback script: `/opt/vscrm/import-3c655eaf54/rollback.sh`. Previous database, image, and volumes remain available. Obtain current authorization before rollback after users have started editing the replacement.

The local app was briefly paused for a consistent database/upload snapshot and then resumed. The imported snapshot has 2,035 active contacts, one active list with 330 memberships, and one active draft campaign. Soft-deleted history is preserved. The 1,004 orphan/demo login accounts are disabled in the production copy, leaving one enabled account, as in the previous deployment.

## Runtime configuration

Environment file: `/opt/vscrm/app.env`, mode 0600. Server and worker use the same file.

```dotenv
SERVER_URL=https://vscrm.vshowcards.com
FRONTEND_URL=https://vscrm.vshowcards.com
APP_VERSION=2.41.0+3c655eaf54
CAMPAIGN_SMTP_CONNECTED_ACCOUNT_ID=0fd0450e-4d7a-42d0-963e-3bc4f54b66f4
CAMPAIGN_UNSUBSCRIBE_BASE_URL=https://vscrm.vshowcards.com
```

The sender is `alex@vshowcards.com`; SMTP authentication remains the existing Mailgun account. The copied encryption key is supplied securely as `ENCRYPTION_KEY` so imported mailbox and AI credentials remain readable. The production application secret is retained. Credentials are not stored in Git.

Campaign preparation/send queues are enabled against the fresh Redis volume for deliberate dashboard sends. Other prior exclusions remain: system email, personal messaging queue, calendar, account-sync webhooks, webhooks, workflows, triggers, delayed jobs, and cron. No pending campaign was imported in a runnable state. Automatic source sync remains paused; the source MySQL on the local PC is still unreachable from the VPS. Customer-group list reconciliation uses imported CRM data and does not require source connectivity.

The existing HTTPS reverse proxy already forwards `/emailing/unsubscribe` and subpaths to the backend. No DNS or Nginx modification is required. Generated recipient links contain a secure token; a bare URL is not an unsubscribe request.

## Verification

Source archive, database dump, and uploads SHA-256 matched after transfer. The prior database backup passed `pg_restore --list`; the local database was restored with `--exit-on-error` into the new database.

Before deployment, the implementation passed 22 new mocked SMTP/routing/controller tests, frontend/backend type checks, and scoped type-aware lint. The earlier audience implementation also passed its targeted tests. Build and live verification results are recorded below after cutover.

## Completed live verification

Deployment completed on September 17, 2026. Image manifest list: `sha256:48630d2216894dc1c7d155ac800db22be85fa2bf187a52f9b6200f655b7b62fc`.

- Production Docker build passed. The image's initial commit-only APP_VERSION failed startup validation; the protected runtime environment now explicitly sets the valid `2.41.0+3c655eaf54`. Use that semantic version when rebuilding this release.
- Server, database and Redis healthy; worker running with zero ERROR/FATAL/Unhandled lines in the checked startup window.
- Public HTTPS `/healthz`: HTTP 200.
- Password login/token exchange for `alex@vshowcards.com`: passed; no credentials published.
- Authenticated API: 2,035 People, one list, one active campaign, `Campaign for Non register`, with sender `alex@vshowcards.com`.
- Public unsubscribe verification passed with a signed preview token generated using production configuration. The preferences page returned successfully. No subscription preference was changed.
- The imported SMTP password decrypts successfully with the preserved encryption key. Mailgun SMTP connection/authentication verification passed with certificate validation. No message was sent.
- Local `.env` no longer points at the VPS unsubscribe URL; local campaigns must not write opt-outs into the separate VPS database.

The operator can now open the production campaign and manually use **Test**. Actual delivery and inbox rendering have not been exercised by the deployment agent. Mailgun event webhook ingestion remains outside this SMTP implementation, as documented in the campaign SMTP guide. Source sync remains paused and still requires a source database reachable from the VPS.
