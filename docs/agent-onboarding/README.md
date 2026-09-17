# Coding agent onboarding

This documentation supports future review and development of the `vshowcards/vscrm` checkout. Start here after reading the root `CLAUDE.md` and any instructions scoped to the files involved in your task.

## Reading order

1. [Codebase evaluation](EVALUATION.md): dated findings, technology stack, architecture, repository map, and module responsibilities.
2. [Agent workflow](AGENT_WORKFLOW.md): how to investigate, implement, and verify changes without losing existing work.
3. [Development and verification](DEVELOPMENT.md): local environment, command side effects, and checks actually performed.
4. [Review checklist and handoff template](REVIEW_CHECKLIST.md): repeatable review coverage and evidence recording.
5. [VPS deployment runbook](../../deploy/vps/README.md): live domain, deployment layout, verification, credentials location, backups, and remaining operational setup.

## Current feature planning

- [Campaign SMTP and unsubscribe setup](CAMPAIGN_SMTP.md): reuse the existing Mailgun SMTP account, public endpoint verification, safeguards, and no-send validation.
- [Campaign group audiences](CAMPAIGN_GROUP_AUDIENCES.md): customer-group lists, preview/apply controls, automatic membership updates, and operator steps.
- [VSCMS branding](VSCMS_BRANDING.md): application name, icon assets, retained technical names and verification.
- [Sync dashboard performance](SYNC_DASHBOARD_PERFORMANCE.md): lightweight summaries, on-demand result pages and idle polling behavior.
- [Test-account sync exclusions](TEST_ACCOUNT_SYNC_FILTER.md): name/email rules and treatment of already imported test contacts.
- [Full local customer sync](FULL_CUSTOMER_SYNC.md): current all-member scope, payment-review contact imports, and full import verification.
- [Customer sync and overlapping groups](CUSTOMER_SYNC_PLAN.md): source rules, payment-date findings, built-in grouping options, deferred scope, and decisions required before implementation.
- [Source payment review](SOURCE_PAYMENT_REVIEW.md): verified CodeIgniter webhook mappings, membership rules, identity risks, and confirmed follow-up decisions.
- [Customer sync implementation](CUSTOMER_SYNC_IMPLEMENTATION.md): local module, field/group ownership, pilot controls, verification, and operator handover.
- [MCP implementation prompt](MCP_SYNC_IMPLEMENTATION_PROMPT.md): self-contained instructions for the MCP repository agent to implement read-only source tools for CRM sync.
- [vsmcp verification and adapter](VSMCP_SYNC_VERIFICATION.md): real tool tests, timezone/capacity findings, and local MCP reader integration.

## Evidence baseline

- Review date: 2026-09-14.
- Repository: `https://github.com/vshowcards/vscrm`.
- Reviewed branch and commit: `main`, `7d34959ca9` (`chore: sync AI model catalog (#25869)`).
- Local workspace: `D:\Aimsoft-Projects\vscrm`.
- Original review was read-only. Documentation was added afterward at the user's explicit request.
- Before these documentation changes, Git showed only an existing five-line addition in `nx.json`, setting `pluginsConfig.@nx/js.analyzeSourceFiles` to `false`.
- Ignored development configuration, environment files, dependencies, build outputs, and runtime logs already existed. They are not represented by an ordinary clean/dirty tracked-file check.

These are historical facts, not assertions about a future checkout. Recheck the commit, worktree, runtime, and manifests on every new task. Do not interpret a historical passing check as validation of later changes.

## Scope and authority

User instructions and the current task determine what work is authorized. This documentation does not authorize deployment, destructive operations, database resets, package installation, or external communication.

When documentation differs from implementation, record the discrepancy and treat the inspected implementation as current. Label observations as **verified**, **inferred**, **recommended**, or **not checked**. Never include secret values, connection strings containing credentials, authentication links, or private record contents in documentation or tool output.

The root `AGENTS.md` is tracked by Git as a symbolic link to `CLAUDE.md`. On this Windows checkout it appears as a regular file containing the link target. Preserve that tracked relationship; do not replace it with a separate competing instruction document.

## Maintenance

Keep the dated evaluation as a baseline. For a subsequent review, add a dated section or sibling report and link it here. Record the reviewed commit, scope, exact commands, outcomes, limitations, and remaining questions. Update reusable guidance only when a verified implementation or workflow change warrants it.
