import { z } from 'zod';
import { isoDate, kobo, line, optionalText, uuid } from './common.js';
import { paginationSchema } from '../utils/pagination.js';

const pin = z.string().regex(/^\d{6}$/, 'Enter your 6-digit transaction PIN');
const walletCode = z.string().trim().max(20).regex(/^(ACHW)?-?[23456789A-HJ-NP-Za-hj-np-z\s-]{8,10}$/i, 'Enter a valid ACHIEVER Wallet ID');

/** Approval method. The server decides which methods are allowed for the amount (see approvalOptions). */
export const approve = z.discriminatedUnion('method', [
  z.object({ method: z.literal('pin'), pin }),
  z.object({ method: z.literal('email_otp'), pin }),
  z.object({ method: z.literal('device_biometric'), deviceKeyId: uuid }),
]);

export const confirm = z.object({
  challengeId: uuid,
  code: z.string().regex(/^\d{6}$/).optional(),
  signature: z.string().trim().regex(/^[A-Za-z0-9+/=_-]{16,2000}$/).optional(),
}).strict().refine((v) => !(v.code && v.signature), { message: 'Send either the code or the signature', path: ['code'] });

export const topup = z.object({ amount: kobo(10_000, 1_000_000_000) });
export const resolve = z.object({ walletId: walletCode });
export const transfer = z.object({
  walletId: walletCode,
  amount: kobo(100, 1_000_000_000),
  note: z.string().trim().max(120).optional().nullable(),
});

export const history = paginationSchema.extend({
  type: z.enum(['topup', 'transfer', 'bills', 'osusu', 'refunds', 'rewards', 'adjustments']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const paymentTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('osusu'), contributionId: uuid }),
  z.object({ kind: z.literal('collector'), planId: uuid, amount: kobo(10_000, 1_000_000_000) }),
]);
export const payAuthorize = z.intersection(paymentTarget, approve);
export const payConfirm = z.intersection(paymentTarget, z.object({
  challengeId: uuid, code: z.string().regex(/^\d{6}$/).optional(), signature: z.string().trim().regex(/^[A-Za-z0-9+/=_-]{16,2000}$/).optional(),
}));

export const mandate = z.object({
  groupId: uuid,
  endDate: isoDate.optional().nullable(),
  maximumTotal: kobo(10_000, 10_000_000_000).optional().nullable(),
});
export const mandateAction = z.object({ action: z.enum(['pause', 'resume', 'cancel']), reason: optionalText(300) });

// Admin --------------------------------------------------------------------------------------------
export const adminSearch = paginationSchema.extend({
  q: z.string().trim().max(80).optional(),
  search: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'frozen', 'closed']).optional(),
});
export const adminStatus = z.object({ status: z.enum(['active', 'frozen']), reason: line(5, 300) });
export const adminAdjust = z.object({ direction: z.enum(['credit', 'debit']), amount: kobo(100, 100_000_000), reason: line(10, 1000) });
export const adminDecision = z.object({ approve: z.boolean(), reason: line(5, 1000) });
export const adjustmentList = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() });
