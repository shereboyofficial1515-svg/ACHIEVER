import { OTP } from '../config/constants.js';
import * as otpRepo from '../repositories/otpRepository.js';
import { AppError } from '../utils/AppError.js';
import { hashOtp, randomDigits, safeEqual } from '../utils/crypto.js';

/**
 * One-time codes are stored only as keyed HMACs, expire after 10 minutes,
 * allow 5 attempts, and a new code invalidates any previous one.
 */
export async function issue(userId, purpose, channel) {
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
    code_hash: hashOtp(userId, purpose, code),
    expires_at: new Date(Date.now() + OTP.ttlMinutes * 60 * 1000).toISOString(),
  });
  return code;
}

export async function verify(userId, purpose, code) {
  const row = await otpRepo.latest(userId, purpose);
  const invalid = AppError.badRequest('The code is invalid or has expired', 'OTP_INVALID');
  if (!row || row.consumed_at || new Date(row.expires_at).getTime() < Date.now()) throw invalid;
  if (row.attempts >= OTP.maxAttempts) {
    throw AppError.tooMany('Too many incorrect attempts. Request a new code.', 'OTP_LOCKED');
  }
  if (!safeEqual(hashOtp(userId, purpose, String(code)), row.code_hash)) {
    await otpRepo.incrementAttempts(row.id, row.attempts + 1);
    throw invalid;
  }
  await otpRepo.consume(row.id);
  return true;
}
