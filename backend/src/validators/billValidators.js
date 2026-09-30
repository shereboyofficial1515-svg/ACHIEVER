import { z } from 'zod';

const phone = z.string().trim().transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^(\+?234|0)[789][01]\d{8}$/.test(v), 'Enter a valid Nigerian phone number')
  .transform((v) => `+234${v.replace(/^(\+?234|0)/, '')}`);
const serviceId = z.string().trim().regex(/^[a-z0-9-]{2,60}$/, 'Unknown service');
const category = z.enum(['airtime', 'data', 'electricity', 'tv', 'education', 'betting', 'recharge_pin']);
const kobo = z.coerce.number().int().min(5000).max(50_000_000);
const accountNumber = z.string().trim().regex(/^[A-Za-z0-9-]{4,30}$/, 'Enter a valid number');

export const categoryQuery = z.object({ category });
export const serviceParams = z.object({ serviceId });
export const categoryServiceParams = z.object({ category, serviceId });

export const verify = z.object({
  category,
  serviceId,
  customerId: accountNumber,
  meterType: z.enum(['prepaid', 'postpaid']).optional(),
});

// Only what the user chooses; prices, fees and verified names are decided by the server.
export const quote = z.discriminatedUnion('category', [
  z.object({ category: z.literal('airtime'), serviceId, phone, amount: kobo }),
  z.object({ category: z.literal('data'), serviceId, phone, variationCode: z.string().trim().min(1).max(120) }),
  z.object({ category: z.literal('electricity'), serviceId, phone, meterType: z.enum(['prepaid', 'postpaid']), customerId: z.string().trim().regex(/^\d{6,20}$/, 'Enter a valid meter number'), amount: kobo }),
  z.object({
    category: z.literal('tv'), serviceId, phone, customerId: accountNumber.optional(),
    subscriptionType: z.enum(['change', 'renew']).default('change'), variationCode: z.string().trim().max(120).optional(),
  }),
  z.object({ category: z.literal('education'), serviceId, phone, variationCode: z.string().trim().min(1).max(120), quantity: z.coerce.number().int().min(1).max(10).default(1), customerId: accountNumber.optional() }),
  z.object({ category: z.literal('recharge_pin'), serviceId, phone, variationCode: z.string().trim().min(1).max(120), quantity: z.coerce.number().int().min(1).max(10).default(1) }),
  z.object({ category: z.literal('betting'), serviceId, phone, customerId: accountNumber, amount: kobo }),
]).superRefine((v, ctx) => {
  if (v.category === 'tv' && v.subscriptionType === 'change' && !v.variationCode) {
    ctx.addIssue({ code: 'custom', path: ['variationCode'], message: 'Choose a package' });
  }
});

export const authorize = z.discriminatedUnion('method', [
  z.object({ method: z.literal('email_otp'), pin: z.string().regex(/^\d{6}$/, 'Enter your 6-digit transaction PIN') }),
  z.object({ method: z.literal('device_biometric'), deviceKeyId: z.string().uuid() }),
]);

export const confirm = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/).optional(),
  signature: z.string().trim().regex(/^[A-Za-z0-9+/=_-]{16,2000}$/).optional(),
}).refine((v) => Boolean(v.code) !== Boolean(v.signature), { message: 'Enter the code from your email', path: ['code'] });

export const history = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  category: category.optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED', 'REFUNDED', 'CANCELLED']).optional(),
  search: z.string().trim().max(80).optional(),
});

// Admin ----------------------------------------------------------------------------------------------
export const adminList = history.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  userId: z.string().uuid().optional(),
  requestId: z.string().trim().max(80).optional(),
  providerTransactionId: z.string().trim().max(80).optional(),
  fromDate: z.string().datetime({ offset: true }).optional(),
  toDate: z.string().datetime({ offset: true }).optional(),
});
export const serviceToggle = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
});
export const reconciliationList = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  open: z.enum(['true', 'false']).default('true'),
});
export const resolve = z.object({ note: z.string().trim().min(5).max(1000) });
export const reconId = z.object({ id: z.coerce.number().int().positive() });
