import { z } from 'zod';
import { email, isoDate, line, otpCode, password, phone, optionalText } from './common.js';

export const register = z
  .object({
    accountType: z.enum(['osusu', 'collector', 'personal']),
    role: z.enum(['organizer', 'member', 'collector', 'saver', 'personal']),
    fullName: line(2, 120),
    email,
    phone,
    password,
    address: optionalText(300),
    dateOfBirth: isoDate.optional().nullable(),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms to continue' }) }),
  })
  .refine((v) => {
    if (!v.dateOfBirth) return true;
    const age = (Date.now() - Date.parse(v.dateOfBirth)) / (365.25 * 86400000);
    return age >= 18 && age < 120;
  }, { message: 'You must be at least 18 years old', path: ['dateOfBirth'] });

export const login = z.object({ email, password: z.string().min(1).max(128) });
export const verifyCode = z.object({ code: otpCode });
export const forgotPassword = z.object({ email });
export const resetPassword = z.object({ email, code: otpCode, newPassword: password });
export const changePassword = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
