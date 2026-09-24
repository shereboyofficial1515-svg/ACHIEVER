import { z } from 'zod';
import { ALL_ROLES, ID_TYPES } from '../config/constants.js';
import {
  adultDob, countryCode, dateRange, email, employmentStatus, gender, isoDate, kobo, lgaId, line, optionalText, otpCode, paging,
  personName, phone, search, stateCode, text, uuid,
} from './common.js';

// Profile & onboarding --------------------------------------------------------
export const updateProfile = z.object({
  fullName: line(2, 120).optional(),
  firstName: personName().optional(),
  middleName: personName().optional().or(z.literal('')),
  lastName: personName().optional(),
  preferredName: line(1, 60).optional().or(z.literal('')),
  gender: gender.optional(),
  nationality: countryCode.optional(),
  occupation: line(2, 80).optional().or(z.literal('')),
  employmentStatus: employmentStatus.optional(),
  businessName: line(2, 120).optional().or(z.literal('')),
  dateOfBirth: adultDob.optional(),
  address: optionalText(300),
  addressUnit: line(1, 40).optional().or(z.literal('')),
  city: line(2, 80).optional(),
  stateCode: stateCode.optional(),
  lgaId: lgaId.optional(),
  postalCode: z.string().trim().regex(/^\d{6}$/, 'Nigerian postal codes are 6 digits').optional().or(z.literal('')),
  showPublicLocation: z.boolean().optional(),
}).strict();

export const emailChange = z.object({ newEmail: email, password: z.string().min(1).max(128) });
export const phoneChange = z.object({ newPhone: phone, password: z.string().min(1).max(128) });
export const confirmCode = z.object({ code: otpCode });
export const deactivate = z.object({ password: z.string().min(1).max(128), reason: optionalText(500) });
export const stepUp = z.object({ password: z.string().min(1).max(128) });
export const stateParam = z.object({ code: stateCode });

export const payoutAccount = z.object({
  bankCode: z.string().trim().regex(/^[0-9A-Za-z]{2,10}$/, 'Choose a bank'),
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'Enter a 10-digit NUBAN account number'),
});
export const payoutAccountConfirm = payoutAccount.extend({ code: otpCode });

const ID_FORMATS = {
  bvn: [/^\d{11}$/, 'A BVN is 11 digits'],
  nin: [/^\d{11}$/, 'A NIN is 11 digits'],
  passport: [/^[A-Z]\d{8}$/, 'A Nigerian passport number is a letter followed by 8 digits'],
  drivers_licence: [/^[A-Z0-9]{9,15}$/, 'Enter the licence number as printed'],
  voters_card: [/^[A-Z0-9]{19}$/, 'The voter identification number (VIN) has 19 characters'],
};
const today = () => new Date().toISOString().slice(0, 10);

export const identity = z.object({
  idType: z.enum(ID_TYPES),
  idNumber: z.string().trim().toUpperCase().transform((v) => v.replace(/\s+/g, '')),
  firstName: personName(),
  lastName: personName(),
  dateOfBirth: adultDob,
  issuingCountry: countryCode.default('NG'),
  issueDate: isoDate.optional().nullable(),
  expiryDate: isoDate.optional().nullable(),
}).superRefine((v, ctx) => {
  const [re, msg] = ID_FORMATS[v.idType];
  if (v.issuingCountry === 'NG' && !re.test(v.idNumber)) ctx.addIssue({ code: 'custom', path: ['idNumber'], message: msg });
  if (v.issuingCountry !== 'NG' && !/^[A-Z0-9]{5,20}$/.test(v.idNumber)) ctx.addIssue({ code: 'custom', path: ['idNumber'], message: 'Enter the document number as printed' });
  if (['passport', 'drivers_licence'].includes(v.idType) && !v.expiryDate) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Enter the expiry date' });
  if (v.expiryDate && v.expiryDate < today()) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'This document has expired' });
  if (v.issueDate && v.issueDate > today()) ctx.addIssue({ code: 'custom', path: ['issueDate'], message: 'The issue date cannot be in the future' });
  if (v.issueDate && v.expiryDate && v.issueDate >= v.expiryDate) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Expiry must be after the issue date' });
});

