import * as smsService from './smsService.js';
import * as userRepo from '../repositories/userRepository.js';
import * as complianceRepo from '../repositories/complianceRepository.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';

const { SMS_STATES, PROVIDER_STATUS } = smsService;

export const SMS_UNAVAILABLE_MESSAGE = 'SMS verification is temporarily unavailable. Please use email verification.';

/**
 * Which verification methods are available right now. The apps ask the API
 * instead of assuming SMS is always required.
 */
export async function methods() {
  const state = await smsService.verificationState();
  const provider = smsService.providerStatus();
  const smsUsable = state === SMS_STATES.ENABLED;
  return {
    email: { enabled: true, required: true },
    sms: { enabled: state !== SMS_STATES.DISABLED, available: smsUsable, state, providerStatus: provider },
    // Authenticator apps and passkeys protect administrator accounts; member support is not built yet.
    totp: { enabled: false },
    passkey: { enabled: false },
    phoneVerification: smsUsable ? 'sms' : 'email_fallback',
    fallback: 'email',
    message: smsUsable ? null : SMS_UNAVAILABLE_MESSAGE,
  };
}

/** Email may stand in for SMS when SMS is off, not configured, or failing. */
export async function emailFallbackAllowed() {
  const state = await smsService.verificationState();
  if (state !== SMS_STATES.ENABLED) return { allowed: true, reason: state === SMS_STATES.DISABLED ? 'sms_disabled' : 'sms_unavailable' };
  const provider = smsService.providerStatus();
  if (provider === PROVIDER_STATUS.DEGRADED || provider === PROVIDER_STATUS.UNAVAILABLE) return { allowed: true, reason: 'sms_unavailable' };
  return { allowed: false, reason: null };
}

/**
 * Record that the verified email covers the phone requirement for now. Only
 * for accounts with a verified email; the phone can still be verified by SMS
 * later. Always audited.
 */
export async function waivePhoneVerification(userId, reason, req) {
  const profile = await userRepo.findById(userId);
  if (!profile) throw AppError.notFound('Account not found');
  if (!profile.email_verified_at) throw AppError.forbidden('Verify your email address first', 'EMAIL_NOT_VERIFIED');
  if (profile.phone_verified_at) return { method: 'sms', alreadyVerified: true };
  if (!profile.phone_verification_waived_at) {
    await userRepo.update(userId, { phone_verification_waived_at: new Date().toISOString(), phone_verification_waiver: reason });
    await complianceRepo.recomputeKyc(userId);
    await auditService.record({
      actorId: userId, action: 'auth.phone_verification_email_fallback', resourceType: 'profile', resourceId: userId,
      metadata: { reason }, req,
    });
  }
  return { method: 'email_fallback', reason };
}

/** Apply the fallback automatically while SMS verification is switched off platform-wide. */
export async function applyFallbackIfSmsDisabled(user, req) {
  if (!user?.emailVerified || user.phoneVerified || user.phoneVerificationWaived) return false;
  if ((await smsService.verificationState()) !== SMS_STATES.DISABLED) return false;
  await waivePhoneVerification(user.id, 'sms_disabled', req);
  return true;
}
