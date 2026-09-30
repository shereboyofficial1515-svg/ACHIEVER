import { z } from 'zod';

const b64 = z.string().trim().regex(/^[A-Za-z0-9+/=_-]{16,2000}$/);

export const setTransactionPin = z.object({
  pin: z.string().regex(/^\d{6}$/, 'Your transaction PIN must be exactly 6 digits'),
  confirmPin: z.string(),
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
}).refine((v) => v.pin === v.confirmPin, { message: 'The PINs do not match', path: ['confirmPin'] });

export const enrolStart = z.object({ password: z.string().min(1).max(128) });
export const enrolComplete = z.object({
  registrationToken: z.string().min(20).max(1000),
  publicKey: b64,
  signature: b64,
  label: z.string().trim().min(1).max(120).default('Android device'),
  allowLogin: z.boolean().default(true),
  allowTransactions: z.boolean().default(true),
});
export const keyParam = z.object({ id: z.string().uuid() });
export const revokeKey = z.object({ reason: z.enum(['user_disabled', 'key_invalidated']).default('user_disabled') });

export const pushRegister = z.object({
  token: z.string().trim().min(20).max(4096),
  appVersion: z.string().trim().max(40).optional(),
});
export const pushUnregister = z.object({ token: z.string().trim().min(20).max(4096) });

// Referrals (admin)
export const referralList = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  view: z.enum(['all', 'pending', 'qualifying', 'eligible', 'under_review', 'suspicious', 'rejected', 'disqualified']).default('all'),
  search: z.string().trim().max(120).optional(),
});
export const rewardList = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['ELIGIBLE', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PAID', 'REVERSED']).optional(),
});
export const flagDecision = z.object({
  decision: z.enum(['UNDER_REVIEW', 'APPROVED', 'REJECTED']),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(1000),
});
export const rewardTransition = z.object({
  action: z.enum(['start_review', 'approve', 'reject', 'mark_paid', 'reverse']),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(1000),
  paymentReference: z.string().trim().max(120).optional(),
}).refine((v) => v.action !== 'mark_paid' || Boolean(v.paymentReference), { message: 'Enter the payment reference', path: ['paymentReference'] });
