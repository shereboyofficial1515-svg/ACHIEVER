import { z } from 'zod';
import { dateRange, isoDate, kobo, line, optionalText, paging, phone, search, text, uuid } from './common.js';

// Profile & onboarding --------------------------------------------------------
export const updateProfile = z.object({
  fullName: line(2, 120).optional(),
  address: optionalText(300),
  dateOfBirth: isoDate.optional().nullable(),
});

export const payoutAccount = z.object({
  bankCode: z.string().trim().regex(/^[0-9A-Za-z]{2,10}$/, 'Choose a bank'),
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'Enter a 10-digit NUBAN account number'),
});

export const identity = z.object({
  idType: z.enum(['bvn', 'nin']),
  idNumber: z.string().trim().regex(/^\d{11}$/, 'BVN and NIN are 11 digits'),
  firstName: line(1, 60),
  lastName: line(1, 60),
  dateOfBirth: isoDate,
});

export const undertaking = z.object({ role: z.enum(['OSUSU_ADMIN', 'COLLECTOR']), accept: z.literal(true) });
export const addRole = z.object({ role: z.enum(['OSUSU_ADMIN', 'OSUSU_MEMBER', 'COLLECTOR', 'SAVER']) });

// Payments --------------------------------------------------------------------
export const referenceParam = z.object({ reference: z.string().regex(/^[A-Z0-9-]{10,60}$/, 'Invalid reference') });
export const listTransactions = paging.merge(dateRange).extend({
  type: z.enum(['osusu_contribution', 'osusu_payout', 'collector_savings', 'saver_return', 'commission', 'refund', 'bill_payment']).optional(),
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
export const createTicket = z.object({
  category: z.enum(['incorrect_payment', 'missing_contribution', 'incorrect_balance', 'payout_issue', 'collector_issue', 'bill_payment_issue', 'unauthorized_activity', 'other']),
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
});
export const assignTicket = z.object({ assigneeId: uuid });

// Admin -----------------------------------------------------------------------------------
export const listUsers = paging.extend({
  search,
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN', 'OSUSU_ADMIN', 'OSUSU_MEMBER', 'COLLECTOR', 'SAVER']).optional(),
  status: z.enum(['pending_verification', 'active', 'suspended', 'closed']).optional(),
});
export const userStatus = z.object({ status: z.enum(['active', 'suspended', 'closed']), reason: optionalText(300) });
export const roleBody = z.object({ role: z.enum(['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN', 'OSUSU_ADMIN', 'OSUSU_MEMBER', 'COLLECTOR', 'SAVER']) });
export const roleParam = z.object({ id: uuid, role: roleBody.shape.role });
export const adminGroups = paging.extend({ status: z.string().max(20).optional(), search });
export const collectorStatus = z.object({ status: z.enum(['active', 'suspended']), reason: optionalText(300) });
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
export const settingBody = z.object({ value: z.union([z.string().max(100), z.number(), z.boolean()]) });
export const broadcast = z.object({
  title: line(3, 120),
  body: text(3, 1000),
  role: roleBody.shape.role.optional(),
});
export const verificationList = paging.extend({ status: z.enum(['pending', 'verified', 'failed', 'manual_review']).optional() });
export const verificationDecision = z.object({ decision: z.enum(['verified', 'failed']), note: optionalText(500) });
export const disbursementParam = z.object({ kind: z.enum(['osusu_payout', 'saver_return', 'commission']), id: uuid });
export const confirmDisbursement = z.object({ externalReference: line(3, 100), note: optionalText(300) });
export const failDisbursement = z.object({ reason: line(3, 300) });

// Reports ------------------------------------------------------------------------------------
export const reportQuery = dateRange.extend({ type: z.string().max(30), format: z.enum(['json', 'csv']).default('json') });
