import { z } from 'zod';
import { adultDob, countryCode, email, employmentStatus, gender, lgaId, line, otpCode, password, personName, phone, optionalText, stateCode } from './common.js';

// Multi-step registration: account type → identity → contact → address → security.
export const register = z
  .object({
    accountType: z.enum(['osusu', 'collector', 'personal']),
    role: z.enum(['organizer', 'member', 'collector', 'saver', 'personal']),
    firstName: personName(),
    middleName: personName().optional().or(z.literal('')),
    lastName: personName(),
    preferredName: line(1, 60).optional().or(z.literal('')),
    gender,
    dateOfBirth: adultDob,
    nationality: countryCode.default('NG'),
    occupation: line(2, 80).optional().or(z.literal('')),
    employmentStatus: employmentStatus.optional(),
    businessName: line(2, 120).optional().or(z.literal('')),
    email,
    phone,
    stateCode,
    lgaId,
    city: line(2, 80),
    address: optionalText(300),
    addressUnit: line(1, 40).optional().or(z.literal('')),
    postalCode: z.string().trim().regex(/^\d{6}$/, 'Nigerian postal codes are 6 digits').optional().or(z.literal('')),
    password,
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms to continue' }) }),
    acceptPrivacy: z.literal(true, { errorMap: () => ({ message: 'You must accept the privacy notice to continue' }) }),
  })
  .refine((v) => !(['organizer', 'collector'].includes(v.role)) || (v.address && v.address.length >= 5), {
    message: 'Operators must provide a residential address', path: ['address'],
  });

export const login = z.object({ email, password: z.string().min(1).max(128) });
export const verifyCode = z.object({ code: otpCode });
export const forgotPassword = z.object({ email });
export const resetPassword = z.object({ email, code: otpCode, newPassword: password });
export const changePassword = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
