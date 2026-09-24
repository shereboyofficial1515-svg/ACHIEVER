import * as complianceRepo from '../repositories/complianceRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as settingsService from './settingsService.js';
import * as auditService from './auditService.js';
import * as securityService from './securityService.js';
import * as notificationService from './notificationService.js';
import * as kycService from './kycService.js';
import * as disbursementRepo from '../repositories/disbursementRepository.js';
import { AppError } from '../utils/AppError.js';
import { pageMeta } from '../utils/pagination.js';

/**
 * Explainable risk: every decision lists the concrete factors behind it.
 * There is no opaque score, and nothing here labels a user as a fraudster —
 * outcomes are "normal", "review required" or "restricted" pending review.
 */
export function explain(f) {
  if (!f) return [];
  const factors = [];
  if (f.account_age_days < 7) factors.push({ code: 'new_account', label: `Account is ${f.account_age_days} day(s) old` });
  if (f.verification_level < 2) factors.push({ code: 'low_verification', label: `Verification level ${f.verification_level}` });
  if (f.open_high_security_events > 0) factors.push({ code: 'open_security_events', label: `${f.open_high_security_events} open high-severity security event(s)` });
  if (f.failed_payments_30d >= 3) factors.push({ code: 'failed_payments', label: `${f.failed_payments_30d} failed payments in 30 days` });
  if (f.open_risk_flags > 0) factors.push({ code: 'open_reviews', label: `${f.open_risk_flags} open review case(s)` });
  if (f.disputes_as_respondent > 0) factors.push({ code: 'disputes', label: `Named in ${f.disputes_as_respondent} dispute case(s)` });
  if (f.failed_verifications > 0) factors.push({ code: 'failed_verifications', label: `${f.failed_verifications} unsuccessful identity verification(s)` });
  if (f.overdue_contributions > 0) factors.push({ code: 'overdue_contributions', label: `${f.overdue_contributions} overdue contribution(s)` });
  if (f.last_payment_account_change && Date.now() - new Date(f.last_payment_account_change).getTime() < 7 * 86400000) {
    factors.push({ code: 'recent_payment_account_change', label: 'Payout account changed in the last 7 days' });
  }
  return factors;
}

export async function profile(userId) {
  const f = await complianceRepo.getRiskFactors(userId);
  if (!f) throw AppError.notFound('User not found');
  return {
    userId,
    riskStatus: f.risk_status,
    restrictionReason: f.restriction_reason,
    lastReviewedAt: f.last_reviewed_at,
    reviewNotes: f.review_notes,
    factors: explain(f),
    signals: {
      accountAgeDays: f.account_age_days,
      verificationLevel: f.verification_level,
      kycStatus: f.kyc_status,
      securityEvents90d: Number(f.security_events_90d),
      openHighSecurityEvents: Number(f.open_high_security_events),
      disputesAsRespondent: Number(f.disputes_as_respondent),
      disputesFiled: Number(f.disputes_filed),
      failedVerifications: Number(f.failed_verifications),
      failedPayments30d: Number(f.failed_payments_30d),
      openRiskFlags: Number(f.open_risk_flags),
      overdueContributions: Number(f.overdue_contributions),
      lastPaymentAccountChange: f.last_payment_account_change,
    },
  };
}

export async function statusOf(userId) {
  const row = await complianceRepo.getRiskProfile(userId);
  return row?.risk_status ?? 'normal';
}

/** Block money-moving activities while an account is restricted pending review. */
export async function assertNotRestricted(userId) {
  if ((await statusOf(userId)) === 'restricted') {
    throw AppError.forbidden('This activity is paused on your account while a review is completed. Contact support for help.', 'ACCOUNT_RESTRICTED');
  }
}

export async function list(filters) {
  const result = await complianceRepo.listRiskProfiles(filters);
  return { items: result.rows, meta: pageMeta(filters, result.total) };
}

/**
 * Change a user's risk status. Lifting a restriction needs an approved
 * two-person request (risk_restriction_lift) executed by the caller.
 */
