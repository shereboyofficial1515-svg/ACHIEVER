import { z } from 'zod';
import { cleanSingleLine, cleanText, normalizeNigerianPhone } from '../utils/sanitize.js';
import { paginationSchema } from '../utils/pagination.js';

export const uuid = z.string().uuid('Invalid identifier');
export const idParam = z.object({ id: uuid });

export const line = (min, max) => z.string().transform(cleanSingleLine).pipe(z.string().min(min).max(max));
export const text = (min, max) => z.string().transform(cleanText).pipe(z.string().min(min).max(max));
export const optionalText = (max) => z.string().transform(cleanText).pipe(z.string().max(max)).optional().nullable();

export const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const phone = z
  .string()
  .transform((v, ctx) => {
    const n = normalizeNigerianPhone(v);
    if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid Nigerian mobile number' });
    return n;
  });

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

/** Money in kobo (integer). ₦1 = 100. */
export const kobo = (min = 100, max = 100_000_000_00) =>
  z.coerce.number().int('Amount must be in kobo (whole number)').min(min).max(max);

export const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'Include upper and lower case letters and a number');

export const otpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const paging = paginationSchema;

export const dateRange = z.object({
  from: z.string().datetime({ offset: true }).or(isoDate).optional(),
  to: z.string().datetime({ offset: true }).or(isoDate).optional(),
});

export const search = z.string().trim().max(80).optional();

// Identity & location ----------------------------------------------------------------
export const personName = (min = 1) => z.string().transform(cleanSingleLine)
  .pipe(z.string().min(min).max(60).regex(/^[\p{L}][\p{L}' .-]*$/u, 'Use letters only'));
export const gender = z.enum(['female', 'male', 'other', 'prefer_not_to_say']);
export const employmentStatus = z.enum(['employed', 'self_employed', 'business_owner', 'student', 'unemployed', 'retired', 'other']);
export const countryCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use a 2-letter country code');
export const stateCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Choose a state');
export const lgaId = z.coerce.number().int().positive('Choose an LGA');

export function ageInYears(iso) {
  const today = new Date();
  const d = new Date(`${iso}T00:00:00Z`);
  let age = today.getUTCFullYear() - d.getUTCFullYear();
  const m = today.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}
export const adultDob = isoDate.refine((v) => {
  const age = ageInYears(v);
  return age >= 18 && age < 120;
}, 'You must be at least 18 years old');
