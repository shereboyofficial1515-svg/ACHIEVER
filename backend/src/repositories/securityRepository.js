import { db, one, run, runPaged } from '../integrations/supabase/db.js';
import { toRange } from '../utils/pagination.js';

// Permissions ------------------------------------------------------------------------
export async function listRolePermissions() {
  return run(db.from('role_permissions').select('role_code, permission_code'));
}

// Devices & sessions --------------------------------------------------------------------
export async function findDevice(userId, deviceIdHash) {
  return one(db.from('user_devices').select('*').eq('user_id', userId).eq('device_id_hash', deviceIdHash).maybeSingle());
}

export async function insertDevice(row) {
  return one(db.from('user_devices').insert(row).select('*').maybeSingle());
}

export async function updateDevice(id, patch) {
  return one(db.from('user_devices').update(patch).eq('id', id).select('*').maybeSingle());
}

export async function countDevices(userId) {
  const { count, error } = await db.from('user_devices').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (error) throw error;
  return count ?? 0;
}

export async function insertSession(row) {
  return one(db.from('user_sessions').insert(row).select('*').maybeSingle());
}

export async function findSession(id) {
  return one(db.from('user_sessions').select('id, user_id, device_id, created_at, last_active_at, step_up_at, revoked_at').eq('id', id).maybeSingle());
}

export async function updateSession(id, patch) {
  return one(db.from('user_sessions').update(patch).eq('id', id).select('id, user_id, step_up_at, revoked_at').maybeSingle());
}

export async function listSessions(userId, { activeOnly = true, limit = 50 } = {}) {
  let q = db.from('user_sessions')
    .select('id, auth_method, ip_address, user_agent, created_at, last_active_at, revoked_at, revoked_reason, device:user_devices(id, label, device_type, os, browser)')
    .eq('user_id', userId).order('last_active_at', { ascending: false }).limit(limit);
  if (activeOnly) q = q.is('revoked_at', null);
  return run(q);
}

export async function revokeSessions(userId, { exceptId = null, reason }) {
  let q = db.from('user_sessions').update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('user_id', userId).is('revoked_at', null);
  if (exceptId) q = q.neq('id', exceptId);
  return run(q.select('id'));
}

// Security events & account change history -------------------------------------------------
export async function insertSecurityEvent(row) {
  return one(db.from('security_events').insert(row).select('*').maybeSingle());
}

export async function countRecentSecurityEvents(userId, eventType, sinceIso) {
  const { count, error } = await db.from('security_events').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('event_type', eventType).gte('created_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}

export async function listSecurityEvents({ userId, status, severity, eventType, relatedTransactionId, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('security_events')
    .select('*, user:profiles!security_events_user_id_fkey(id, full_name, email), reviewer:profiles!security_events_reviewed_by_fkey(full_name)', { count: 'exact' })
    .order('created_at', { ascending: false }).range(from, to);
  if (userId) q = q.eq('user_id', userId);
  if (status) q = q.eq('status', status);
  if (severity) q = q.eq('severity', severity);
  if (eventType) q = q.eq('event_type', eventType);
  if (relatedTransactionId) q = q.eq('related_transaction_id', relatedTransactionId);
  return runPaged(q);
}

export async function findSecurityEvent(id) {
  return one(db.from('security_events').select('*').eq('id', id).maybeSingle());
}

export async function updateSecurityEvent(id, patch) {
  return one(db.from('security_events').update(patch).eq('id', id).select('*').maybeSingle());
}

export async function insertAccountChange(row) {
  return run(db.from('account_change_history').insert(row));
}

export async function listAccountChanges(userId, limit = 50) {
  return run(db.from('account_change_history')
    .select('id, event_type, previous_ref, new_ref, actor_id, reason, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit));
}

// Data access log ------------------------------------------------------------------------
export async function insertDataAccess(row) {
  return run(db.from('data_access_logs').insert(row));
}

export async function listDataAccess({ actorId, subjectUserId, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('data_access_logs')
    .select('*, actor:profiles!data_access_logs_actor_id_fkey(full_name, email), subject:profiles!data_access_logs_subject_user_id_fkey(full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false }).range(from, to);
  if (actorId) q = q.eq('actor_id', actorId);
  if (subjectUserId) q = q.eq('subject_user_id', subjectUserId);
  return runPaged(q);
}
