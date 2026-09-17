# Development and safe verification

This is a dated description of the existing environment, not an instruction to initialize or reset it. Baseline: 2026-09-14, commit `7d34959ca9`.

## Existing local environment

| Item | Observed setup |
| --- | --- |
| Host | Windows, PowerShell, Docker Desktop |
| Repository | `D:\Aimsoft-Projects\vscrm` |
| Compose file / project | Ignored `.devenv/compose.yaml`, project `vscrm-dev` |
| App runtime | Node 24.16.0, Yarn 4.13.0; source mounted at `/workspace` |
| Database/cache | PostgreSQL 16, Redis 7, dedicated Docker volumes |
| Frontend | `http://localhost:3101` |
| Backend | `http://localhost:3100`; health route `/healthz` |
| Processes | Vite frontend, compiled Nest backend, compiled queue worker |

The published application ports were bound to loopback. Verify current bindings before use. The app container alone being up does not establish that all three application processes are running. Do not start duplicates without inspecting process state.

`.devenv/start.sh` and `.devenv/README.md` exist locally but are ignored and may be absent in another clone. Do not reproduce environment values or demo credentials in tracked documents. This guide does not make the local setup portable by itself.

The backend and worker use compiled outputs, so source edits need an authorized rebuild and restart to take effect. Frontend hot reload can be affected by Windows Docker bind-mount notifications. Shared package `dist` directories can be stale after a branch switch.

The pre-existing `nx.json` setting disables `@nx/js` source-file analysis as a local workaround for slow/hanging import inference on the Windows bind mount. Treat it as environment-specific state and preserve it unless its change is in scope.

## Commands executed during the review

Working directory for these exact PowerShell commands: `D:\Aimsoft-Projects`. They assume the existing app container, dependency installation, and required shared outputs are present.

### Backend typecheck

```powershell
docker compose -f vscrm/.devenv/compose.yaml exec -T app /workspace/node_modules/.bin/tsgo -p /workspace/packages/twenty-server/tsconfig.json --noEmit --incremental false
```

Result: exit 0, no diagnostics. Direct invocation avoids an Nx typecheck target's build dependencies/cache. `--noEmit --incremental false` prevents compiler outputs and incremental state. This does not validate runtime behavior or correctness of previously built shared outputs.

### Frontend typecheck

```powershell
docker compose -f vscrm/.devenv/compose.yaml exec -T app /workspace/node_modules/.bin/tsgo -p /workspace/packages/twenty-front/tsconfig.json --noEmit --incremental false
```

Result: exit 0, no diagnostics. Same limitations as the backend check.

### Backend formatting check

```powershell
docker compose -f vscrm/.devenv/compose.yaml exec -T -w /workspace/packages/twenty-server app /workspace/node_modules/.bin/oxfmt --check src/
```

Result: exit 0; all 8,064 matched files used the expected format. This is a formatting check, not semantic lint or a test suite.

### Git preservation

```powershell
git -C vscrm status --short
git -C vscrm diff --stat
```

At the original review's end, only `nx.json` was modified: five insertions. The documentation added afterward is intentionally outside that original baseline.

## Command side effects

| Operation | Side effects / review policy |
| --- | --- |
| Git status/diff, source reads, manifest reads | Suitable for review; avoid sensitive output |
| Direct `tsgo --noEmit --incremental false` | No compiler output intended; requires already available dependencies |
| `oxfmt --check` | Checks formatting without applying fixes |
| Nx typecheck/lint | Can build dependencies/custom rules and write caches; inspect targets first |
| Nx build / Nest build | Can remove and regenerate `dist`, copy assets, run dependency builds |
| Application startup | Generates frontend configuration; can trigger background activity |
| Docker production entrypoint | Can initialize/upgrade the database, flush cache, register crons |
| Jest/Vitest unit tests | Inspect setup, fixtures, transforms, caches, reporters, and external calls first |
| Integration / browser suites | Can mutate records, reset databases, emit reports, or call services |
| GraphQL/translation generation | Writes generated clients, schemas, catalogs, or related artifacts |
| Formatter fix / lint fix | Rewrites source files |
| Yarn install | Writes dependencies/install state; immutable lockfile mode is still not read-only |
| Setup, database reset/seed/migrate, Compose volume deletion | Changes or destroys persistent state; not part of a read-only review |
| CI/CD scripts, Terraform, Helm, release/publish commands | May affect infrastructure or external systems; require appropriate explicit scope |