export const undertaking = z.object({ role: z.enum(['OSUSU_ADMIN', 'COLLECTOR']), accept: z.literal(true) });
export const addRole = z.object({ role: z.enum(['OSUSU_ADMIN', 'OSUSU_MEMBER', 'COLLECTOR', 'SAVER']) });

// Payments --------------------------------------------------------------------
export const referenceParam = z.object({ reference: z.string().regex(/^[A-Z0-9-]{10,60}$/, 'Invalid reference') });
export const listTransactions = paging.merge(dateRange).extend({
  type: z.enum(['osusu_contribution', 'osusu_payout', 'collector_savings', 'saver_return', 'commission', 'refund', 'bill_payment',
    'reversal', 'adjustment', 'fee', 'settlement']).optional(),
  status: z.enum(['pending', 'processing', 'success', 'failed', 'reversed']).optional(),
  search,
});

// Bills ---------------------------------------------------------------------------
export const createBill = z.discriminatedUnion('category', [
  z.object({ category: z.literal('airtime'), serviceId: z.string().max(40), phone, amount: kobo(5000, 5_000_000) }),
  z.object({ category: z.literal('data'), serviceId: z.string().max(40), phone, variationCode: z.string().max(80) }),
  z.object({
    category: z.literal('electricity'),
    serviceId: z.string().max(40),
    meterType: z.enum(['prepaid', 'postpaid']),
    customerId: z.string().trim().regex(/^[0-9]{6,20}$/, 'Enter a valid meter number'),
    phone,
    amount: kobo(100000, 50_000_000),
  }),
]);
export const variationsQuery = z.object({ serviceId: z.string().trim().max(40) });
export const verifyCustomer = z.object({
  serviceId: z.string().max(40),
  customerId: z.string().trim().regex(/^[0-9]{6,20}$/),
  meterType: z.enum(['prepaid', 'postpaid']),
});
export const listBills = paging.extend({
  status: z.enum(['awaiting_payment', 'paid', 'processing', 'delivered', 'failed', 'refund_pending', 'refunded', 'cancelled']).optional(),
  category: z.enum(['airtime', 'data', 'electricity']).optional(),
  search,
});

// Notifications ----------------------------------------------------------------------
const channelPref = z.object({ email: z.boolean(), sms: z.boolean() });
export const preferences = z.object({
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  categories: z.record(z.enum(['payments', 'reminders', 'payouts', 'meetings', 'messages', 'account', 'system']), channelPref).default({}),
});
export const listNotifications = paging.extend({ unreadOnly: z.enum(['true', 'false']).optional().transform((v) => v === 'true') });

// Messaging --------------------------------------------------------------------------
export const conversationParam = z.object({ conversationId: uuid });
export const listMessages = z.object({
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export const sendMessage = z.object({ body: text(1, 4000) });
export const attachmentCaption = z.object({ caption: optionalText(500) });
export const openDirect = z.object({ userId: uuid });

// Calls & meetings -------------------------------------------------------------------
export const startCall = z.object({ conversationId: uuid, callType: z.enum(['voice', 'video']) });
export const callParam = z.object({ callId: uuid });
export const createMeeting = z.object({
  groupId: uuid,
  title: line(3, 120),
  description: optionalText(1000),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(10).max(480).default(60),
  callEnabled: z.boolean().default(true),
});
export const updateMeeting = z.object({
  title: line(3, 120).optional(),
  description: optionalText(1000),
  startsAt: z.string().datetime({ offset: true }).optional(),
  durationMinutes: z.coerce.number().int().min(10).max(480).optional(),
  callEnabled: z.boolean().optional(),
});
export const listMeetings = z.object({ groupId: uuid.optional(), upcomingOnly: z.enum(['true', 'false']).default('true').transform((v) => v === 'true') });
export const startMeeting = z.object({ callType: z.enum(['voice', 'video']).default('video') });

// Invites ------------------------------------------------------------------------------
export const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{30,60}$/, 'Invalid invitation link') });

