import { db, one, run, runPaged } from '../integrations/supabase/db.js';
import { toRange } from '../utils/pagination.js';

// Admin accounts ------------------------------------------------------------------------
const ACCOUNT_COLUMNS = 'user_id, status, created_by, created_at, disabled_at, disabled_by, disabled_reason, failed_login_count, locked_until, last_login_at, mfa_reset_at';

export async function findAccount(userId) {
  return one(db.from('admin_accounts').select(ACCOUNT_COLUMNS).eq('user_id', userId).maybeSingle());
}

export async function insertAccount(row) {
  return one(db.from('admin_accounts').insert(row).select(ACCOUNT_COLUMNS).maybeSingle());
}

export async function updateAccount(userId, patch) {
  return one(db.from('admin_accounts').update(patch).eq('user_id', userId).select(ACCOUNT_COLUMNS).maybeSingle());
}

export async function listAccounts({ page, pageSize, status }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('admin_accounts')
    .select(`${ACCOUNT_COLUMNS}, profile:profiles!admin_accounts_user_id_fkey(id, full_name, email, account_status, user_roles!user_roles_user_id_fkey(role_code))`, { count: 'exact' })
    .order('created_at', { ascending: true }).range(from, to);
  if (status) q = q.eq('status', status);
  return runPaged(q);
}

export async function registerFailure(userId, maxFailures, lockMinutes) {
  const account = await findAccount(userId);
  if (!account) return null;
  const failures = (account.failed_login_count ?? 0) + 1;
  const patch = { failed_login_count: failures };
  if (failures >= maxFailures) {
    patch.locked_until = new Date(Date.now() + lockMinutes * 60_000).toISOString();
    patch.failed_login_count = 0;
  }
  return updateAccount(userId, patch);
}

// Authenticator factors & backup codes -------------------------------------------------------
export async function activeFactor(userId) {
  return one(db.from('admin_mfa_factors').select('id, user_id, secret_ciphertext, confirmed_at, last_used_step')
    .eq('user_id', userId).is('revoked_at', null).not('confirmed_at', 'is', null).maybeSingle());
}

export async function insertFactor(row) {
  return one(db.from('admin_mfa_factors').insert(row).select('id, confirmed_at').maybeSingle());
}

/** Advance the last-used step only if it is still older (no replay, even concurrently). */
export async function markFactorStep(id, step) {
  const rows = await run(db.from('admin_mfa_factors').update({ last_used_step: step })
    .eq('id', id).or(`last_used_step.is.null,last_used_step.lt.${step}`).select('id'));
  return rows.length === 1;
}

export async function revokeFactors(userId, reason) {
  return run(db.from('admin_mfa_factors').update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('user_id', userId).is('revoked_at', null).select('id'));
}

export async function replaceBackupCodes(userId, hashes) {
  await run(db.from('admin_backup_codes').update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId).is('used_at', null).is('revoked_at', null).select('id'));
  if (!hashes.length) return [];
  return run(db.from('admin_backup_codes').insert(hashes.map((code_hash) => ({ user_id: userId, code_hash }))).select('id'));
}

/** Consume one unused backup code atomically; true when it matched. */
export async function useBackupCode(userId, hash) {
  const rows = await run(db.from('admin_backup_codes').update({ used_at: new Date().toISOString() })
    .eq('user_id', userId).eq('code_hash', hash).is('used_at', null).is('revoked_at', null).select('id'));
  return rows.length === 1;
}

export async function countBackupCodes(userId) {
  const { count, error } = await db.from('admin_backup_codes').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).is('used_at', null).is('revoked_at', null);
  if (error) throw error;
  return count ?? 0;
}

// Pending sign-in (password verified, second factor pending) ---------------------------------
export async function insertChallenge(row) {
  return one(db.from('admin_login_challenges').insert(row).select('id, user_id, purpose, expires_at').maybeSingle());
}

export async function findChallenge(tokenHash) {
  return one(db.from('admin_login_challenges').select('*').eq('token_hash', tokenHash).maybeSingle());
}

export async function updateChallenge(id, patch) {
  return one(db.from('admin_login_challenges').update(patch).eq('id', id).select('id, attempts, consumed_at').maybeSingle());
}

/** Consume once (a second request with the same challenge fails). */
export async function consumeChallenge(id) {
  const rows = await run(db.from('admin_login_challenges').update({ consumed_at: new Date().toISOString() })
    .eq('id', id).is('consumed_at', null).select('id'));
  return rows.length === 1;
}

