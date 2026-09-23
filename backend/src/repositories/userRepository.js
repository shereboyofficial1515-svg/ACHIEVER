import { db, one, run, runPaged, rpc } from '../integrations/supabase/db.js';
import { likePattern, toRange } from '../utils/pagination.js';

const PROFILE_COLUMNS =
  'id, full_name, email, phone, address, date_of_birth, avatar_path, primary_account_type, account_status, status_reason, ' +
  'email_verified_at, phone_verified_at, failed_login_count, locked_until, last_login_at, last_seen_at, sessions_revoked_at, created_at';

export async function findById(id) {
  return one(db.from('profiles').select(`${PROFILE_COLUMNS}, user_roles(role_code)`).eq('id', id).maybeSingle());
}

export async function findByEmail(email) {
  return one(db.from('profiles').select(PROFILE_COLUMNS).eq('email', email.toLowerCase()).maybeSingle());
}

export async function findByPhone(phone) {
  return one(db.from('profiles').select('id').eq('phone', phone).maybeSingle());
}

export async function findManyBasic(ids) {
  if (!ids.length) return [];
  return run(db.from('profiles').select('id, full_name, avatar_path, last_seen_at').in('id', ids));
}

export async function createProfileWithRoles(params) {
  return rpc('create_profile_with_roles', params);
}

export async function update(id, patch) {
  return one(db.from('profiles').update(patch).eq('id', id).select(PROFILE_COLUMNS).maybeSingle());
}

export async function registerLoginFailure(userId, max, lockMinutes) {
  return rpc('register_login_failure', { p_user_id: userId, p_max: max, p_lock_minutes: lockMinutes });
}

export async function registerLoginSuccess(userId) {
  return rpc('register_login_success', { p_user_id: userId });
}

export async function touchLastSeen(userId) {
  await db.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId);
}

export async function getRoles(userId) {
  const rows = await run(db.from('user_roles').select('role_code').eq('user_id', userId));
  return rows.map((r) => r.role_code);
}

export async function addRole(userId, role, grantedBy = null) {
  return run(db.from('user_roles').upsert({ user_id: userId, role_code: role, granted_by: grantedBy }, { onConflict: 'user_id,role_code', ignoreDuplicates: true }));
}

export async function removeRole(userId, role) {
  return run(db.from('user_roles').delete().eq('user_id', userId).eq('role_code', role));
}

export async function search({ search, role, status, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db
    .from('profiles')
    .select(`id, full_name, email, phone, account_status, primary_account_type, email_verified_at, phone_verified_at,
             last_seen_at, created_at, user_roles${role ? '!inner' : ''}(role_code)`, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (search) q = q.or(`full_name.ilike.${likePattern(search)},email.ilike.${likePattern(search)},phone.ilike.${likePattern(search)}`);
  if (status) q = q.eq('account_status', status);
  if (role) q = q.eq('user_roles.role_code', role);
  return runPaged(q);
}

export async function listByRole(role) {
  const rows = await run(db.from('user_roles').select('user_id').eq('role_code', role));
  return rows.map((r) => r.user_id);
}

export async function listAllIds({ from, to }) {
  const rows = await run(db.from('profiles').select('id').eq('account_status', 'active').order('created_at').range(from, to));
  return rows.map((r) => r.id);
}

export async function getPayoutAccount(userId) {
  return one(db.from('payout_accounts').select('*').eq('user_id', userId).maybeSingle());
}

export async function upsertPayoutAccount(row) {
  return one(db.from('payout_accounts').upsert(row, { onConflict: 'user_id' }).select('*').maybeSingle());
}

export async function getPreferences(userId) {
  return one(db.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle());
}

export async function upsertPreferences(userId, patch) {
  return one(
    db.from('notification_preferences').upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' }).select('*').maybeSingle(),
  );
}
