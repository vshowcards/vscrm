# Agent workflow

Read [the index](README.md), root `CLAUDE.md`, and applicable nested instructions first. This guide supplements existing conventions and does not override the user's task.

## 1. Establish scope and preserve work

- Identify whether the task is review-only, documentation-only, implementation, or deployment. Do not expand authorization from one category into another.
- Record the current branch/commit and `git status --short`; inspect relevant diffs before editing.
- Preserve pre-existing changes, ignored environment files, generated outputs, and running services. Do not reset, clean, stash, format, or overwrite unrelated work.
- Treat the `nx.json` change recorded in the baseline as pre-existing work, not a defect to remove automatically.
- Never print `.env` values, full Docker environment/config output, authentication links, or complete runtime logs. Extract configuration names only; inspect narrowly and redact before output.

## 2. Trace the actual behavior

Follow the affected flow end to end, rather than inferring architecture from filenames:

1. UI interaction, route, hook, and Jotai/Apollo state.
2. GraphQL resolver or REST controller, middleware, guards, and validation.
3. Service/query runner and workspace authentication context.
4. Metadata, repository, permissions, SQL, relationships, and transaction boundaries.
5. Events, queues, workflow side effects, storage, and external calls.

Search for callers, tests, shared helpers, and similar implementations before adding a new abstraction. Use `rg` when available; use `git grep` and `git ls-files` otherwise. Check scoped `AGENTS.md`/`CLAUDE.md` files before work in extension apps or agent packages.

## 3. Plan changes around system boundaries

- Maintain tenant/workspace isolation and object, field, row, and settings permissions. A frontend restriction is not authorization.
- Reuse existing validation, error mapping, rate limiting, secure HTTP, storage validation, and authentication utilities.
- Account for metadata caches, IndexedDB hydration, Apollo caches, generated GraphQL clients, and shared-package build outputs.
- For schema work, read current upgrade instructions and determine the active version from code. Never copy the historical version in the evaluation into a new migration by assumption.
- Do not rewrite committed upgrade commands. Inspect required `up`/`down` behavior, ordering, and fast/slow command rules.
- Treat queue retries, duplicate delivery, cron registration, and external effects as part of behavior. Inspect idempotency and recovery paths when they are in scope.
- Apply root coding conventions: existing helpers, descriptive names, named exports, functional components, Lingui strings, Linaria styling, and canonical UI icons.
- Check enterprise boundaries when relevant; do not assume a feature is enabled or available merely because its code exists.

## 4. Select verification before execution

Inspect the command, Nx dependencies, package scripts, test setup, and configuration first. A command called `test`, `lint`, or `typecheck` can build dependencies, emit caches, generate files, reset data, or invoke live services.

During a read-only review, prefer direct no-emission checks from [DEVELOPMENT.md](DEVELOPMENT.md). Do not satisfy root advice to rebuild shared packages during a read-only task without authorization to write outputs; report that verification limitation instead.

During authorized implementation, run behavior-focused tests appropriate to the change and necessary package checks. Use isolated test data for integration/browser tests. Do not send real email, charge billing accounts, run production migrations, or deploy as a side effect of verification.

Do not automatically fix failures in a review. For each failure, record the exact command, exit code, relevant sanitized diagnostic, likely cause with confidence, and whether it predates the change.

## 5. Handoff

- Review the final diff and Git status. Separate your changes from pre-existing changes.
- Report behavior changed, why, validation, and limitations. Link concrete source files.
- Record unresolved findings without claiming completion of checks that were skipped.
- Do not commit or publish unless the task authorizes it.
- Update this documentation when an authorized change materially alters architecture or local workflow. Preserve historical review evidence.

Use the [handoff template](REVIEW_CHECKLIST.md#handoff-template) for substantial reviews.
