import { createHash } from 'node:crypto';

import { testAccountReasons } from './test-account-filter';

import {
  type CustomerClassification,
  type CustomerGroup,
  type SourceMember,
  type SourceSnapshot,
} from './customer-sync.types';

export const normalizeRegistrationIdentity = (value: string) =>
  value.trim().toLowerCase();
export const registrationIdentityHash = (value: string) =>
  createHash('sha256')
    .update(normalizeRegistrationIdentity(value))
    .digest('hex');

export const prepareRegistrations = (
  snapshot: SourceSnapshot,
): SourceMember[] => {
  const memberEmails = new Set(
    snapshot.members.map((member) =>
      normalizeRegistrationIdentity(member.email),
    ),
  );
  const memberUsernames = new Set(
    snapshot.members.map((member) =>
      normalizeRegistrationIdentity(member.username),
    ),
  );
  const byEmail = new Map<
    string,
    NonNullable<SourceSnapshot['registrations']>
  >();

  for (const row of snapshot.registrations ?? []) {
    const email = normalizeRegistrationIdentity(row.email);
    const rows = byEmail.get(email) ?? [];
    rows.push(row);
    byEmail.set(email, rows);
  }

  return [...byEmail.entries()].flatMap(([email, rows]) => {
    // Old attempts remain in the app table; a current member always wins.
    if (memberEmails.has(email)) return [];
    const issues: string[] = [];
    const usernames = new Set(
      rows.map((row) => normalizeRegistrationIdentity(row.username)),
    );
    if (
      usernames.size !== 1 ||
      [...usernames].some((username) => memberUsernames.has(username))
    )
      issues.push('REGISTRATION_IDENTITY_REQUIRES_REVIEW');
    const groups = new Set<CustomerGroup>(['TRIED_REGISTER']);
    for (const row of rows) {
      const device = (row.device_type ?? '').trim().toLowerCase();
      if (row.source === 'web') groups.add('WEB');
      else if (device === 'apple') groups.add('APPLE');
      else if (device === 'android' || device === 'google')
        groups.add('ANDROID');
      else issues.push('REGISTRATION_PLATFORM_UNKNOWN');
    }
    // Keep the first known attempt date across repeated web/app attempts.
    const sorted = [...rows].sort(
      (left, right) =>
        Number(left.joined_seconds) - Number(right.joined_seconds) ||
        left.id - right.id,
    );
    const first = sorted[0];
    if (
      rows.some(
        (row) =>
          !row.joined_seconds || !Number.isFinite(Number(row.joined_seconds)),
      )
    )
      issues.push('SOURCE_SIGNUP_DATE_INVALID');

    return [
      {
        // Temporary records have no Member ID; zero never enters CRM or reports.
        member_id: 0,
        registration: {
          key: registrationIdentityHash(email),
          references: rows.map((row) => `${row.source}:${row.id}`).sort(),
          groups: [...groups],
          issues: [...new Set(issues)],
          exclusionReasons: [...new Set(rows.flatMap(testAccountReasons))],
        },
        username: first.username,
        full_name: first.full_name,
        email,
        joined_seconds: first.joined_seconds,
        device_type: first.source === 'web' ? 'web' : first.device_type,
        telephone: null,
        address: null,
        gender: null,
        gender_other: null,
        city: null,
        country: null,
        user_type: 0,
        isverify: 0,
        status: 0,
        is_free_access: 0,
        free_access_till_date: null,
      },
    ];
  });
};

export const classifyRegistration = (
  member: SourceMember,
): CustomerClassification => ({
  groups: member.registration?.groups ?? [],
  issues: member.registration?.issues ?? [
    'REGISTRATION_IDENTITY_REQUIRES_REVIEW',
  ],
  accountState: 'Not Registered',
  membershipState: 'Not Registered',
  paymentState: 'Not Completed',
  paymentProvider: '',
  platform: (member.registration?.groups ?? [])
    .filter((group) => group !== 'TRIED_REGISTER')
    .join(', '),
  accessValidUntil: null,
  nextPaymentDate: null,
});
