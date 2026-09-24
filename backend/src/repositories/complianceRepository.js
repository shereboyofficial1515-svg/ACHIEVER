import { db, one, run, runPaged, rpc } from '../integrations/supabase/db.js';
import { toRange } from '../utils/pagination.js';

// Locations (reference data) ------------------------------------------------------------
export async function listStates() {
  return run(db.from('ng_states').select('code, name').order('name'));
}

export async function listLgas(stateCode) {
  return run(db.from('ng_lgas').select('id, name').eq('state_code', stateCode).order('name'));
}

export async function findLga(id) {
  return one(db.from('ng_lgas').select('id, name, state_code').eq('id', id).maybeSingle());
}

export async function findState(code) {
  return one(db.from('ng_states').select('code, name').eq('code', code).maybeSingle());
}

// KYC ------------------------------------------------------------------------------------
export async function recomputeKyc(userId) {
  return rpc('recompute_kyc', { p_user_id: userId });
}

export async function getKyc(userId) {
  return one(db.from('kyc_profiles').select('*').eq('user_id', userId).maybeSingle());
}

export async function updateKyc(userId, patch) {
  return one(db.from('kyc_profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', userId).select('*').maybeSingle());
}

export async function listKycEvents(userId, limit = 50) {
  return run(db.from('kyc_events').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit));
}

export async function listKyc({ status, level, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('kyc_profiles')
    .select('*, user:profiles!kyc_profiles_user_id_fkey(id, full_name, email)', { count: 'exact' })
    .order('updated_at', { ascending: false }).range(from, to);
  if (status) q = q.eq('status', status);
  if (level !== undefined) q = q.eq('level', level);
  return runPaged(q);
}

// Risk profiles ----------------------------------------------------------------------------
export async function getRiskFactors(userId) {
  return one(db.from('risk_profile_factors').select('*').eq('user_id', userId).maybeSingle());
}

export async function getRiskProfile(userId) {
  return one(db.from('risk_profiles').select('*').eq('user_id', userId).maybeSingle());
}

export async function upsertRiskProfile(row) {
  return one(db.from('risk_profiles').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).select('*').maybeSingle());
}

export async function listRiskProfiles({ riskStatus, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('risk_profiles')
    .select('*, user:profiles!risk_profiles_user_id_fkey(id, full_name, email)', { count: 'exact' })
    .order('updated_at', { ascending: false }).range(from, to);
  q = riskStatus ? q.eq('risk_status', riskStatus) : q.neq('risk_status', 'normal');
  return runPaged(q);
}

// Payment account change history ---------------------------------------------------------
export async function insertPaymentAccountChange(row) {
  return run(db.from('payment_account_changes').insert(row));
}

export async function listPaymentAccountChanges(userId, limit = 20) {
  return run(db.from('payment_account_changes')
    .select('id, previous_bank_name, previous_last4, new_bank_name, new_last4, new_account_name, verification_method, cooldown_until, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit));
}

// Sensitive action (two-person) requests ------------------------------------------------
const REQUEST_COLUMNS = '*, requester:profiles!sensitive_action_requests_requested_by_fkey(full_name, email), decider:profiles!sensitive_action_requests_decided_by_fkey(full_name)';

export async function insertApproval(row) {
  return one(db.from('sensitive_action_requests').insert(row).select(REQUEST_COLUMNS).maybeSingle());
}

export async function findApproval(id) {
  return one(db.from('sensitive_action_requests').select(REQUEST_COLUMNS).eq('id', id).maybeSingle());
}

export async function findOpenApproval(action, targetId) {
  return one(db.from('sensitive_action_requests').select(REQUEST_COLUMNS).eq('action', action).eq('target_id', targetId)
    .in('status', ['pending', 'approved']).maybeSingle());
}

export async function updateApproval(id, patch, expectedStatus) {
  let q = db.from('sensitive_action_requests').update(patch).eq('id', id);
  if (expectedStatus) q = q.eq('status', expectedStatus);
  return one(q.select(REQUEST_COLUMNS).maybeSingle());
}

export async function listApprovals({ status, action, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('sensitive_action_requests').select(REQUEST_COLUMNS, { count: 'exact' })
    .order('requested_at', { ascending: false }).range(from, to);
  if (status) q = q.eq('status', status);
  if (action) q = q.eq('action', action);
  return runPaged(q);
}

export async function reverseTransaction(transactionId, requestId, executorId) {
  return rpc('reverse_transaction', { p_transaction_id: transactionId, p_request_id: requestId, p_executor: executorId });
}

export async function recordAdjustment(requestId, executorId) {
  return rpc('record_adjustment', { p_request_id: requestId, p_executor: executorId });
}

export async function consumeApproval(requestId, action, targetId, executorId) {
  return rpc('_consume_approval', { p_request_id: requestId, p_action: action, p_target: targetId, p_executor: executorId });
}

// Collector approval & trust ---------------------------------------------------------------
export async function setCollectorStatus(accountId, status, actorId, reason, requestId = null) {
  return rpc('set_collector_status', { p_account_id: accountId, p_status: status, p_actor: actorId, p_reason: reason, p_request_id: requestId });
}

export async function collectorHistory(accountId) {
  return run(db.from('collector_status_history').select('id, from_status, to_status, reason, created_at, actor:profiles(full_name)')
    .eq('collector_account_id', accountId).order('created_at', { ascending: false }));
}

export async function collectorTrustStats(accountId) {
  return one(db.from('collector_trust_stats').select('*').eq('collector_account_id', accountId).maybeSingle());
}

export async function userTrustProfile(userId) {
  return one(db.from('user_trust_profile').select('*').eq('user_id', userId).maybeSingle());
}

export async function memberStats(groupId, userId) {
  let q = db.from('osusu_member_stats').select('*').eq('group_id', groupId);
  if (userId) q = q.eq('user_id', userId);
  return run(q);
}

// Dashboards -------------------------------------------------------------------------------
export async function complianceOverview() {
  return rpc('compliance_overview');
}

export async function runComplianceChecks() {
  return rpc('run_compliance_checks');
}
