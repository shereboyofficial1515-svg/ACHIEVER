export const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  COMPLIANCE_ADMIN: 'COMPLIANCE_ADMIN',
  FINANCE_ADMIN: 'FINANCE_ADMIN',
  DISPUTE_ADMIN: 'DISPUTE_ADMIN',
  SECURITY_ADMIN: 'SECURITY_ADMIN',
  SUPPORT_ADMIN: 'SUPPORT_ADMIN',
  AUDITOR: 'AUDITOR',
  READ_ONLY_ADMIN: 'READ_ONLY_ADMIN',
  OSUSU_ADMIN: 'OSUSU_ADMIN',
  OSUSU_MEMBER: 'OSUSU_MEMBER',
  COLLECTOR: 'COLLECTOR',
  SAVER: 'SAVER',
});

// Platform staff. What each role may do is defined by role_permissions in the
// database (least privilege); code checks permissions, not role names.
export const STAFF_ROLES = [
  ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COMPLIANCE_ADMIN, ROLES.FINANCE_ADMIN, ROLES.DISPUTE_ADMIN,
  ROLES.SECURITY_ADMIN, ROLES.SUPPORT_ADMIN, ROLES.AUDITOR, ROLES.READ_ONLY_ADMIN,
];
export const ALL_ROLES = Object.values(ROLES);
export const OPERATOR_ROLES = [ROLES.OSUSU_ADMIN, ROLES.COLLECTOR];
export const SELF_SERVICE_ROLES = [ROLES.OSUSU_ADMIN, ROLES.OSUSU_MEMBER, ROLES.COLLECTOR, ROLES.SAVER];

// Onboarding step 1 + 2 → granted roles. The organiser of an Osusu group can
// also participate as a member; "personal" users can join groups and save.
export const REGISTRATION_ROLE_MAP = Object.freeze({
  'osusu:organizer': [ROLES.OSUSU_ADMIN, ROLES.OSUSU_MEMBER],
  'osusu:member': [ROLES.OSUSU_MEMBER],
  'collector:collector': [ROLES.COLLECTOR],
  'collector:saver': [ROLES.SAVER],
  'personal:personal': [ROLES.OSUSU_MEMBER, ROLES.SAVER],
});

export const COOKIES = Object.freeze({
  access: 'ach_at',
  refresh: 'ach_rt',
  session: 'ach_ss',
  csrf: 'ach_csrf',
  device: 'ach_did',
});

// Minimum KYC level per activity (overridable via app_settings kyc.required_levels).
export const KYC_ACTIVITIES = Object.freeze({ contribute: 1, receive_payout: 2, withdraw: 2, operator: 2 });

export const ID_TYPES = ['bvn', 'nin', 'passport', 'drivers_licence', 'voters_card'];


export const LOGIN_LOCK = Object.freeze({ maxFailures: 5, lockMinutes: 15 });

export const OTP = Object.freeze({ length: 6, ttlMinutes: 10, maxAttempts: 5, resendCooldownSeconds: 60 });

export const INVITE_TTL_DAYS = 14;

export const UPLOAD_LIMITS = Object.freeze({
  avatar: { maxBytes: 2 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'] },
  groupImage: { maxBytes: 3 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'] },
  attachment: { maxBytes: 10 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
  verificationDocument: { maxBytes: 5 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'application/pdf'] },
  evidence: { maxBytes: 10 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
});

export const BUCKETS = Object.freeze({
  avatars: 'avatars',
  groupImages: 'group-images',
  attachments: 'message-attachments',
  verification: 'verification-documents',
  receipts: 'receipts',
  disputeEvidence: 'dispute-evidence',
});

export const PAYMENT_PURPOSES = ['osusu_contribution', 'collector_savings', 'bill_payment'];
export const DISBURSEMENT_KINDS = ['osusu_payout', 'saver_return', 'commission'];

// Reference prefixes route Paystack transfer webhooks to the right record.
export const REFERENCE_PREFIX = Object.freeze({
  payment: 'ACH-PAY',
  osusuPayout: 'ACH-PO',
  saverReturn: 'ACH-RT',
  commission: 'ACH-CM',
  bill: 'ACH-BILL',
  ticket: 'ACH-TKT',
});
