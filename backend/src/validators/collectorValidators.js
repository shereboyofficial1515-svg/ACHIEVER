import { z } from 'zod';
import { email, isoDate, kobo, line, optionalText, paging, phone, search, uuid } from './common.js';

const commission = {
  commissionType: z.enum(['percentage', 'fixed']),
  // percentage: basis points (100 = 1%, max 20%), fixed: kobo
  commissionValue: z.coerce.number().int().min(0).max(100_000_000),
};

export const createAccount = z
  .object({
    businessName: line(3, 100),
    description: optionalText(1000),
    operatingArea: optionalText(150),
    defaultCommissionType: commission.commissionType,
    defaultCommissionValue: commission.commissionValue,
  })
  .refine((v) => v.defaultCommissionType !== 'percentage' || v.defaultCommissionValue <= 2000, {
    message: 'Commission cannot exceed 20%', path: ['defaultCommissionValue'],
  });

export const updateAccount = z.object({
  businessName: line(3, 100).optional(),
  description: optionalText(1000),
  operatingArea: optionalText(150),
  defaultCommissionType: commission.commissionType.optional(),
  defaultCommissionValue: commission.commissionValue.optional(),
});

export const inviteSaver = z
  .object({
    email: email.optional(),
    phone: phone.optional(),
    planName: line(3, 80).default('Savings plan'),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'flexible']),
    expectedAmount: kobo(100).optional().nullable(),
    startDate: isoDate,
    endDate: isoDate,
    commissionType: commission.commissionType.optional(),
    commissionValue: commission.commissionValue.optional(),
  })
  .refine((v) => v.email || v.phone, 'Provide an email address or phone number')
  .refine((v) => v.endDate > v.startDate, { message: 'End date must be after the start date', path: ['endDate'] })
  .refine((v) => (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 <= 3 * 366, { message: 'Maximum term is 3 years', path: ['endDate'] });

export const listPlans = paging.extend({
  status: z.enum(['active', 'matured', 'return_requested', 'return_processing', 'returned', 'cancelled']).optional(),
  search,
});

export const planParam = z.object({ planId: uuid });
export const returnParam = z.object({ returnId: uuid });
export const contribute = z.object({ planId: uuid, amount: kobo(10000, 500_000_000) });
export const requestReturn = z.object({ reason: optionalText(500) });
export const rejectReturn = z.object({ reason: optionalText(500) });
export const listReturns = paging.extend({
  status: z.enum(['requested', 'approved', 'processing', 'paid', 'rejected', 'failed']).optional(),
  as: z.enum(['collector', 'saver']).optional(),
  planId: uuid.optional(),
});
