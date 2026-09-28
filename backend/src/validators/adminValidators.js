import { z } from 'zod';
import { STAFF_ROLES } from '../config/constants.js';
import { email, otpCode, paging, password, uuid } from './common.js';

const reason = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500);

// Sign-in
export const login = z.object({ email, password: z.string().min(1).max(128) });
export const secondFactor = z.union([
  z.object({ code: otpCode, backupCode: z.undefined().optional() }),
  z.object({ backupCode: z.string().trim().regex(/^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/, 'Enter a backup code like ABCDE-FGHIJ'), code: z.undefined().optional() }),
]);
export const codeOnly = z.object({ code: otpCode });
export const changePassword = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password, code: otpCode });
export const forgotPassword = z.object({ email });
export const resetPassword = z.object({ email, code: otpCode, newPassword: password });

// Administrators
const staffRole = z.enum(STAFF_ROLES);
export const adminList = paging.extend({ status: z.enum(['active', 'disabled']).optional() });
export const createAdmin = z.object({ email, roles: z.array(staffRole).min(1).max(STAFF_ROLES.length), reason });
export const adminRoles = z.object({ roles: z.array(staffRole).min(1).max(STAFF_ROLES.length), reason });
export const adminStatus = z.object({ status: z.enum(['active', 'disabled']), reason });
export const reasonOnly = z.object({ reason });
export const sessionList = paging.extend({
  activeOnly: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  userId: uuid.optional(),
});
export const activityList = paging.extend({
  actions: z.string().max(400).optional().transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null)),
  actorId: uuid.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

// Settings & SMS
export const settingKey = z.object({ key: z.string().regex(/^[a-z_.]{3,60}$/) });
export const settingUpdate = z.object({
  value: z.union([z.string().max(100), z.number(), z.boolean(), z.record(z.string().max(30), z.number().int())]),
  reason,
});
export const smsUpdate = z.object({
  verificationEnabled: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
  reason,
});
