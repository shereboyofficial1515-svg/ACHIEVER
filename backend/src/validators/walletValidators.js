import { z } from 'zod';
import { isoDate, kobo, line, optionalText, uuid } from './common.js';
import { paginationSchema } from '../utils/pagination.js';

const pin = z.string().regex(/^\d{6}$/, 'Enter your 6-digit transaction PIN');
// 'ACH' + 16 characters (spaces/dashes allowed when typed); old 'ACHW-XXXXXXXX' IDs still accepted.
const walletCode = z.string().trim().max(30).regex(/^[A-Za-z0-9\s-]{8,30}$/, 'Enter a valid ACHIEVER wallet account number');

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
export const feeQuote = z.object({
  service: z.enum(['bank_transfer', 'wallet_transfer', 'wallet_topup', 'osusu_contribution', 'collector_savings',
    'bill_airtime', 'bill_data', 'bill_electricity', 'bill_tv', 'bill_education', 'bill_recharge_pin', 'bill_betting']),
  amount: kobo(1, 1_000_000_000),
});

// Bank transfers (the account name is never accepted from the app: it is verified with the bank)
const bankCode = z.string().trim().regex(/^[A-Za-z0-9-]{2,20}$/, 'Choose a bank');
const accountNumber = z.string().trim().regex(/^\d{10}$/, 'Enter the 10-digit account number');
export const bankResolve = z.object({ bankCode, accountNumber });
export const bankTransfer = z.object({
  bankCode, accountNumber, amount: kobo(100, 1_000_000_000),
  narration: z.string().trim().max(100).optional().nullable(),
}).strict();
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
export const payPreview = paymentTarget;
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
export const bankTransferList = paginationSchema.extend({
  status: z.enum(['INITIATED', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED', 'REFUNDED', 'CANCELLED']).optional(),
  search: z.string().trim().max(60).optional(),
});
export const bankMarkPaid = z.object({ manualReference: line(4, 120), providerCost: kobo(0, 1_000_000).optional().nullable() });
export const bankRefund = z.object({ reason: line(5, 300) });

// Fees & Charges
const money = (max = 1_000_000_000) => z.coerce.number().int().min(0).max(max);
export const feeProposal = z.object({
  service: z.enum(['bank_transfer', 'wallet_transfer', 'wallet_topup', 'bill_airtime', 'bill_data', 'bill_electricity', 'bill_tv',
    'bill_education', 'bill_recharge_pin', 'bill_betting', 'osusu_contribution', 'collector_savings', 'osusu_payout', 'referral_payout']),
  feeType: z.enum(['FIXED', 'PERCENTAGE', 'FIXED_PLUS_PERCENTAGE', 'TIERED']),
  fixedAmount: money(100_000_000).optional(),
  percentage: z.coerce.number().min(0).max(50).optional(),
  tiers: z.array(z.object({
    min: money(), max: money().nullable().optional(), fixed: money(100_000_000).optional(), percentage: z.coerce.number().min(0).max(50).optional(),
  })).max(20).optional(),
  minimumFee: money(100_000_000).nullable().optional(),
  maximumFee: money(100_000_000).nullable().optional(),
  minimumTransactionAmount: money().nullable().optional(),
  maximumTransactionAmount: money().nullable().optional(),
  feeBearingMode: z.enum(['FEE_ADDED', 'FEE_INCLUDED']),
  enabled: z.boolean().default(true),
  effectiveFrom: z.string().datetime({ offset: true }).optional().nullable(),
  effectiveUntil: z.string().datetime({ offset: true }).optional().nullable(),
  reason: line(5, 1000),
}).strict().superRefine((v, ctx) => {
  if (v.feeType === 'TIERED' && !v.tiers?.length) ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'Add at least one tier' });
  if (v.minimumFee != null && v.maximumFee != null && v.maximumFee < v.minimumFee) {
    ctx.addIssue({ code: 'custom', path: ['maximumFee'], message: 'Maximum fee must be at least the minimum fee' });
  }
});
export const feeServiceParam = z.object({ service: z.string().regex(/^[a-z_]{3,40}$/) });
export const feeRevenue = z.object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() });

// Admin finance (business wallet) -------------------------------------------------------------------
export const businessAccount = z.object({
  bankCode: z.string().trim().regex(/^[A-Za-z0-9-]{2,20}$/, 'Choose a bank'),
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'Enter the 10-digit account number'),
  reason: z.string().trim().min(10, 'Give a reason (at least 10 characters)').max(300),
}).strict();
export const businessDecision = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional().nullable() }).strict();
export const businessWithdrawal = z.object({
  amount: z.coerce.number().int().min(100).max(100_000_000_000),
  reason: z.string().trim().min(10, 'Give a reason (at least 10 characters)').max(300),
}).strict();
export const businessWithdrawalList = z.object({
  status: z.enum(['PENDING_APPROVAL', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED', 'REJECTED', 'CANCELLED']).optional(),
});
