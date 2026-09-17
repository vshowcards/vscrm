export const testAccountReasons = (contact: {
  full_name: string;
  email: string;
}): string[] => {
  const name = contact.full_name.trim().toLowerCase();
  const email = contact.email.trim().toLowerCase();
  const [localPart, domain = ''] = email.split('@');
  const reasons: string[] = [];

  if (name.includes('test')) reasons.push('TEST_ACCOUNT_NAME');
  if (/^(demo|dummy|sample)(\s+(user|account|person))?\d*$/.test(name))
    reasons.push('TEST_ACCOUNT_PLACEHOLDER_NAME');
  if (
    /^test/.test(localPart) ||
    /(?:^|[._+\-])(?:test(?:ing|er)?|demo|dummy|sample)(?:$|[._+\-\d])/.test(
      localPart,
    ) ||
    /test\d+$/.test(localPart)
  )
    reasons.push('TEST_ACCOUNT_EMAIL');
  if (
    /(?:^|\.)example\.(?:com|net|org)$/.test(domain) ||
    domain === 'localhost' ||
    /\.(?:test|invalid|example)$/.test(domain) ||
    /^(?:test|invalid|example)$/.test(domain)
  )
    reasons.push('TEST_ACCOUNT_RESERVED_DOMAIN');
  return reasons;
};
