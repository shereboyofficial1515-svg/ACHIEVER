import { OTP } from '../config/constants.js';
import * as otpRepo from '../repositories/otpRepository.js';
import { AppError } from '../utils/AppError.js';
import { hashOtp, randomDigits, safeEqual } from '../utils/crypto.js';
import * as securityService from './securityService.js';

/**
 * One-time codes are stored only as keyed HMACs, expire after 10 minutes,
 * allow 5 attempts, and a new code invalidates any previous one. Codes for a
 * change (new email/phone/bank account) are bound to that pending value, so a
 * code issued for one value can never confirm a different one.
 */
export async function issue(userId, purpose, channel, pendingValue = null) {
  const last = await otpRepo.latest(userId, purpose);
  if (last && Date.now() - new Date(last.created_at).getTime() < OTP.resendCooldownSeconds * 1000) {
    throw AppError.tooMany(`Please wait ${OTP.resendCooldownSeconds} seconds before requesting another code`, 'OTP_COOLDOWN');
  }
  await otpRepo.invalidateOpen(userId, purpose);
  const code = randomDigits(OTP.length);
  await otpRepo.create({
    user_id: userId,
    purpose,
    channel,
    code_hash: hashOtp(userId, purpose, pendingValue ? `${code}:${pendingValue}` : code),
    pending_value: pendingValue,
    expires_at: new Date(Date.now() + OTP.ttlMinutes * 60 * 1000).toISOString(),
  });
  return code;
}

/** Verifies and consumes the latest code; returns the consumed row (incl. pending_value). */
export async function verify(userId, purpose, code) {
  const row = await otpRepo.latest(userId, purpose);
  const invalid = AppError.badRequest('The code is invalid or has expired', 'OTP_INVALID');
  if (!row || row.consumed_at || new Date(row.expires_at).getTime() < Date.now()) throw invalid;
  if (row.attempts >= OTP.maxAttempts) {
    throw AppError.tooMany('Too many incorrect attempts. Request a new code.', 'OTP_LOCKED');
  }
  const material = row.pending_value ? `${code}:${row.pending_value}` : String(code);
  if (!safeEqual(hashOtp(userId, purpose, material), row.code_hash)) {
    await otpRepo.incrementAttempts(row.id, row.attempts + 1);
    if (row.attempts + 1 >= OTP.maxAttempts) {
      await securityService.recordEvent({
        userId, type: 'otp_failures', severity: 'medium',
        description: `Several incorrect verification codes were entered (${purpose.replace(/_/g, ' ')}).`,
        metadata: { purpose },
      });
    }
    throw invalid;
  }
  await otpRepo.consume(row.id);
  return row;
}
