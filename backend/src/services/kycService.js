import { KYC_ACTIVITIES } from '../config/constants.js';
import * as complianceRepo from '../repositories/complianceRepository.js';
import * as settingsService from './settingsService.js';
import * as auditService from './auditService.js';
import * as securityService from './securityService.js';
import * as notificationService from './notificationService.js';
import { AppError } from '../utils/AppError.js';
import { pageMeta } from '../utils/pagination.js';

/**
 * Progressive KYC. The level is always derived by the database
 * (recompute_kyc) from verified facts — never set directly by the API.
 *   0 email verified
 *   1 + phone verified, legal names, date of birth, state/LGA/city
 *   2 + government ID verified and not expired
 *   3 + liveness passed and address verified
 */
export const LEVEL_REQUIREMENTS = {
  1: 'Verify your phone number and complete your legal name, date of birth, state, LGA and city',
  2: 'Verify a government-issued ID (NIN, BVN, passport, driver’s licence or voter’s card)',
  3: 'Complete a liveness check and verify your residential address',
};

const ACTIVITY_LABELS = {
  contribute: 'make contributions',
  receive_payout: 'receive payouts',
  withdraw: 'withdraw funds',
  operator: 'manage other people’s money',
};

export async function recompute(userId) {
  return complianceRepo.recomputeKyc(userId);
}

export async function requiredLevels() {
  const configured = await settingsService.get('kyc.required_levels', null);
  return { ...KYC_ACTIVITIES, ...(configured && typeof configured === 'object' ? configured : {}) };
}

export function format(k, levels) {
  const level = k?.level ?? 0;
  return {
    level,
    status: k?.status ?? 'not_started',
    restricted: Boolean(k?.restricted),
    verifiedAt: k?.verified_at ?? null,
    expiresAt: k?.expires_at ?? null,
    failureReason: k?.status === 'failed' ? k.failure_reason : null,
    attempts: k?.attempt_count ?? 0,
    nextStep: level < 3 ? LEVEL_REQUIREMENTS[level + 1] : null,
    allowed: levels ? Object.fromEntries(Object.entries(levels).map(([a, min]) => [a, level >= min && !k?.restricted])) : undefined,
    requiredLevels: levels,
  };
}

export async function summary(userId, { refresh = false } = {}) {
  if (refresh) await recompute(userId);
  let k = await complianceRepo.getKyc(userId);
  if (!k) {
    await recompute(userId);
    k = await complianceRepo.getKyc(userId);
  }
  const levels = await requiredLevels();
  return format(k, levels);
}

/** Gate an activity on the user's verified KYC level. */
export async function requireLevel(userId, activity) {
  const levels = await requiredLevels();
  const min = Number(levels[activity] ?? 0);
  await recompute(userId);
  const k = await complianceRepo.getKyc(userId);
  if (k?.restricted) {
    throw new AppError(403, 'KYC_RESTRICTED', 'Verification-dependent activities are paused on your account while a review is completed. Contact support for help.');
  }
  const level = k?.level ?? 0;
  if (level < min) {
    throw new AppError(
      403,
      'KYC_LEVEL_REQUIRED',
      `To ${ACTIVITY_LABELS[activity] ?? 'continue'} you need verification level ${min}. ${LEVEL_REQUIREMENTS[level + 1] ?? ''}`.trim(),
      { requiredLevel: min, currentLevel: level, activity },
    );
  }
  return level;
}

export async function levelOf(userId) {
  const k = await complianceRepo.getKyc(userId);
  return { level: k?.level ?? 0, restricted: Boolean(k?.restricted), status: k?.status ?? 'not_started' };
}

// Staff -------------------------------------------------------------------------------------
export async function list(filters) {
  const result = await complianceRepo.listKyc(filters);
  return { items: result.rows, meta: pageMeta(filters, result.total) };
}

export async function history(userId) {
  return complianceRepo.listKycEvents(userId);
}

/** Restrict or lift a KYC restriction (compliance). Neutral wording to the user. */
export async function setRestriction(actor, userId, { restricted, reason }, req) {
  if (userId === actor.id) throw AppError.forbidden('You cannot change your own verification status', 'SELF_REVIEW_FORBIDDEN');
  await recompute(userId);
  await complianceRepo.updateKyc(userId, { restricted, restriction_reason: reason, reviewer_id: actor.id, reviewed_at: new Date().toISOString() });
  await recompute(userId);
  await securityService.recordChange({ userId, type: 'kyc_restriction_changed', previous: restricted ? 'unrestricted' : 'restricted', next: restricted ? 'restricted' : 'unrestricted', actorId: actor.id, reason, req });
  await auditService.record({ actorId: actor.id, action: restricted ? 'kyc.restrict' : 'kyc.unrestrict', resourceType: 'kyc_profile', resourceId: userId, metadata: { reason }, req });
  await notificationService.notify(userId, {
    type: 'kyc_status', category: 'account',
    title: restricted ? 'Verification review in progress' : 'Verification review completed',
    body: restricted
      ? 'Some verification-dependent activities are paused while we complete a review. Contact support if you have questions.'
      : 'The verification review on your account is complete and all activities are available again.',
    data: {}, dedupeKey: `kyc_restriction:${userId}:${Date.now()}`,
  });
  return summary(userId, { refresh: true });
}
