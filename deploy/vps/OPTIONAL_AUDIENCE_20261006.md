# Optional customer group audience — 2026-10-06

Application commit/image: `268aedb0d1` / `vscrm:268aedb0d1`.
Production: https://vscrm.vshowcards.com.

Lists without an enabled automatic group rule default to “None — use existing list members”. Preview/apply and automatic-update controls require an explicit group selection. Clearing the selection discards the preview without writing list membership. Existing automatic rules remain selected; stopping an existing rule preserves its members and returns the selector to None.

Validation: production frontend build passed; the audience-control Jest test passed without network access, including empty defaults, disabled controls, clearing a preview, explicit group selection and apply behavior. Server and worker started successfully. Public homepage and health endpoint returned HTTP 200, and the deployed assets contain the new option. No browser visual check or full monorepo test run was performed.

The backend from `vscrm:f9cad14f9c` was reused unchanged, including the People SMTP fix. No database migrations, list edits or email sends were performed. Build and test Dockerfile: `/opt/vscrm/releases/268aedb0d1/Dockerfile.audience-fix`.

Recovery files: `/opt/vscrm/backups/before-268aedb0d1` (compose, protected environment, database dump). Previous image `vscrm:f9cad14f9c` retained. Restore the backed-up compose/environment files and recreate only server/worker to roll back code; preserve the current database and volumes.
