import { Injectable } from '@nestjs/common';

import { createHash } from 'node:crypto';

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { v5 as uuidV5 } from 'uuid';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

import { CustomerSyncConfig } from './customer-sync.config';
import {
  CUSTOMER_GROUPS,
  CUSTOMER_SYNC_RULE_VERSION,
  type CustomerClassification,
  type SourceMember,
  type SyncOutcome,
} from './customer-sync.types';
import { reconcileGroups } from './classify-customer';
import { CustomerSyncStoreService } from './customer-sync-store.service';
import { registrationIdentityHash } from './prepare-registrations';
import { testAccountReasons } from './test-account-filter';

type SyncPerson = PersonWorkspaceEntity &
  Record<string, unknown> & {
    memberId: number | null;
    customerGroups: string[] | null;
  };
type MetadataField = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isUnique?: boolean;
  options?: {
    id?: string;
    value: string;
    label: string;
    position: number;
    color: string;
  }[];
};
const NEW_FIELDS = [
  ['registrationDate', 'Registration Date', 'DATE_TIME'],
  ['sourceRegistrationKey', 'Source Registration Key', 'TEXT'],
  ['customerGroups', 'Customer Groups', 'MULTI_SELECT'],
  ['accountState', 'Account State', 'TEXT'],
  ['membershipState', 'Membership State', 'TEXT'],
  ['paymentState', 'Payment State', 'TEXT'],
  ['paymentProvider', 'Payment Provider', 'TEXT'],
  ['platform', 'Platform', 'TEXT'],
  ['nextPaymentDate', 'Next Payment Date', 'DATE_TIME'],
  ['accessValidUntil', 'Access Valid Until', 'DATE_TIME'],
  ['lastSyncedAt', 'Last Synced At', 'DATE_TIME'],
] as const;
const EXISTING_FIELDS = {
  memberId: 'NUMBER',
  name: 'FULL_NAME',
  emails: 'EMAILS',
  phones: 'PHONES',
  addressCustom: 'TEXT',
  gender: 'TEXT',
  genderOther: 'TEXT',
  city: 'TEXT',
  country: 'TEXT',
  userType: 'NUMBER',
  isVerified: 'NUMBER',
  status: 'NUMBER',
  isFreeAccess: 'NUMBER',
  deviceType: 'TEXT',
};

@Injectable()
export class CustomerSyncTargetService {
  constructor(
    private readonly configuration: CustomerSyncConfig,
    private readonly tokenService: AccessTokenService,
    private readonly orm: WorkspaceOrmManager,
    private readonly store: CustomerSyncStoreService,
  ) {}

