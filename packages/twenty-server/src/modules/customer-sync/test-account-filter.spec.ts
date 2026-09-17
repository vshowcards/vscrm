import { testAccountReasons } from './test-account-filter';

describe('test account exclusion', () => {
  it.each(['Test', 'UUIDtest2', 'AnnaTester', 'FlowTester3', 'TESTIOS6'])(
    'excludes the approved name substring: %s',
    (full_name) => {
      expect(
        testAccountReasons({ full_name, email: 'person@gmail.com' }),
      ).toContain('TEST_ACCOUNT_NAME');
    },
  );

  it.each([
    'testuser@gmail.com',
    'alex+test@gmail.com',
    'qa.test12@gmail.com',
    'flowtest2@gmail.com',
    'dummy123@gmail.com',
    'person@example.com',
    'person@internal.test',
  ])('excludes explicit test/placeholder email %s', (email) => {
    expect(
      testAccountReasons({ full_name: 'Alex Reece', email }).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    'alex@gmail.com',
    'contestwinner@gmail.com',
    'latestnews@gmail.com',
    'democrat@gmail.com',
    'admin@vshowcards.com',
  ])('keeps ordinary and staff addresses: %s', (email) => {
    expect(testAccountReasons({ full_name: 'Alex Reece', email })).toEqual([]);
  });
});
