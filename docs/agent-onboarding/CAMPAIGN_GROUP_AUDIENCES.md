# Campaign lists from Customer Groups

Implemented locally on 2026-09-17. Production requires a separate deployment.

## Dashboard steps

1. Open Lists (`/objects/messageLists`), create/open a list, and rename its Name field.
2. Open Members. The **Customer group audience** panel is above the member table.
   The same panel appears below the campaign address fields when a To list is selected.
3. Select a Customer Group, for example **Tried Register**.
4. Leave **Keep members updated automatically** checked for a dynamic list, or uncheck it for a one-time snapshot.
5. Click **Preview audience**. Review the matching count, additions, removals, and up to ten sample names.
6. Click **Apply audience**. The current list membership is replaced with that group's contacts.
7. The Members table refreshes after Apply or Preview. In a campaign, select this list in To.

Changing the selected group or automatic option requires another preview. Preview does not write data; Apply recomputes membership from current CRM data, which can have changed since preview.

**Automatic mode owns the entire audience of the list.** Manually added contacts outside the group are removed on reconciliation. Contacts are only unlinked, never deleted from CRM. Use a separate list if you need unrelated manual recipients. The same person can belong to several lists and several Customer Groups.

Automatic reconciliation runs every minute while the application is running and configured. It is independent of the source-sync pause switch and reads only existing CRM data. Source changes arrive only when source sync runs successfully. This is eventual consistency, not an immediate group-change trigger or a sending-time audience check.

The open audience panel polls status once a minute only when automatic updates are enabled and refreshes that list's member table. Apply and Preview also invalidate the matching junction table's virtualization cache through a scoped browser event. This fixes the initial empty table persisting after successful bulk writes, which deliberately do not emit server record events. Reopen/refresh existing browser pages once after installing this frontend update.

**Stop automatic updates** freezes the current members without clearing them. Applying with automatic mode unchecked similarly creates a fixed snapshot. An empty matching group empties the list, with a warning in preview. Soft-deleted people are excluded. Existing active list/person pairs are never duplicated; rejoining after removal creates a new active link.

## Implementation and operations

- Backend: `customer-list-audience.service.ts` and routes under `/app/customer-sync/lists/:listId/audience`.
- API actions: GET status, POST `/preview`, POST `/apply` with `{ group, automatic }`, POST `/disable`.
- Uses the existing Sync Management workspace administrator authorization and configured workspace restriction. UUIDs and group keys are validated before writes.
- Policy lives in existing `core.keyValuePair`, scoped to workspace, under `customer-sync:list-audience:<listId>`. Stores group, mode, actor, update time, and last successful reconciliation time. No schema migration required.
- Updates run in a transaction and lock the list row; concurrent workers serialize. The existing partial unique index on person/list prevents duplicate active memberships. Failed transactions roll back policy and membership together.
- The schedule runs in configured app processes. Per-process overlap prevention plus row locks protect concurrent execution. Deleted lists are skipped. Transient errors retry next minute and produce a fixed log message without contact details or credentials.
- Direct membership writes suppress workflow/webhook/email events. They do not enable source sync, provision mail services, modify campaigns, or enqueue sends. Existing sending restrictions remain in place.
- Source group definitions come from `CUSTOMER_GROUPS`; this feature does not change classification logic. Preview counts include group members without usable email; campaign delivery eligibility/unsubscribe handling remains a separate concern.
- Current scope is one Customer Group per list, including the built-in sync groups. Arbitrary filter combinations and multiple groups per audience are not implemented.
- List renaming continues to use the existing Name field. List duplication copies members through the existing mechanism, not the automatic policy; configure the duplicated list explicitly.

## Verification

Focused backend tests cover invalid groups, read-only preview, stopped policies, authorized-workspace list lookup, and existing administrator authorization. UI test covers preview-before-apply, invalidation when changing group, and list-only API requests. Both application type checks pass.

Local integration verification uses a temporary list and contact, checks preview has no writes, repeated application creates no duplicate members, and checks scheduled removal/re-addition after group changes. Fixtures are removed afterward. Never send a campaign as part of this test.

Verified locally: 14 backend tests and one UI test passed. Live API/database checks passed for read-only preview, idempotent application, scheduled removal after leaving the group, scheduled re-entry without duplicates, stopping updates while retaining members, and preserving paused source sync. The temporary list/contact/policy were removed afterward.

Commands (inside the existing app container, rooted at `/workspace` unless stated):

```sh
node_modules/.bin/jest packages/twenty-server/src/modules/customer-sync/customer-list-audience.service.spec.ts packages/twenty-server/src/modules/customer-sync/customer-sync-authorization.spec.ts --config=packages/twenty-server/jest.config.mjs --runInBand
node_modules/.bin/jest packages/twenty-front/src/modules/activities/emails/components/__tests__/CustomerGroupListAudience.test.tsx --config=packages/twenty-front/jest.config.mjs --runInBand
# In each of packages/twenty-server and packages/twenty-front:
/workspace/node_modules/.bin/tsgo --noEmit
# In each package, restricted to the changed source/test files:
/workspace/node_modules/.bin/oxlint --type-aware -c .oxlintrc.json <changed-files>
# At repo root, restricted to the changed source/test files:
node_modules/.bin/oxfmt --check <changed-files>
```

Type checks, targeted Oxlint checks, formatting, and `git diff --check` passed. An initial ESLint attempt could not run because ESLint is not installed; the project uses Oxlint. Initial frontend lint reported CSS declaration ordering and a relative test import; both were corrected and the configured lint then passed.
