# Review checklist and handoff template

Use this checklist to record coverage, not to trigger commands automatically. Mark each item done, not applicable, or not checked with a reason. Read [command side effects](DEVELOPMENT.md#command-side-effects) before verification.

## Scope and baseline

- [ ] Record date, repository, branch, commit, and task authorization.
- [ ] Read root and applicable scoped agent instructions.
- [ ] Record initial Git status and relevant pre-existing changes.
- [ ] Identify ignored environment/build/runtime state without exposing values.
- [ ] State whether the work is read-only, documentation, implementation, or deployment.

## Architecture coverage

- [ ] Map applications, packages, shared modules, and dependency boundaries.
- [ ] Read manifests/lockfile constraints; distinguish declared and installed versions.
- [ ] Trace frontend, HTTP backend, worker, and CLI startup.
- [ ] Trace at least one representative record read and mutation end to end.
- [ ] Inspect workspace schema selection and metadata-to-record behavior.
- [ ] Review entity relationships, indexes, migrations, and upgrade ordering.
- [ ] Trace authentication, session lifecycle, authorization, roles, and permissions.
- [ ] Inspect route guards, middleware, validation, pagination, and error mapping.
- [ ] Review Jotai/Apollo/IndexedDB state and invalidation for affected flows.
- [ ] Inspect jobs, retries, cron registration, recovery, and idempotency.
- [ ] Identify external integrations and distinguish support from enablement.

## Configuration, operations, and security

- [ ] Document configuration names and precedence without values.
- [ ] Inspect development/staging/production differences and infrastructure targets.
- [ ] Inspect CI commands, dependency builds, generated artifacts, and destructive hooks.
- [ ] Review logging, error handling, monitoring, and health-check limitations.
- [ ] Review tenant isolation, object/field/row permissions, and privileged paths.
- [ ] Review cookie/CSRF/CORS behavior, public endpoints, and throttling where relevant.
- [ ] Inspect uploads/storage paths, outbound HTTP defenses, webhook signatures, and code execution where relevant.
- [ ] Trace sensitive-data handling without copying secrets or private records.
- [ ] Record dependency patches, deprecated paths, TODOs, duplication, and incomplete modules with evidence.
- [ ] Compare documentation with code and record discrepancies.
- [ ] Distinguish confirmed defects from risks, assumptions, and untested hypotheses.

## Verification and delivery

- [ ] Inspect each proposed check for writes, cache emission, database changes, and external calls.
- [ ] Run appropriate checks within scope; record exact command, directory, result, and exit code.
- [ ] Record skipped checks and why; do not count compilation as runtime validation.
- [ ] For failures, record sanitized evidence and likely cause without automatically fixing review findings.
- [ ] Compare final Git status/diff against the baseline.
- [ ] Report changes, findings, recommendations, limitations, and unresolved decisions.

## Handoff template

Copy this structure into a new report only when creating documentation is authorized. Do not populate placeholders with guessed facts.

```markdown
# Review: <scope>

Date: <date>
Repository / branch / commit: <verified identifiers>
Mode and authorized scope: <read-only / documentation / implementation>
Initial worktree state: <sanitized summary>

## Executive summary
<What the project or affected feature does; current condition; limits of review.>

## Verified implementation
<Stack, startup, architecture/data flow, repository map, affected modules.>
<Use relative source links and distinguish manifests from runtime versions.>

## Findings
| ID | Status | Evidence | Impact | Recommended next step |
| --- | --- | --- | --- | --- |
| <ID> | <verified / inferred / not checked> | <source or command> | <impact> | <action> |

## Verification
| Command and working directory | Result / exit code | Interpretation and limitations |
| --- | --- | --- |
| <exact command> | <observed result> | <what this proves and does not prove> |

Skipped checks: <check and specific reason>.
Failure analysis: <sanitized diagnostic, likely cause, confidence>.

## Changes and preservation
<Files intentionally changed; original work preserved; final Git status.>

## Open questions and next steps
<Unresolved requirements, risks, and evidence needed.>
```
