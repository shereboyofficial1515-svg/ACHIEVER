import { z } from 'zod';
import { email, isoDate, kobo, line, optionalText, paging, phone, search, uuid } from './common.js';

const groupFields = {
  name: line(3, 80),
  description: optionalText(1000),
  contributionAmount: kobo(10000, 1_000_000_000),
  frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
  maxMembers: z.coerce.number().int().min(2).max(100),
  startDate: isoDate,
  gracePeriodDays: z.coerce.number().int().min(0).max(14),
  payoutOrderMethod: z.enum(['join_order', 'random', 'manual']),
  requiresApproval: z.boolean(),
  meetingSchedule: optionalText(200),
};

export const createGroup = z.object({
  ...groupFields,
  gracePeriodDays: groupFields.gracePeriodDays.default(1),
  payoutOrderMethod: groupFields.payoutOrderMethod.default('join_order'),
  requiresApproval: groupFields.requiresApproval.default(true),
  adminParticipates: z.boolean().default(true),
});
export const updateGroup = z
  .object(Object.fromEntries(Object.entries(groupFields).map(([k, v]) => [k, v.optional()])))
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const listGroups = paging.extend({
  scope: z.enum(['mine', 'admin']).default('mine'),
  status: z.enum(['recruiting', 'active', 'completed', 'cancelled']).optional(),
  search,
});

export const joinGroup = z.object({ joinCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}$/, 'Enter the 8-character group code') });
export const groupParam = z.object({ groupId: uuid });
export const memberParam = z.object({ memberId: uuid });
export const cycleParam = z.object({ cycleId: uuid });
export const contributionParam = z.object({ contributionId: uuid });
export const removeMember = z.object({ reason: optionalText(300) });
export const payoutOrder = z.object({ memberIds: z.array(uuid).min(2).max(100) });
export const invite = z
  .object({ email: email.optional(), phone: phone.optional() })
  .refine((v) => v.email || v.phone, 'Provide an email address or phone number');

export const listContributions = paging.extend({
  status: z.enum(['pending', 'paid', 'overdue']).optional(),
  cycleNumber: z.coerce.number().int().positive().optional(),
  userId: uuid.optional(),
});