// Admin sessions ----------------------------------------------------------------------------
const SESSION_COLUMNS = 'id, user_id, device_label, ip_address, user_agent, mfa_method, created_at, last_active_at, expires_at, idle_minutes, step_up_at, ended_at, end_reason';

export async function insertSession(row) {
  return one(db.from('admin_sessions').insert(row).select(SESSION_COLUMNS).maybeSingle());
}

export async function findSessionByToken(tokenHash) {
  return one(db.from('admin_sessions').select(SESSION_COLUMNS).eq('token_hash', tokenHash).maybeSingle());
}

export async function findSession(id) {
  return one(db.from('admin_sessions').select(SESSION_COLUMNS).eq('id', id).maybeSingle());
}

export async function updateSession(id, patch) {
  return one(db.from('admin_sessions').update(patch).eq('id', id).select(SESSION_COLUMNS).maybeSingle());
}

export async function endSessions(userId, reason, { exceptId = null } = {}) {
  let q = db.from('admin_sessions').update({ ended_at: new Date().toISOString(), end_reason: reason })
    .eq('user_id', userId).is('ended_at', null);
  if (exceptId) q = q.neq('id', exceptId);
  return run(q.select('id'));
}

export async function listSessions({ userId = null, activeOnly = true, page = 1, pageSize = 50 }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('admin_sessions')
    .select(`${SESSION_COLUMNS}, account:admin_accounts!admin_sessions_user_id_fkey(profile:profiles!admin_accounts_user_id_fkey(id, full_name, email))`, { count: 'exact' })
    .order('last_active_at', { ascending: false }).range(from, to);
  if (userId) q = q.eq('user_id', userId);
  if (activeOnly) q = q.is('ended_at', null).gt('expires_at', new Date().toISOString());
  return runPaged(q);
}

export async function knownDevice(userId, deviceHash) {
  const { count, error } = await db.from('admin_sessions').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('device_hash', deviceHash);
  if (error) throw error;
  return (count ?? 0) > 0;
}

// Account status history ----------------------------------------------------------------------
export async function insertStatusHistory(row) {
  return one(db.from('account_status_history').insert(row).select('*').maybeSingle());
}

export async function statusHistory(userId, limit = 50) {
  return run(db.from('account_status_history')
    .select('id, previous_status, new_status, reason, expires_at, created_at, actor:profiles!account_status_history_actor_id_fkey(id, full_name)')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit));
}

/** Accounts whose time-limited restriction/suspension has run out. */
export async function expiredStatuses(nowIso, limit = 200) {
  return run(db.from('profiles').select('id, account_status, status_expires_at')
    .in('account_status', ['restricted', 'suspended', 'verification_required'])
    .not('status_expires_at', 'is', null).lte('status_expires_at', nowIso).limit(limit));
}

// Settings history & dashboard -----------------------------------------------------------------
export async function insertSettingChange(row) {
  return one(db.from('app_setting_changes').insert(row).select('*').maybeSingle());
}

export async function settingHistory(key, limit = 50) {
  return run(db.from('app_setting_changes')
    .select('id, setting_key, previous_value, new_value, reason, created_at, request_id, actor:profiles!app_setting_changes_actor_id_fkey(id, full_name)')
    .eq('setting_key', key).order('created_at', { ascending: false }).limit(limit));
}

export async function dashboardMetrics() {
  return run(db.rpc('admin_dashboard_metrics'));
}

// Admin security monitoring ----------------------------------------------------------------------
export async function adminAuditFeed({ page, pageSize, actions = null, actorId = null, from: fromDate = null, to: toDate = null }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('audit_logs')
    .select('id, action, resource_type, resource_id, result, reason, permission, request_id, admin_session_id, ip_address, created_at, metadata, actor:profiles!audit_logs_actor_id_fkey(id, full_name, email)', { count: 'exact' })
    .like('action', 'admin.%').order('created_at', { ascending: false }).range(from, to);
  if (actions?.length) q = q.in('action', actions);
  if (actorId) q = q.eq('actor_id', actorId);
  if (fromDate) q = q.gte('created_at', fromDate);
  if (toDate) q = q.lte('created_at', toDate);
  return runPaged(q);
}

// Provider health ---------------------------------------------------------------------------------
export async function getProviderHealth(provider) {
  return one(db.from('provider_health').select('*').eq('provider', provider).maybeSingle());
}

export async function saveProviderHealth(provider, patch) {
  return one(db.from('provider_health').update({ ...patch, updated_at: new Date().toISOString() }).eq('provider', provider).select('*').maybeSingle());
}
