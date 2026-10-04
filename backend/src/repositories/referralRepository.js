import { db, one, run, runPaged, rpc } from '../integrations/supabase/db.js';
import { likePattern, toRange } from '../utils/pagination.js';

export const ensureCode = (userId) => rpc('ensure_referral_code', { p_user_id: userId });
export const createReferral = (referredId, code) => rpc('create_referral', { p_referred: referredId, p_code: code });
export const evaluate = (referralId) => rpc('evaluate_referral', { p_referral_id: referralId });
export const evaluateReferrer = (referrerId) => rpc('evaluate_referrer_rewards', { p_referrer: referrerId });
export const runQualification = (limit = 500) => rpc('run_referral_qualification', { p_limit: limit });
export const decideFlag = (referralId, actorId, decision, reason) =>
  rpc('decide_referral_flag', { p_referral: referralId, p_actor: actorId, p_decision: decision, p_reason: reason });
export const transitionReward = (rewardId, actorId, action, reason, paymentReference = null) =>
  rpc('transition_referral_reward', { p_reward: rewardId, p_actor: actorId, p_action: action, p_reason: reason, p_payment_reference: paymentReference });

export async function findCode(code) {
  return one(db.from('referral_codes').select('code, user_id, disabled_at').eq('code', code).maybeSingle());
}

export async function codeOf(userId) {
  return one(db.from('referral_codes').select('code, created_at').eq('user_id', userId).maybeSingle());
}

const REFERRAL_COLUMNS =
  'id, referrer_id, referred_user_id, code, status, status_reason, flag_status, flag_reasons, flag_decided_at, flag_decision_reason, ' +
  'qualified_at, reward_id, created_at, updated_at';

/** How many people this member has referred (count only, no rows transferred). */
export async function countForReferrer(referrerId) {
  const { count, error } = await db.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', referrerId);
  if (error) throw error;
  return count || 0;
}

export async function listForReferrer(referrerId) {
  return run(db.from('referrals')
    .select(`${REFERRAL_COLUMNS}, referred:profiles!referrals_referred_user_id_fkey(first_name, last_name, full_name, account_status), ` +
      'qualification:referral_qualifications(verified, osusu_met, days_elapsed, activity_count, good_standing, checks, evaluated_at)')
    .eq('referrer_id', referrerId).order('created_at', { ascending: false }).limit(500));
}

export async function referralOf(userId) {
  return one(db.from('referrals').select('id, referrer_id, created_at').eq('referred_user_id', userId).maybeSingle());
}

export async function listRewards(referrerId) {
  return run(db.from('referral_rewards').select('id, amount, required_referrals, status, status_reason, approved_at, paid_at, created_at')
    .eq('referrer_id', referrerId).order('created_at', { ascending: false }));
}

// Admin -------------------------------------------------------------------------------------------
const ADMIN_VIEW = {
  pending: (q) => q.eq('status', 'REGISTERED'),
  qualifying: (q) => q.eq('status', 'QUALIFYING'),
  eligible: (q) => q.eq('status', 'QUALIFIED'),
  suspicious: (q) => q.in('flag_status', ['SUSPICIOUS', 'PENDING_REVIEW']),
  under_review: (q) => q.eq('flag_status', 'UNDER_REVIEW'),
  rejected: (q) => q.eq('flag_status', 'REJECTED'),
  disqualified: (q) => q.eq('status', 'DISQUALIFIED'),
};

export async function adminList({ view, search, userIds, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('referrals')
    .select(`${REFERRAL_COLUMNS}, ` +
      'referrer:profiles!referrals_referrer_id_fkey(id, full_name, email, phone, account_status), ' +
      'referred:profiles!referrals_referred_user_id_fkey(id, full_name, email, phone, account_status, email_verified_at, last_seen_at), ' +
      'qualification:referral_qualifications(verified, osusu_met, days_elapsed, activity_count, good_standing, checks, evaluated_at), ' +
      'reward:referral_rewards(id, status, amount, approved_at, paid_at)', { count: 'exact' })
    .order('created_at', { ascending: false }).range(from, to);
  if (view && ADMIN_VIEW[view]) q = ADMIN_VIEW[view](q);
  if (userIds?.length) q = q.or(`referrer_id.in.(${userIds.join(',')}),referred_user_id.in.(${userIds.join(',')})`);
  else if (search) q = q.ilike('code', likePattern(search));
  return runPaged(q);
}

export async function adminRewards({ status, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('referral_rewards')
    .select('*, referrer:profiles!referral_rewards_referrer_id_fkey(id, full_name, email, account_status)', { count: 'exact' })
    .order('created_at', { ascending: false }).range(from, to);
  if (status) q = q.eq('status', status);
  return runPaged(q);
}

export async function findReward(id) {
  return one(db.from('referral_rewards').select('*').eq('id', id).maybeSingle());
}

export async function rewardReferrals(rewardId) {
  return run(db.from('referrals').select(`${REFERRAL_COLUMNS}, referred:profiles!referrals_referred_user_id_fkey(id, full_name, account_status)`)
    .eq('reward_id', rewardId));
}

export async function events({ referralId, rewardId }) {
  let q = db.from('referral_events').select('id, referral_id, reward_id, event, from_status, to_status, actor_id, reason, metadata, created_at').order('id');
  if (referralId) q = q.eq('referral_id', referralId);
  if (rewardId) q = q.eq('reward_id', rewardId);
  return run(q);
}

export async function findUserIds(search) {
  const s = String(search).trim();
  let q = db.from('profiles').select('id').limit(50);
  if (/^[0-9a-f-]{36}$/i.test(s)) q = q.eq('id', s);
  else if (s.includes('@')) q = q.ilike('email', likePattern(s));
  else if (/^\+?\d{7,14}$/.test(s)) q = q.ilike('phone', likePattern(s.replace(/^0/, '')));
  else return null;
  return (await run(q)).map((r) => r.id);
}

export async function userIdForBillReference(reference) {
  const row = await one(db.from('bill_payments').select('user_id').eq('reference', reference).maybeSingle());
  return row?.user_id ?? null;
}