// Support --------------------------------------------------------------------------------
export const CASE_CATEGORIES = [
  'incorrect_payment', 'missing_contribution', 'incorrect_balance', 'payout_issue', 'collector_issue', 'bill_payment_issue',
  'unauthorized_activity', 'missing_payout', 'incorrect_contribution', 'fake_payment', 'failed_withdrawal',
  'collector_settlement', 'account_takeover', 'suspected_fraud', 'other',
];
export const createTicket = z.object({
  category: z.enum(CASE_CATEGORIES),
  amount: kobo(100).optional().nullable(),
  subject: line(5, 150),
  description: text(10, 4000),
  relatedTransactionId: uuid.optional().nullable(),
  relatedGroupId: uuid.optional().nullable(),
  relatedPlanId: uuid.optional().nullable(),
});
export const ticketMessage = z.object({ body: text(1, 4000), internal: z.boolean().optional() });
export const listTickets = paging.extend({
  status: z.enum(['open', 'in_progress', 'awaiting_user', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  category: z.string().max(40).optional(),
  assigneeId: uuid.optional(),
  search,
});
export const updateTicket = z.object({
  status: z.enum(['open', 'in_progress', 'awaiting_user', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  resolution: text(5, 2000).optional(),
  resolutionOutcome: z.enum(['in_favour_of_complainant', 'in_favour_of_respondent', 'no_fault_found', 'referred_externally', 'withdrawn']).optional(),
});
export const EVIDENCE_TYPES = ['transaction_record', 'payment_receipt', 'platform_record', 'message', 'document', 'screenshot', 'provider_response', 'security_event', 'audit_log'];
export const evidenceMeta = z.object({
  evidenceType: z.enum(['payment_receipt', 'message', 'document', 'screenshot']).default('document'),
  description: optionalText(1000),
  supersedesId: uuid.optional(),
});
export const linkEvidence = z.object({
  evidenceType: z.enum(EVIDENCE_TYPES),
  linkedRecordType: z.enum(['transaction', 'payment_attempt', 'security_event', 'audit_log', 'message', 'provider_event']),
  linkedRecordId: z.string().trim().min(1).max(80),
  description: optionalText(1000),
});
export const linkTransaction = z.object({ transactionId: uuid, note: optionalText(300) });
export const accessReason = z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) });
export const assignTicket = z.object({ assigneeId: uuid });

// Admin -----------------------------------------------------------------------------------
export const listUsers = paging.extend({
  search,
  role: z.enum(ALL_ROLES).optional(),
  status: z.enum(['pending_verification', 'active', 'suspended', 'closed']).optional(),
});
export const userStatus = z.object({ status: z.enum(['active', 'suspended', 'closed']), reason: line(5, 300) });
export const roleBody = z.object({ role: z.enum(ALL_ROLES) });
export const roleParam = z.object({ id: uuid, role: roleBody.shape.role });
export const adminGroups = paging.extend({ status: z.string().max(20).optional(), search });
export const collectorStatus = z.object({
  status: z.enum(['verified', 'active', 'restricted', 'suspended', 'rejected']),
  reason: line(5, 300),
});
export const collectorList = paging.extend({
  status: z.enum(['pending_review', 'verified', 'active', 'restricted', 'suspended', 'revoked', 'rejected']).optional(),
  search,
});
export const adminAttempts = paging.extend({
  status: z.enum(['initialized', 'success', 'failed', 'abandoned', 'amount_mismatch', 'duplicate']).optional(),
  purpose: z.enum(['osusu_contribution', 'collector_savings', 'bill_payment']).optional(),
  search,
});
export const adminTransactions = listTransactions.extend({ userId: uuid.optional(), groupId: uuid.optional() });
export const riskList = paging.extend({
  status: z.enum(['review_required', 'risk_review', 'resolved', 'dismissed']).optional(),
  context: z.enum(['osusu', 'collector', 'payments', 'account']).optional(),
});
export const riskUpdate = z.object({ status: z.enum(['review_required', 'risk_review', 'resolved', 'dismissed']), note: optionalText(500) });
export const auditList = paging.merge(dateRange).extend({
  actorId: uuid.optional(),
  action: z.string().max(60).optional(),
  resourceType: z.string().max(40).optional(),
  resourceId: z.string().max(80).optional(),
});
export const settingParam = z.object({ key: z.string().regex(/^[a-z_.]{3,60}$/) });
export const settingBody = z.object({ value: z.union([z.string().max(100), z.number(), z.boolean(), z.record(z.string().max(30), z.number().int())]) });
export const broadcast = z.object({
  title: line(3, 120),
  body: text(3, 1000),
  role: roleBody.shape.role.optional(),
});
export const verificationList = paging.extend({ status: z.enum(['pending', 'verified', 'failed', 'manual_review']).optional() });
export const verificationDecision = z.object({ decision: z.enum(['verified', 'failed']), note: optionalText(500) });
export const disbursementParam = z.object({ kind: z.enum(['osusu_payout', 'saver_return', 'commission']), id: uuid });
export const confirmDisbursement = z.object({
  externalReference: line(3, 100),
  note: optionalText(300),
  overrideReason: line(10, 500).optional(),
  approvalRequestId: uuid.optional(),
});
export const failDisbursement = z.object({ reason: line(3, 300) });

// Reports ------------------------------------------------------------------------------------
export const reportQuery = dateRange.extend({ type: z.string().max(30), format: z.enum(['json', 'csv']).default('json') });

// Security, compliance & approvals ------------------------------------------------------------
const EVENT_STATUS = ['flagged', 'review_required', 'suspicious_activity', 'account_security_review', 'resolved', 'dismissed'];
const APPROVAL_ACTIONS = ['transaction_reversal', 'transaction_adjustment', 'collector_revoke', 'risk_restriction_lift', 'large_payout_confirm'];
export const securityEventList = paging.extend({
  status: z.enum(EVENT_STATUS).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  eventType: z.string().max(40).optional(),
  userId: uuid.optional(),
});
export const securityEventUpdate = z.object({ status: z.enum(EVENT_STATUS), resolution: optionalText(1000) });
export const riskProfileList = paging.extend({ riskStatus: z.enum(['normal', 'review_required', 'restricted']).optional() });
export const riskStatus = z.object({ status: z.enum(['normal', 'review_required', 'restricted']), reason: line(10, 500) });
export const kycList = paging.extend({
  status: z.enum(['not_started', 'pending', 'in_review', 'verified', 'failed', 'expired', 'requires_update', 'restricted']).optional(),
  level: z.coerce.number().int().min(0).max(3).optional(),
});
export const kycRestriction = z.object({ restricted: z.boolean(), reason: line(10, 500) });
export const dataAccessList = paging.extend({ actorId: uuid.optional(), subjectUserId: uuid.optional() });
export const approvalList = paging.extend({
  status: z.enum(['pending', 'approved', 'rejected', 'executed', 'expired', 'cancelled']).optional(),
  action: z.enum(APPROVAL_ACTIONS).optional(),
});
export const approvalRequest = z.object({
  action: z.enum(APPROVAL_ACTIONS),
  targetId: uuid,
  reason: line(10, 1000),
  payload: z.object({
    refund: z.boolean().optional(),
    amount: z.number().int().positive().optional(),
    direction: z.enum(['debit', 'credit']).optional(),
    description: line(3, 200).optional(),
    status: z.enum(['normal', 'review_required']).optional(),
    kind: z.enum(['osusu_payout', 'saver_return', 'commission']).optional(),
  }).default({}),
});
export const approvalDecision = z.object({ decision: z.enum(['approve', 'reject']), note: optionalText(500) });
