# VPS deployment

Current release: [Campaign and audience deployment](CAMPAIGN_DEPLOYMENT_20260917.md), application commit `3c655eaf54`, with fresh local data and verified public unsubscribe/SMTP configuration.

For the 2026-09-17 local-data replacement, current configuration differences and rollback procedure, see [Local VSCMS copy to VPS](LOCAL_COPY_20260917.md). The sections below record the original 2026-09-14 deployment and are historical where that newer runbook differs.

Deployment target: `145.223.21.233`, existing Nginx managed under `/www/server/panel/vhost/nginx`.

The deployment is live at **https://vscrm.vshowcards.com**, verified on 2026-09-14. Source image `vscrm:7d34959ca9` was built from the committed checkout using the repository Dockerfile's `twenty` target. Local environment files, demo records, and uncommitted development settings were excluded from the source archive.

Source archive SHA-256: `799c13691a685ab83b6459f2ce6288e73b9e4f50dc938cca76db491172a75c37` (verified locally and on the VPS).

The stack has a separate PostgreSQL 18 database, Redis 7 instance, worker, and file volume. Only the application port is published, on `127.0.0.1:3200`. Existing VPS applications and host databases are separate.

Runtime configuration is in `/opt/vscrm/app.env` with mode `0600`; the database secret is in `/opt/vscrm/secrets/db_password`. Do not commit or print these files. The original bootstrap administrator's temporary credentials were stored in `/opt/vscrm/secrets/admin-credentials.txt`, accessible only to root. That historical bootstrap record is not the current login or campaign sender configuration; consult the newer local-copy runbook. Do not rerun the completed bootstrap script.

The user confirmed `vscrm.vshowcards.com`; the initial spelling `vscms.vshowcards.com` was a typo. DNS resolves through Cloudflare. Only the confirmed site's Nginx configuration was replaced; unrelated virtual hosts were preserved.

External email delivery, AI providers, billing, and sandboxed code execution are not configured. Email uses the logger driver until SMTP is configured; those logs can contain sensitive links. Runtime `SERVER_URL` and `FRONTEND_URL` use `https://vscrm.vshowcards.com`.

## Deployment state on 2026-09-14

- Production backend and frontend image build passed.
- Image ID: `sha256:3ddf875d7be971edb8e1ba0a72058c38cf6c9736b82018b008aa3e8a77e41f3a`.
- Release source: `/opt/vscrm/releases/7d34959ca9`.
- Compose services: server, worker, PostgreSQL, Redis running; server/database/cache health checks passed.
- Explicit database initialization and instance commands completed with exit 0. Required extensions were checked and the user table had zero records afterward. No demo workspace was seeded.
- Cron registration completed successfully.
- Private and public HTTPS `/healthz` returned `status: ok`. Frontend HTML and sampled JavaScript assets returned HTTP 200.
- Public administrator password authentication and token exchange passed, with a Secure/HttpOnly session cookie. An authenticated `/graphql` companies query passed. Server administrator privilege was verified in the database.
- Workspace `VShowCards CRM` is ACTIVE. Standard workspace activation created five built-in starter companies; no local development records were imported. Personal onboarding steps may still appear on first interactive login.
- A scan of the last 150 server/worker log lines at verification time found no ERROR/Error/FATAL/Unhandled lines; this is not an exhaustive log audit.
- On-server database backups: `/opt/vscrm/backups/initial-schema-7d34959ca9.dump` and `/opt/vscrm/backups/after-admin-setup.dump`. The latter passed `pg_restore --list`; a full restore drill and off-server backup remain outstanding.
- Live Nginx vhost: `/www/server/panel/vhost/nginx/vscrm.vshowcards.com.conf`. Prior configuration: `/opt/vscrm/backups/nginx-vscrm-before-live-20260914142154.conf`. Candidate copy: `/opt/vscrm/nginx.vscrm.conf`.
- HTTP redirects to HTTPS. The Let's Encrypt certificate expires 2026-12-13; automatic renewal timer is active and a renewal dry run passed. Renewal hook: `/etc/letsencrypt/renewal-hooks/deploy/vscrm-reload-nginx.sh`. ACME validation uses `/www/wwwroot/vscrm.vshowcards.com`.
- Existing Nginx protocol-option warnings predated this deployment; syntax validation passed before reload.
- Cloudflare returned HTTP 403 to the default Python urllib User-Agent during API verification. Requests using a browser User-Agent passed. Account for edge filtering when configuring API clients; do not disable security controls indiscriminately.

Build log: `/opt/vscrm/logs/build-7d34959ca9.log`. Initialization script/log: `/opt/vscrm/initialize.sh`, `/opt/vscrm/logs/initialize.log`. Initialization is already complete; do not rerun the script indiscriminately.

The compose file bypasses the image's automatic startup entrypoint intentionally: database initialization/upgrades and cron registration must run explicitly, with their exit status checked, before server activation. Do not use startup as an implicit migration operation.

## Operations

Run on the VPS from `/opt/vscrm`. Commands change the deployment unless marked read-only. Do not delete volumes or run database reset/seed commands against production.

```sh
# Read-only status
docker compose ps

# Start the already-initialized application
docker compose up -d server worker

# Read-only local health check
curl --fail --silent http://127.0.0.1:3200/healthz
```

Before an upgrade, create and verify a database backup and retain the prior image and Nginx configuration. Application rollback alone cannot undo schema migrations; use the documented version-specific rollback plan. Back up the database, uploaded-file volume, and protected configuration separately. A configured Docker volume is persistence, not an off-server backup.