export async function setStatus(actor, userId, { status, reason, approvalRequestId }, req, { consumeApproval } = {}) {
  if (userId === actor.id) throw AppError.forbidden('You cannot change your own risk status', 'SELF_REVIEW_FORBIDDEN');
  if (!(await userRepo.findById(userId))) throw AppError.notFound('User not found');
  const current = await statusOf(userId);
  if (current === status) return profile(userId);
  if (current === 'restricted') {
    if (!approvalRequestId || !consumeApproval) {
      throw AppError.conflict('Lifting a restriction needs approval from a second authorised person', 'APPROVAL_REQUIRED');
    }
    await consumeApproval(approvalRequestId, 'risk_restriction_lift', userId, actor.id);
  }
  await complianceRepo.upsertRiskProfile({
    user_id: userId, risk_status: status, restriction_reason: status === 'restricted' ? reason : null,
    last_reviewed_at: new Date().toISOString(), reviewed_by: actor.id, review_notes: reason,
  });
  await securityService.recordChange({ userId, type: 'risk_status_changed', previous: current, next: status, actorId: actor.id, reason, req });
  await auditService.record({ actorId: actor.id, action: 'risk.status', resourceType: 'risk_profile', resourceId: userId, metadata: { from: current, to: status, reason, approvalRequestId }, req });
  if (status === 'restricted' || current === 'restricted') {
    await notificationService.notify(userId, {
      type: 'account_review', category: 'account',
      title: status === 'restricted' ? 'Account review in progress' : 'Account review completed',
      body: status === 'restricted'
        ? 'Some activities on your account are paused while we complete a routine review. Contact support if you have questions.'
        : 'The review of your account is complete and all activities are available again.',
      data: {}, dedupeKey: `risk_status:${userId}:${status}:${Date.now()}`,
    });
  }
  return profile(userId);
}

// Disbursement evaluation (withdrawal security) ----------------------------------------------
/**
 * Decide whether an approved disbursement may be executed automatically.
 * Returns neutral, explainable hold reasons; a held item is not paid until a
 * finance admin reviews it and records an override reason.
 */
export async function evaluateDisbursement(item) {
  const reasons = [];
  const [riskStatus, kyc, account, levels, threshold] = await Promise.all([
    statusOf(item.userId),
    kycService.levelOf(item.userId),
    userRepo.getPayoutAccount(item.userId),
    kycService.requiredLevels(),
    settingsService.get('risk.withdrawal_review_threshold_kobo', 50_000_000),
  ]);
  if (riskStatus !== 'normal') reasons.push({ code: 'account_review', label: `Recipient account status: ${riskStatus.replace('_', ' ')}` });
  if (kyc.restricted) reasons.push({ code: 'kyc_restricted', label: 'Recipient verification is under review' });
  const minLevel = Number(levels.receive_payout ?? 2);
  if (kyc.level < minLevel) reasons.push({ code: 'kyc_level', label: `Recipient verification level ${kyc.level} (level ${minLevel} required)` });
  if (!account) reasons.push({ code: 'no_payout_account', label: 'Recipient has no payout account' });
  else {
    if (account.status === 'disabled') reasons.push({ code: 'payout_account_disabled', label: 'Payout account is disabled' });
    if (account.cooldown_until && new Date(account.cooldown_until).getTime() > Date.now()) {
      reasons.push({ code: 'payout_account_cooldown', label: `Payout account recently changed (cool-down until ${new Date(account.cooldown_until).toISOString()})` });
    }
  }
  if (item.amount >= Number(threshold)) reasons.push({ code: 'large_amount', label: 'Amount is at or above the manual review threshold' });
  return { hold: reasons.length > 0, reasons, evaluatedAt: new Date().toISOString() };
}

export async function recordEvaluation(kind, id, evaluation) {
  const hold = evaluation.hold ? evaluation.reasons.map((r) => r.label).join('; ').slice(0, 500) : null;
  await disbursementRepo.setEvaluation(kind, id, { hold_reason: hold, risk_evaluation: evaluation });
}