  async metadata<TResult>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<TResult> {
    const configuration = this.configuration.require();
    const { token } = await this.tokenService.generateAccessToken({
      userId: configuration.serviceUserId,
      workspaceId: configuration.workspaceId,
      authProvider: AuthProviderEnum.Password,
    });
    const response = await fetch(`${configuration.targetUrl}/metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(60000),
    });
    const result = (await response.json()) as {
      data?: TResult;
      errors?: unknown[];
    };

    if (!response.ok || result.errors?.length || !result.data)
      throw new Error('TARGET_METADATA_REQUEST_FAILED');

    return result.data;
  }

  async validateFields(
    createMissing = false,
  ): Promise<{ objectId: string; fields: MetadataField[] }> {
    const objects = await this.metadata<{
      objects: { edges: { node: { id: string; nameSingular: string } }[] };
    }>(
      'query { objects(paging: { first: 100 }) { edges { node { id nameSingular } } } }',
    );
    const objectId = objects.objects.edges.find(
      ({ node }) => node.nameSingular === 'person',
    )?.node.id;

    if (!objectId) throw new Error('PEOPLE_OBJECT_MISSING');
    const readFields = async () => {
      const result = await this.metadata<{
        fields: { edges: { node: MetadataField }[] };
      }>(
        'query($id: UUID!) { fields(filter: {objectMetadataId: {eq: $id}}, paging: {first: 200}) { edges { node { id name type isActive isUnique options } } } }',
        { id: objectId },
      );

      return result.fields.edges.map(({ node }) => node);
    };
    let fields = await readFields();

    for (const [name, expected] of Object.entries(EXISTING_FIELDS)) {
      if (
        !fields.some(
          (field) =>
            field.name === name && field.type === expected && field.isActive,
        )
      )
        throw new Error('EXISTING_CONTACT_FIELDS_INVALID');
    }
    for (const [name, label, type] of NEW_FIELDS) {
      const existing = fields.find((field) => field.name === name);

      if (existing) {
        if (existing.type !== type || !existing.isActive)
          throw new Error('SYNC_FIELD_TYPE_INVALID');
      } else if (createMissing) {
        await this.metadata(
          'mutation($input: CreateOneFieldMetadataInput!) { createOneField(input: $input) { id } }',
          {
            input: {
              field: {
                objectMetadataId: objectId,
                name,
                label,
                type,
                icon: 'IconRefresh',
                isLabelSyncedWithName: true,
                description: 'Managed by vShowcards customer sync.',
                ...(type === 'MULTI_SELECT'
                  ? {
                      options: Object.entries(CUSTOMER_GROUPS).map(
                        ([value, optionLabel], position) => ({
                          value,
                          label: optionLabel,
                          position,
                          color: 'blue',
                        }),
                      ),
                    }
                  : {}),
              },
            },
          },
        );
      } else throw new Error('SYNC_FIELDS_NOT_INITIALIZED');
    }
    if (createMissing) fields = await readFields();
    const groupField = fields.find((field) => field.name === 'customerGroups');
    const missingOptions = Object.entries(CUSTOMER_GROUPS).filter(
      ([value]) =>
        !groupField?.options?.some((option) => option.value === value),
    );
    if (createMissing && groupField && missingOptions.length) {
      const existingOptions = groupField.options ?? [];
      const nextPosition =
        Math.max(-1, ...existingOptions.map((option) => option.position)) + 1;
      await this.metadata(
        'mutation($input: UpdateOneFieldMetadataInput!) { updateOneField(input: $input) { id } }',
        {
          input: {
            id: groupField.id,
            update: {
              options: [
                ...existingOptions,
                ...missingOptions.map(([value, label], index) => ({
                  value,
                  label,
                  position: nextPosition + index,
                  color: 'blue',
                })),
              ],
            },
          },
        },
      );
    }
    for (const identityName of ['memberId', 'sourceRegistrationKey']) {
      const identityField = fields.find((field) => field.name === identityName);

      if (!identityField?.isUnique) {
        if (!createMissing || !identityField)
          throw new Error('MEMBER_ID_MUST_BE_UNIQUE');
        await this.metadata(
          'mutation($input: UpdateOneFieldMetadataInput!) { updateOneField(input: $input) { id } }',
          {
            input: { id: identityField.id, update: { isUnique: true } },
          },
        );
      }
    }
    if (createMissing) fields = await readFields();
    if (!fields.find((field) => field.name === 'memberId')?.isUnique)
      throw new Error('MEMBER_ID_MUST_BE_UNIQUE');
    const options =
      fields.find((field) => field.name === 'customerGroups')?.options ?? [];

    if (
      Object.keys(CUSTOMER_GROUPS).some(
        (value) => !options.some((option) => option.value === value),
      )
    )
      throw new Error('SYNC_GROUP_OPTIONS_MISSING');

    return { objectId, fields };
  }

  async withPeople<TResult>(
    callback: (
      people: ReturnType<WorkspaceOrmManager['getRepository']>,
    ) => Promise<TResult>,
  ): Promise<TResult> {
    return this.orm.executeInWorkspaceContext(
      async () =>
        callback(
          this.orm.getRepository(
            'person',
            { shouldBypassPermissionChecks: true },
            { shouldSkipEventEmission: true },
          ),
        ),
      buildSystemAuthContext(this.configuration.require().workspaceId),
    );
  }

  async prepareViews(objectId: string, fields: MetadataField[]) {
    const workspaceId = this.configuration.require().workspaceId;
    const groupField = fields.find((field) => field.name === 'customerGroups');

    if (!groupField) throw new Error('SYNC_GROUP_FIELD_MISSING');
    for (const [value, label] of Object.entries(CUSTOMER_GROUPS)) {
      const viewId = uuidV5(`vshowcards/group-view/${value}`, workspaceId);
      const { getView } = await this.metadata<{
        getView: { id: string } | null;
      }>('query($id: String!) { getView(id: $id) { id } }', { id: viewId });

      if (!getView)
        await this.metadata(
          'mutation($input: CreateViewInput!) { createView(input: $input) { id } }',
          {
            input: {
              id: viewId,
              name: label,
              objectMetadataId: objectId,
              type: 'TABLE',
              icon: 'IconUsers',
              visibility: 'WORKSPACE',
            },
          },
        );
      const filterId = uuidV5(`vshowcards/group-filter/${value}`, workspaceId);
      const { getViewFilter } = await this.metadata<{
        getViewFilter: { id: string } | null;
      }>('query($id: String!) { getViewFilter(id: $id) { id } }', {
        id: filterId,
      });

      if (!getViewFilter)
        await this.metadata(
          'mutation($input: CreateViewFilterInput!) { createViewFilter(input: $input) { id } }',
          {
            input: {
              id: filterId,
              viewId,
              fieldMetadataId: groupField.id,
              operand: 'CONTAINS',
              value: [value],
            },
          },
        );
      const { getViewFields } = await this.metadata<{
        getViewFields: { fieldMetadataId: string }[];
      }>(
        'query($id: String!) { getViewFields(viewId: $id) { fieldMetadataId } }',
        { id: viewId },
      );
      const columns = [
        'name',
        'emails',
        'memberId',
        'customerGroups',
        'membershipState',
        'accessValidUntil',
        'registrationDate',
      ];
      const missing = columns.flatMap((name, position) => {
        const field = fields.find((item) => item.name === name);

        return field &&
          !getViewFields.some((item) => item.fieldMetadataId === field.id)
          ? [
              {
                id: uuidV5(
                  `vshowcards/group-column/${value}/${name}`,
                  workspaceId,
                ),
                viewId,
                fieldMetadataId: field.id,
                isVisible: true,
                size: 180,
                position,
              },
            ]
          : [];
      });

      if (missing.length)
        await this.metadata(
          'mutation($inputs: [CreateViewFieldInput!]!) { createManyViewFields(inputs: $inputs) { id } }',
          { inputs: missing },
        );
    }
  }

  async reconcile(
    member: SourceMember,
    state: CustomerClassification,
    dryRun: boolean,
  ): Promise<SyncOutcome> {
    const configuration = this.configuration.require();
    const registration = member.registration;
    const registrationKey =
      registration?.key ?? registrationIdentityHash(member.email);
    const mappingKey = registration
      ? `registration:${registrationKey}`
      : `member:${member.member_id}`;
    const base: SyncOutcome = {
      memberId: registration ? null : member.member_id,
      ...(registration
        ? { sourceKey: registration.references.join(', ') }
        : {}),
      outcome: 'review',
      groups: state.groups,
      added: [],
      removed: [],
      issues: [...state.issues],
    };

    const exclusions = [
      ...new Set([
        ...testAccountReasons(member),
        ...(registration?.exclusionReasons ?? []),
      ]),
    ];
    if (exclusions.length)
      return {
        ...base,
        outcome: 'skipped',
        groups: [],
        issues: ['EXCLUDED_TEST_ACCOUNT', ...exclusions],
      };

    return this.withPeople(async (repository) => {
      const readVersioned = async (where: Record<string, unknown>) => {
        // Read the exact database version with the entity in one snapshot.
        // JavaScript Date would discard PostgreSQL's microseconds.
        const { entities, raw } = await repository
          .createQueryBuilder('person')
          .addSelect('"person"."updatedAt"::text', 'syncVersion')
          .where(where)
          .withDeleted()
          .getRawAndEntities<SyncPerson>();
        return entities.map((entity, index) => ({
          ...entity,
          syncVersion: raw[index].syncVersion,
        }));
      };
      const matches = await readVersioned(
        registration
          ? { sourceRegistrationKey: registrationKey }
          : { memberId: member.member_id },
      );
      const mapping = await this.store.get<{
        contactId: string;
        confirmed: boolean;
        usernameHash?: string;
      }>(configuration.workspaceId, mappingKey);
      let current = matches[0] as SyncPerson | undefined;
      if (
        registration &&
        mapping &&
        mapping.usernameHash !== registrationIdentityHash(member.username)
      )
        return { ...base, issues: ['REGISTRATION_IDENTITY_REQUIRES_REVIEW'] };

      if (!registration && !current && member.status !== -1) {
        const pending = await readVersioned({
          sourceRegistrationKey: registrationKey,
        });
        if (pending.length > 1)
          return { ...base, issues: ['DUPLICATE_REGISTRATION_IDENTITY'] };
        if (pending.length) {
          const identity = await this.store.get<{
            contactId: string;
            usernameHash: string;
          }>(configuration.workspaceId, `registration:${registrationKey}`);
          if (
            !identity ||
            identity.contactId !== pending[0].id ||
            identity.usernameHash !==
              registrationIdentityHash(member.username) ||
            pending[0].memberId
          )
            return {
              ...base,
              issues: ['REGISTRATION_PROMOTION_REQUIRES_REVIEW'],
            };
          current = pending[0] as SyncPerson;
        }
      }

      if (matches.length > 1)
        return { ...base, issues: ['DUPLICATE_MEMBER_ID'] };
      if (current?.deletedAt) return { ...base, issues: ['CONTACT_IN_TRASH'] };
      base.registrationManaged = Boolean(current?.sourceRegistrationKey);
      if (registration && current?.memberId)
        return {
          ...base,
          outcome: 'skipped',
          issues: ['REGISTRATION_ALREADY_CONVERTED'],
        };
      if (
        mapping &&
        (!current || current.id !== mapping.contactId) &&
        mapping.confirmed
      )
        return { ...base, issues: ['MAPPED_CONTACT_MISSING_OR_CHANGED'] };
      if (member.status === -1 && !current)
        return { ...base, outcome: 'skipped', issues: [] };
      const promoting =
        !registration &&
        current &&
        !current.memberId &&
        current.sourceRegistrationKey === registrationKey;
      const paymentReviewOnly =
        !registration &&
        configuration.importPaymentReviewContacts === true &&
        base.issues.every((issue) =>
          [
            'PAYMENT_IDENTITY_INCOMPLETE',
            'PAYMENT_DATE_INVALID',
            'PAYMENT_STREAM_REQUIRES_REVIEW',
            'REFUND_OR_REVOCATION_REQUIRES_REVIEW',
            'PAYMENT_EVENT_ORDER_REQUIRES_REVIEW',
            'UNKNOWN_PAYMENT_STATUS',
            'MULTIPLE_SUBSCRIPTION_STATES_REQUIRES_REVIEW',
            'AMBIGUOUS_SUBSCRIPTION_USERNAME',
            'SUBSCRIPTION_WITHOUT_MATCHED_ORDERS',
            'AMBIGUOUS_PAYMENT_OWNER',
            'UNMATCHED_PAYMENT_USERNAME',
          ].includes(issue),
        );
      if (base.issues.length && !promoting && !paymentReviewOnly) return base;
      if ((promoting || paymentReviewOnly) && base.issues.length) {
        state = {
          ...state,
          groups: state.groups.filter(
            (group) =>
              ['WEB', 'APPLE', 'ANDROID', 'INACTIVE'].includes(group) ||
              (group === 'GOOGLE_SUBSCRIBER' &&
                member.device_type?.trim().toLowerCase() === 'google'),
          ),
          membershipState: 'Needs Review',
          paymentState: 'Needs Review',
          paymentProvider: '',
          nextPaymentDate: null,
          accessValidUntil: null,
        };
        base.groups = state.groups;
      }
      if (
        !Number.isSafeInteger(member.member_id) ||
        (!registration && member.member_id < 1) ||
        !member.username ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email.trim())
      )
        return { ...base, issues: ['INVALID_SOURCE_IDENTITY'] };
      if (
        !member.joined_seconds ||
        !Number.isFinite(Number(member.joined_seconds)) ||
        !Number.isFinite(
          new Date(Number(member.joined_seconds) * 1000).getTime(),
        )
      )
        return { ...base, issues: ['SOURCE_SIGNUP_DATE_INVALID'] };

      if (!current) {
        // Never silently take over a manually entered contact or its history.
        const emailMatches = await repository.find({
          where: {
            emails: { primaryEmail: member.email.trim().toLowerCase() },
          },
          withDeleted: true,
        });

        if (emailMatches.length)
          return {
            ...base,
            issues: ['EMAIL_ALREADY_EXISTS_WITHOUT_THIS_MEMBER_ID'],
          };
      }
      const phoneText = (member.telephone ?? '').trim();
      const phone = phoneText.startsWith('+')
        ? parsePhoneNumberFromString(phoneText)
        : undefined;

      if (phoneText && !phone?.isValid())
        return { ...base, issues: ['PHONE_NEEDS_COUNTRY_OR_CORRECTION'] };
      const groupDiff = reconcileGroups(
        current?.customerGroups ?? [],
        state.groups,
      );
      const additionalGroups = (current?.customerGroups ?? []).filter(
        (value) => !(value in CUSTOMER_GROUPS),
      );
      const groups = [
        ...new Set([...groupDiff.values, ...additionalGroups]),
      ].sort();
      const desired: Record<string, unknown> =
        member.status === -1
          ? {
              status: -1,
              accountState: 'Source Deleted',
              customerGroups: groups,
            }
          : {
              memberId: registration ? null : member.member_id,
              registrationDate: new Date(
                Number(member.joined_seconds) * 1000,
              ).toISOString(),
              ...(registration
                ? { sourceRegistrationKey: registrationKey }
                : {}),
              name: { firstName: member.full_name, lastName: '' },
              emails: {
                ...current?.emails,
                primaryEmail: member.email.trim().toLowerCase(),
                additionalEmails: current?.emails?.additionalEmails ?? [],
              },
              phones: {
                ...current?.phones,
                primaryPhoneNumber: phone?.nationalNumber ?? '',
                primaryPhoneCallingCode: phone
                  ? `+${phone.countryCallingCode}`
                  : '',
                primaryPhoneCountryCode: phone?.country ?? '',
                additionalPhones: current?.phones?.additionalPhones ?? [],
              },
              addressCustom: member.address ?? '',
              gender: member.gender ?? '',
              genderOther: member.gender_other ?? '',
              city: member.city ?? '',
              country: member.country ?? '',
              userType: member.user_type,
              isVerified: member.isverify,
              status: member.status,
              isFreeAccess: member.is_free_access,
              deviceType: member.device_type ?? '',
              accountState: state.accountState,
              membershipState: state.membershipState,
              paymentState: state.paymentState,
              paymentProvider: state.paymentProvider,
              platform: state.platform,
              nextPaymentDate: state.nextPaymentDate,
              accessValidUntil: state.accessValidUntil,
              customerGroups: groups,
            };
      if (registration) {
        // These facts do not exist in temporary tables. Preserve CRM enrichment.
        for (const key of [
          'phones',
          'addressCustom',
          'gender',
          'genderOther',
          'city',
          'country',
          'userType',
          'isVerified',
          'status',
          'isFreeAccess',
        ])
          delete desired[key];
      }
      const changed = Object.entries(desired).some(
        ([key, value]) => !sameValue(current?.[key], value),
      );
      const outcome: SyncOutcome = {
        ...base,
        outcome: !current ? 'created' : changed ? 'updated' : 'unchanged',
        added: groupDiff.added,
        removed: groupDiff.removed.filter((value) => value in CUSTOMER_GROUPS),
        contactId: current?.id,
      };

      if (dryRun) return outcome;
      if (
        !(
          configuration.writeRegistrations &&
          (registration || base.registrationManaged)
        ) &&
        !(configuration.writeAllMembers && !registration) &&
        !configuration.writeMemberIds.includes(member.member_id)
      )
        return { ...base, outcome: 'skipped', issues: ['OUTSIDE_LOCAL_PILOT'] };
      if (
        !current &&
        (!member.joined_seconds ||
          !Number.isFinite(Number(member.joined_seconds)))
      )
        return { ...base, issues: ['SOURCE_SIGNUP_DATE_INVALID'] };
      const contactId =
        current?.id ??
        mapping?.contactId ??
        uuidV5(
          registration
            ? `vshowcards/registration/${registrationKey}`
            : `vshowcards/member/${member.member_id}`,
          configuration.workspaceId,
        );

      if (!mapping)
        await this.store.set(configuration.workspaceId, mappingKey, {
          contactId,
          confirmed: Boolean(current),
          ...(registration
            ? { usernameHash: registrationIdentityHash(member.username) }
            : {}),
        });
      if (changed) {
        const update = { ...desired, lastSyncedAt: new Date().toISOString() };

        if (current)
          await repository.update(
            { id: contactId, updatedAt: current.syncVersion },
            update,
          );
        else
          await repository.insert({
            ...update,
            id: contactId,
            createdAt: new Date(
              Number(member.joined_seconds) * 1000,
            ).toISOString(),
          });
      }
      const stored = await repository.findOne({ where: { id: contactId } });

      if (
        !stored ||
        Object.entries(desired).some(
          ([key, value]) => !sameValue(stored[key], value),
        )
      )
        throw new Error('CONTACT_WRITE_NOT_VERIFIED');
      await this.store.set(configuration.workspaceId, mappingKey, {
        contactId,
        confirmed: true,
        ...(registration
          ? { usernameHash: registrationIdentityHash(member.username) }
          : {}),
        ruleVersion: CUSTOMER_SYNC_RULE_VERSION,
        sourceFingerprint: createHash('sha256')
          .update(JSON.stringify({ member, state }))
          .digest('hex'),
      });

      return { ...outcome, contactId };
    });
  }
}

const sameValue = (left: unknown, right: unknown): boolean => {
  const canonical = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );

    return value;
  };

  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
};
