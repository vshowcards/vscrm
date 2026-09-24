# VSCRM branding deployment — 2026-09-24

Application commit: `26e901ba67732acb3d8c0a8d9afb92ce4bad9cbd`, pushed to `origin/main`.
Image: `vscrm:26e901ba67`; runtime version `2.41.0+26e901ba67`.
Production URL: https://vscrm.vshowcards.com.

## Scope and preservation

Renamed application branding, MCP setup identifiers, assets and documentation to VSCRM. Rebuilt the frontend and backend from the committed source archive. Recreated only the server and worker services. Existing database, uploads, Redis, AI credentials and other runtime configuration remain in place. No migrations, source sync or email sends were triggered by deployment verification.

Source: `/opt/vscrm/releases/26e901ba67`.
Deployment scripts: `/opt/vscrm/deploy-26e901ba67`.
Backup: `/opt/vscrm/backups/before-26e901ba67`, containing the previous compose file, protected environment and database dump.
Previous image: `vscrm:3c655eaf54`, retained for rollback.

## Verification

- Source SHA-256 matched after transfer.
- Production Docker build passed, including frontend, backend, email and translation compilation.
- Existing branding tests: 3 suites, 14 tests passed (page titles, activity author fallback, MCP setup).
- Server health check passed and worker started successfully.
- Public HTTPS home page and health endpoint: HTTP 200.
- HTML title and web manifest name: VSCRM.
- Renamed favicon: HTTP 200.
- No ERROR/FATAL/Unhandled lines found in the checked startup logs.
- Browser visual inspection and full monorepo tests were not performed.

## Rollback

Restore `compose.yaml` and `app.env` from the backup into `/opt/vscrm`, then run `docker compose up -d --no-deps --wait server worker` there. This returns to the previous image while keeping current data. Do not restore the database dump for this code-only rollback.
