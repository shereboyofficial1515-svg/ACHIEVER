import { env } from '../config/env.js';
import * as referralRepo from '../repositories/referralRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as auditService from './auditService.js';
import * as preferencesService from './preferencesService.js';
import * as settingsService from './settingsService.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { pageMeta } from '../utils/pagination.js';
import { maskName } from '../utils/vtpass.js';

/**
 * Referral programme. Who referred whom, qualification and reward state are
 * decided only in the database functions (create_referral,
 * evaluate_referral, evaluate_referrer_rewards, transition_referral_reward).
 * Clients can never set a referrer, "qualified" or a reward status.
 */
const CODE_RE = /^ACH-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
export const normaliseCode = (code) => String(code || '').trim().toUpperCase();

async function programme() {
  const [enabled, amount, required, days, activities, minActivities, osusu, level, review] = await Promise.all([
    settingsService.getBool('referral.enabled', true),
    settingsService.getInt('referral.reward_amount_kobo', 1_500_000),
    settingsService.getInt('referral.required_referrals', 6),
    settingsService.getInt('referral.qualification_days', 21),
    settingsService.get('referral.qualifying_activities', {}),
    settingsService.getInt('referral.min_activity_count', 1),
    settingsService.getBool('referral.require_osusu', true),
    settingsService.getInt('referral.verification_level', 1),
    settingsService.getBool('referral.review_required', true),
  ]);
  return {
    enabled, rewardAmount: amount, requiredReferrals: required, qualificationDays: days,
    qualifyingActivities: Object.entries(activities || {}).filter(([, on]) => on).map(([k]) => k),
    minActivities, osusuRequired: osusu, verificationLevel: level, reviewRequired: review,
  };
}

export const terms = programme;

/** Display name respecting the referrer's privacy choice: "John A." or a neutral label. */
async function displayName(profile) {
  const prefs = await preferencesService.get(profile.id).catch(() => null);
  if (prefs?.privacy?.showNameToReferrals === false) return 'An ACHIEVER member';
  return maskName(profile.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : profile.full_name) || 'An ACHIEVER member';
}

/** Checked before the account is created (registration form). */
export async function validateCode(code) {
  const c = normaliseCode(code);
  const p = await programme();
  if (!p.enabled) return { valid: false, reason: 'PROGRAMME_CLOSED' };
  if (!CODE_RE.test(c)) return { valid: false, reason: 'INVALID_CODE' };
  const row = await referralRepo.findCode(c);
  if (!row || row.disabled_at) return { valid: false, reason: 'INVALID_CODE' };
  const referrer = await userRepo.findById(row.user_id);
  if (!referrer || ['suspended', 'closed', 'deactivated'].includes(referrer.account_status)) return { valid: false, reason: 'INVALID_CODE' };
  return { valid: true, code: c, referredBy: await displayName(referrer) };
}

/**
 * After a successful registration. The relationship is created by the
 * database from the code alone; failures never undo the registration.
 */
export async function attachAfterRegistration(userId, code, req) {
  if (!code) return null;
  try {
    const r = await referralRepo.createReferral(userId, normaliseCode(code));
    await auditService.record({ actorId: userId, action: 'referral.attach', resourceType: 'profile', resourceId: userId, result: r?.outcome === 'created' ? 'success' : 'denied', metadata: { outcome: r?.outcome }, req });
    return r;
  } catch (err) {
    logger.error({ err: err.message }, 'referral not attached');
    return null;
  }
}

// Member dashboard ------------------------------------------------------------------------------
export async function myCode(user) {
  if (!user.emailVerified) throw AppError.forbidden('Verify your email to get a referral code', 'EMAIL_NOT_VERIFIED');
  const code = await referralRepo.ensureCode(user.id);
  return { code, link: `${env.CLIENT_URL.replace(/\/$/, '')}/register?ref=${encodeURIComponent(code)}` };
}

const ACTIVE_STATES = new Set(['active']);

