# Test-account sync exclusions — 2026-09-16

The user requested excluding test accounts from future local CRM syncs. This is an exclusion rule, not authorization to delete existing CRM contacts or source accounts.

## Matching rules

Matching ignores case and trims surrounding spaces:

- Full name contains `test`, as requested. This covers observed names such as `UUIDtest2` and `FlowTester3`. It is deliberately a substring rule: a real person's name containing those letters would also be excluded; revise the rule if such a case is identified.
- Full name is a placeholder such as `demo`, `dummy`, `sample`, optionally followed by user/account/person and digits.
- Email local part starts with `test`, contains a separated test/testing/tester/demo/dummy/sample marker, or ends in `test` followed by digits.
- Email domain is example.com/net/org (including subdomains), localhost, or a reserved .test/.invalid/.example domain.

Ordinary addresses containing unrelated words such as `contestwinner`, `latestnews`, or `democrat` remain eligible unless their name independently matches. Gmail, company domains, staff/admin accounts, disposable providers, and paid accounts are not excluded merely by those attributes. These rules identify likely test records; they do not establish intent with certainty.

## Sync behavior

`test-account-filter.ts` supplies the rule; target reconciliation applies it before destination reads or writes, including single-member, preview, full, incremental and retry paths. The report shows outcome `skipped` with `EXCLUDED_TEST_ACCOUNT` and reason codes. Deliberate exclusions do not enter the retry backlog or make a run fail by themselves.

For repeated incomplete-registration attempts, a matching name/email on any retained attempt excludes that deduplicated candidate. All source rows remain available to identity matching: filtering does not hide member identities, weaken ambiguous subscription checks, or resurrect an old registration belonging to an excluded member.

Existing CRM contacts, groups, mappings and history remain unchanged. If the source is corrected so it no longer matches, a later sync can reconcile it normally. This change does not hide existing test contacts from People or delete them. No source data is modified and no marketing messages are sent.

## Verification

Source snapshot audit found **55 member exclusions** (all non-deleted) and **37 distinct incomplete-registration exclusions**. Of these, **54 members and 34 registration contacts already exist in the local CRM** and are preserved. Counts are a dated snapshot.

The focused sync suite passed **68 tests across six suites**, including matching rules, ordinary-email counterexamples, repeated-attempt evidence, prevention of destination writes, and preservation of previously imported contacts. Runtime verification is recorded below after reload.

Runtime verification: API healthy after reload, rule version `2026-09-16.2`. Dashboard preview skipped **55 members and 37 registration candidates** with `EXCLUDED_TEST_ACCOUNT`, proposed zero contact creations/updates, and had zero contact-write failures. A before/after fingerprint of every People row confirmed all contacts unchanged. Existing unrelated review cases still make the overall preview completed-with-errors; the exclusions themselves are deliberate skips. Type checking, scoped lint, formatting and `git diff --check` passed. Automatic scheduling remains paused; manual syncs use the filter immediately.