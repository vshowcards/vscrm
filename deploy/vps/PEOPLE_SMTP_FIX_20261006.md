# People email SMTP fix — 2026-10-06

Deployed application commit `f9cad14f9c`, image `vscrm:f9cad14f9c`, version `2.41.0+f9cad14f9c` to https://vscrm.vshowcards.com.

## Cause and change

The shared People sender used the LOG domain driver, which returned fabricated message IDs. The explicit SMTP integration previously applied only to marketing sends. Single transactional sends now resolve the same configured SMTP account, retaining exact sender/workspace matching, domain validation and suppression checks. Transactional email does not require marketing unsubscribe readiness. Campaign unsubscribe requirements remain unchanged. The shared sender rejects LOG-driver fallback for both single and batch delivery rather than reporting simulated success.

## Verification

- Backend production compilation passed.
- Two network-isolated Jest suites passed: 20 tests covering SMTP routing, transactional sending, simulated-send rejection, sender isolation, suppression, unsubscribe readiness and SMTP error handling.
- Full server `tsgo --noEmit` was attempted and failed on missing `twenty-sdk/front-component-renderer/build` and missing `lodash.kebabcase` declarations in the focused Docker build. No changed-file errors were reported. This is not a full type-check pass.
- Server health passed; worker started successfully.
- Public `/healthz`: HTTP 200.
- Real SMTP credential decryption and Mailgun authentication passed with TLS certificate verification.
- Public unsubscribe challenge and preview page passed.
- No email was sent and no subscription preference was changed during verification. Inbox delivery requires an operator send.

## Deployment and recovery

The release rebuilds the backend and reuses the unchanged frontend from `vscrm:26e901ba67`. Operational Dockerfile: `/opt/vscrm/releases/f9cad14f9c/Dockerfile.smtp-fix`; build logs under `/opt/vscrm/logs`. Source modifications are committed; validation is included in the operational Dockerfile before runtime dependency pruning.

Backup: `/opt/vscrm/backups/before-f9cad14f9c` (compose, protected environment, database dump). Previous image `vscrm:26e901ba67` is retained. To roll back code, restore that backup's compose/environment files and recreate server/worker with `docker compose up -d --no-deps --wait server worker`. Keep current database and volumes; no migrations or data replacement were performed.