export async function dashboard(user) {
  const p = await programme();
  const [{ code, link }, rows, rewards] = await Promise.all([myCode(user), referralRepo.listForReferrer(user.id), referralRepo.listRewards(user.id)]);
  const referrals = rows.map((r) => {
    const q = Array.isArray(r.qualification) ? r.qualification[0] : r.qualification;
    const name = r.referred?.first_name && r.referred?.last_name ? `${r.referred.first_name} ${r.referred.last_name}` : r.referred?.full_name;
    const reward = r.reward_id ? rewards.find((w) => w.id === r.reward_id) : null;
    return {
      id: r.id,
      name: maskName(name) || 'ACHIEVER member',
      joinedAt: r.created_at,
      status: r.status,
      // A review hold is shown neutrally; a flag is not a finding.
      underReview: Boolean(r.flag_status && !['APPROVED'].includes(r.flag_status)) && r.status !== 'DISQUALIFIED',
      statusReason: r.status_reason,
      accountActive: ACTIVE_STATES.has(r.referred?.account_status),
      verified: Boolean(q?.verified),
      osusuActive: Boolean(q?.osusu_met),
      daysActive: q?.days_elapsed ?? 0,
      requiredDays: p.qualificationDays,
      activities: q?.activity_count ?? 0,
      requiredActivities: p.minActivities,
      rewardStatus: reward?.status ?? (r.status === 'QUALIFIED' ? 'WAITING_FOR_BATCH' : 'NOT_QUALIFIED'),
    };
  });
  const qualifiedUnassigned = rows.filter((r) => r.status === 'QUALIFIED' && !r.reward_id && (!r.flag_status || r.flag_status === 'APPROVED')).length;
  const sum = (status) => rewards.filter((w) => status.includes(w.status)).reduce((n, w) => n + Number(w.amount), 0);
  return {
    code, link,
    programme: p,
    stats: {
      registered: rows.length,
      verified: referrals.filter((r) => r.verified).length,
      qualified: rows.filter((r) => r.status === 'QUALIFIED').length,
      active: referrals.filter((r) => r.accountActive && r.status !== 'DISQUALIFIED').length,
      pending: rows.filter((r) => ['REGISTERED', 'QUALIFYING'].includes(r.status)).length,
      progressToNextReward: qualifiedUnassigned,
      potentialReward: p.rewardAmount,
      approvedRewards: sum(['APPROVED']),
      paidRewards: sum(['PAID']),
      pendingRewards: sum(['ELIGIBLE', 'UNDER_REVIEW']),
    },
    rewardStatus: rewards[0]?.status ?? (qualifiedUnassigned > 0 || rows.length ? 'QUALIFYING' : 'NOT_QUALIFIED'),
    rewards: rewards.map((w) => ({ id: w.id, amount: Number(w.amount), status: w.status, createdAt: w.created_at, approvedAt: w.approved_at, paidAt: w.paid_at })),
    referrals,
  };
}

/** Re-evaluate this user's referrals now (also runs as a scheduled job). */
export async function refresh(user) {
  const rows = await referralRepo.listForReferrer(user.id);
  for (const r of rows.filter((x) => x.status !== 'DISQUALIFIED' && !x.reward_id)) await referralRepo.evaluate(r.id);
  await referralRepo.evaluateReferrer(user.id);
  return dashboard(user);
}

export async function runJob() {
  return referralRepo.runQualification(1000);
}

// Admin ----------------------------------------------------------------------------------------
const maskEmailAddr = (e) => (e ? String(e).replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => `${a}${'•'.repeat(Math.min(6, b.length))}${c}`) : null);
const maskPhone = (p) => (p ? `${String(p).slice(0, 4)}•••••${String(p).slice(-3)}` : null);

