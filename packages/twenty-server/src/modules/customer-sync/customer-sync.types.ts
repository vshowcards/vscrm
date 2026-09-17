export const CUSTOMER_SYNC_RULE_VERSION = '2026-09-16.2';

export const CUSTOMER_GROUPS = {
  TRIED_REGISTER: 'Tried Register',
  FREE: 'Free User',
  PAID: 'Paid User',
  PAYMENT_ACTIVE: 'Payment Active',
  PAYMENT_FAILED: 'Payment Failed',
  PAYMENT_CANCELLED: 'Payment Cancelled',
  LAPSED: 'Lapsed User',
  COMPLIMENTARY: 'Complimentary User',
  INACTIVE: 'Inactive User',
  WEB: 'Web User',
  APPLE: 'Apple User',
  ANDROID: 'Android User',
  GOOGLE_SUBSCRIBER: 'Google Payment Subscriber',
  SOURCE_DELETED: 'Source Deleted',
} as const;

export type CustomerGroup = keyof typeof CUSTOMER_GROUPS;
export type SourceMember = {
  sourceIssues?: string[];
  registration?: {
    key: string;
    references: string[];
    groups: CustomerGroup[];
    issues: string[];
    exclusionReasons?: string[];
  };
  member_id: number;
  username: string;
  full_name: string;
  email: string;
  telephone: string | null;
  address: string | null;
  gender: string | null;
  gender_other: string | null;
  city: string | null;
  country: string | null;
  user_type: number;
  isverify: number;
  status: number;
  is_free_access: number;
  free_access_till_date: string | null;
  device_type: string | null;
  joined_seconds: number | null;
};

export type SourceOrder = {
  subscription_key?: string | null;
  next_payment_date_validity?: 'valid' | 'null' | 'zero' | 'invalid';
  order_id: number;
  username: string | null;
  payment_gateway_type: string;
  recurring_payment_id: string | null;
  txn_type: string | null;
  payment_type: string | null;
  payment_status: string | null;
  txn_profile_status: string | null;
  next_seconds: number | null;
};

export type SourceSnapshot = {
  sourceTimezone?: string;
  registrations?: SourceRegistration[];
  members: SourceMember[];
  orders: SourceOrder[];
  subscriptions: {
    subscription_key?: string | null;
    username: string;
    subscription_id: string;
    payment_gateway_type: string;
  }[];
  readAt: string;
};

export type CustomerClassification = {
  groups: CustomerGroup[];
  accountState: string;
  membershipState: string;
  paymentState: string;
  paymentProvider: string;
  platform: string;
  accessValidUntil: string | null;
  nextPaymentDate: string | null;
  issues: string[];
};

export type SyncOutcome = {
  registrationManaged?: boolean;
  memberId: number | null;
  sourceKey?: string;
  outcome:
    | 'created'
    | 'updated'
    | 'unchanged'
    | 'skipped'
    | 'review'
    | 'failed';
  groups: string[];
  added: string[];
  removed: string[];
  issues: string[];
  contactId?: string;
};

export type SourceRegistration = {
  source: 'web' | 'app';
  id: number;
  username: string;
  full_name: string;
  email: string;
  device_type: string | null;
  joined_seconds: number | null;
};

export type SyncRun = {
  id: string;
  workspaceId: string;
  actorId: string;
  mode: 'preview' | 'member' | 'incremental' | 'full' | 'retry';
  memberIds?: number[];
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'completed-with-errors'
    | 'failed';
  ruleVersion: string;
  startedAt: string;
  finishedAt?: string;
  sourceReadAt?: string;
  error?: string;
  unmatchedOrders?: number;
  results: SyncOutcome[];
};
