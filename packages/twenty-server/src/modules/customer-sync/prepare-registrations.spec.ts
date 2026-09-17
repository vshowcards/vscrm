import {
  prepareRegistrations,
  classifyRegistration,
} from './prepare-registrations';
import {
  type SourceSnapshot,
  type SourceRegistration,
  type SourceMember,
} from './customer-sync.types';

const row: SourceRegistration = {
  source: 'web',
  id: 1,
  username: 'example',
  full_name: 'Example',
  email: 'example@example.test',
  device_type: 'web',
  joined_seconds: 1700000000,
};
const snapshot = (registrations: SourceRegistration[]): SourceSnapshot => ({
  members: [],
  orders: [],
  subscriptions: [],
  registrations,
  readAt: '',
});

describe('registration preparation', () => {
  it('retains test evidence from any repeated attempt without removing identity evidence', () => {
    const prepared = prepareRegistrations(
      snapshot([
        { ...row, email: 'person@example.edu', full_name: 'Alex Reece' },
        {
          ...row,
          email: 'person@example.edu',
          id: 2,
          full_name: 'FlowTest2',
          joined_seconds: 1800000000,
        },
      ]),
    );
    expect(prepared).toHaveLength(1);
    expect(prepared[0].full_name).toBe('Alex Reece');
    expect(prepared[0].registration?.exclusionReasons).toContain(
      'TEST_ACCOUNT_NAME',
    );
  });
  it('includes both historical and immediate attempts without a waiting period', () => {
    expect(
      prepareRegistrations(
        snapshot([
          row,
          {
            ...row,
            id: 2,
            email: 'new@example.test',
            joined_seconds: Date.now() / 1000,
          },
        ]),
      ),
    ).toHaveLength(2);
  });
  it('deduplicates repeated web/app attempts and keeps their earliest date and platforms', () => {
    const members = prepareRegistrations(
      snapshot([
        row,
        {
          ...row,
          id: 2,
          email: ' EXAMPLE@example.test ',
          source: 'app',
          device_type: 'apple',
          joined_seconds: 1800000000,
        },
      ]),
    );
    expect(members).toHaveLength(1);
    expect(members[0].joined_seconds).toBe(1700000000);
    expect(classifyRegistration(members[0]).groups).toEqual([
      'TRIED_REGISTER',
      'WEB',
      'APPLE',
    ]);
  });
  it('excludes old attempts belonging to members, including deleted members', () => {
    const source = snapshot([row]);
    source.members = [
      { email: row.email, username: row.username, status: -1 } as SourceMember,
    ];
    expect(prepareRegistrations(source)).toEqual([]);
  });
  it('holds conflicting usernames and invalid dates', () => {
    const member = prepareRegistrations(
      snapshot([row, { ...row, username: 'different', joined_seconds: null }]),
    )[0];
    expect(member.registration?.issues).toEqual(
      expect.arrayContaining([
        'REGISTRATION_IDENTITY_REQUIRES_REVIEW',
        'SOURCE_SIGNUP_DATE_INVALID',
      ]),
    );
  });
  it('does not imply a paid subscription for an incomplete Google attempt', () => {
    const member = prepareRegistrations(
      snapshot([{ ...row, source: 'app', device_type: 'google' }]),
    )[0];
    expect(classifyRegistration(member).groups).toEqual([
      'TRIED_REGISTER',
      'ANDROID',
    ]);
    expect(classifyRegistration(member).paymentState).toBe('Not Completed');
  });
});