function adminRow(r, canSeeContact) {
  const q = Array.isArray(r.qualification) ? r.qualification[0] : r.qualification;
  const reward = Array.isArray(r.reward) ? r.reward[0] : r.reward;
  const person = (p) => p && ({
    id: p.id, name: p.full_name, accountStatus: p.account_status,
    email: canSeeContact ? p.email : maskEmailAddr(p.email),
    phone: canSeeContact ? p.phone : maskPhone(p.phone),
  });
  return {
    id: r.id, code: r.code, status: r.status, statusReason: r.status_reason,
    flagStatus: r.flag_status, flagReasons: r.flag_reasons, flagDecisionReason: r.flag_decision_reason,
    referrer: person(r.referrer), referred: person(r.referred),
    registeredAt: r.created_at, verified: Boolean(q?.verified), emailVerified: Boolean(r.referred?.email_verified_at),
    osusuActive: Boolean(q?.osusu_met), lastActivity: r.referred?.last_seen_at ?? null,
    qualifyingActivities: q?.activity_count ?? 0, daysActive: q?.days_elapsed ?? 0,
    requiredDays: q?.checks?.required_days ?? null, requiredActivities: q?.checks?.required_activities ?? null,
    qualifiedAt: r.qualified_at,
    reward: reward ? { id: reward.id, status: reward.status, amount: Number(reward.amount), approvedAt: reward.approved_at, paidAt: reward.paid_at } : null,
  };
}

export async function adminList(actor, filters) {
  let userIds = null;
  if (filters.search) {
    const s = filters.search.trim();
    if (/^ACH-BILL-/i.test(s)) {
      const id = await referralRepo.userIdForBillReference(s);
      userIds = id ? [id] : ['00000000-0000-0000-0000-000000000000'];
    } else {
      userIds = await referralRepo.findUserIds(s);
    }
  }
  const r = await referralRepo.adminList({ ...filters, userIds, search: userIds ? null : normaliseCode(filters.search || '') || null });
  const canSeeContact = actor.permissions?.includes?.('users.read_sensitive');
  return { items: r.rows.map((row) => adminRow(row, canSeeContact)), meta: pageMeta(filters, r.total) };
}

export async function adminRewards(filters) {
  const r = await referralRepo.adminRewards(filters);
  return {
    items: r.rows.map((w) => ({
      id: w.id, referrer: w.referrer ? { id: w.referrer.id, name: w.referrer.full_name, accountStatus: w.referrer.account_status } : null,
      amount: Number(w.amount), requiredReferrals: w.required_referrals, status: w.status, statusReason: w.status_reason,
      approvedBy: w.approved_by, approvedAt: w.approved_at, approvalReason: w.approval_reason,
      paymentReference: w.payment_reference, paidBy: w.paid_by, paidAt: w.paid_at, createdAt: w.created_at,
    })),
    meta: pageMeta(filters, r.total),
  };
}

export async function adminReward(id) {
  const w = await referralRepo.findReward(id);
  if (!w) throw AppError.notFound('Reward not found');
  const [referrals, events] = await Promise.all([referralRepo.rewardReferrals(id), referralRepo.events({ rewardId: id })]);
  return { reward: { ...w, amount: Number(w.amount) }, referrals: referrals.map((r) => ({ id: r.id, status: r.status, flagStatus: r.flag_status, name: r.referred?.full_name, accountStatus: r.referred?.account_status, qualifiedAt: r.qualified_at })), events };
}

export async function adminReferralEvents(id) {
  return referralRepo.events({ referralId: id });
}

export async function decideFlag(actor, referralId, { decision, reason }) {
  await referralRepo.decideFlag(referralId, actor.id, decision, reason);
  return { decided: true };
}

export async function transitionReward(actor, rewardId, { action, reason, paymentReference }) {
  // Paid as an ACHIEVER Wallet credit (REFERRAL_REWARD), with the same two-person rule.
  if (action === 'pay_wallet') return (await import('../repositories/walletRepository.js')).payReferralReward(rewardId, actor.id, reason);
  if (action === 'reverse') {
    const reward = await referralRepo.findReward(rewardId);
    if (String(reward?.payment_reference || '').startsWith('ACH-WTX')) {
      // Paid into a wallet: recover it with a two-person wallet adjustment (debit), not by changing the status alone.
      throw AppError.conflict('This reward was paid into the member’s ACHIEVER Wallet. Recover it with a wallet adjustment (Wallets → Adjust), which needs a second administrator.', 'WALLET_REWARD_USE_ADJUSTMENT');
    }
  }
  return referralRepo.transitionReward(rewardId, actor.id, action, reason, paymentReference ?? null);
}