The original review did not rerun builds or the full semantic linter. The configured lint target builds custom rules. Automated test suites were not executed: integration targets include database resets, and the full unit suite was not cleared for side effects. No failure was automatically fixed.

Earlier setup builds and browser smoke checks were separate actions. Do not report them as test-suite results for this review or for subsequent changes.

## Configuration map: names only

The authoritative definitions are in [ConfigVariables](../../packages/twenty-server/src/engine/core-modules/twenty-config/config-variables.ts), with resolution in [TwentyConfigService](../../packages/twenty-server/src/engine/core-modules/twenty-config/twenty-config.service.ts). This is a selected map, not an exhaustive inventory.

| Category | Variable names |
| --- | --- |
| Runtime/database | `NODE_ENV`, `NODE_PORT`, `SERVER_URL`, `FRONTEND_URL`, `PG_DATABASE_URL`, `REDIS_URL`, `PG_SSL_ALLOW_SELF_SIGNED` |
| Configuration source | `IS_CONFIG_VARIABLES_IN_DB_ENABLED` |
| Authentication/encryption | `APP_SECRET`, `ENCRYPTION_KEY`, `FALLBACK_ENCRYPTION_KEY`, `AUTH_PASSWORD_ENABLED`, `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET`, `SIGNING_KEY_ROTATION_DAYS` |
| Captcha | `CAPTCHA_DRIVER`, `CAPTCHA_SITE_KEY`, `CAPTCHA_SECRET_KEY` |
| Storage | `STORAGE_TYPE`, `STORAGE_LOCAL_PATH`, `STORAGE_S3_NAME`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` |
| Email | `EMAIL_DRIVER`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD`, `EMAIL_SMTP_NO_TLS` |
| Billing | `IS_BILLING_ENABLED`, `BILLING_STRIPE_API_KEY`, `BILLING_STRIPE_WEBHOOK_SECRET` |
| AI/execution | `AI_PROVIDERS`, `OPENAI_API_KEY`, `CODE_INTERPRETER_TYPE`, `E2B_API_KEY`, `LOGIC_FUNCTION_TYPE` |
| Operations | `CLICKHOUSE_URL`, `ANALYTICS_ENABLED`, `SENTRY_DSN`, `LOG_LEVELS`, `WORKER_ENABLED_QUEUES`, `WORKER_EXCLUDED_QUEUES` |
| Container startup | `DISABLE_DB_MIGRATIONS`, `DISABLE_CRON_JOBS_REGISTRATION` |
| Frontend | `REACT_APP_SERVER_BASE_URL`, `REACT_APP_PORT`, `VITE_HOST`, `VITE_ENABLE_SSL`, `VITE_BUILD_SOURCEMAP` |

Eligible database settings can override environment-backed settings when database configuration is enabled. Environment-only settings remain environment-sourced. Separately, the core datasource's dotenv load uses `override: true`. Inspect the specific configuration path rather than assuming a universal precedence rule.

## CI and observability

GitHub Actions defines build, lint/typecheck, unit, integration, browser, generated-code, and cross-version upgrade checks. The inspected server CI uses PostgreSQL 18 and ClickHouse in integration jobs, unlike the local PostgreSQL 16/Redis environment. The review did not verify remote workflow outcomes.

Runtime handling includes Nest loggers, exception filters, optional Sentry, queue event-loop monitoring, and optional ClickHouse analytics. Avoid broad log dumps: the email logger emits full email bodies and other logs can contain personal data or authentication material.

### Local sign-in update — 2026-09-16

The main local CRM login is `alex@vshowcards.com`. Its password was changed at the user's request using the application's bcrypt hash helper, and prior refresh tokens/sessions were revoked. A fresh credentials login was verified. The development sign-in form now defaults to that email and leaves the password empty; no account password is embedded in frontend source. The ignored `.devenv/customer-sync-auth.ps1` helper reads a Windows-user-protected PSCredential from `.devenv/local-admin-credential.xml`. Do not print or commit that file. Production credentials were not changed.