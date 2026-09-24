import { db, one, run, runPaged, rpc } from '../integrations/supabase/db.js';
import { toRange } from '../utils/pagination.js';

const COLUMNS = 'id, user_id, request_type, status, reason, cancellable_until, decided_by, decided_at, decision_note, retained_summary, completed_at, cancelled_at, created_at, updated_at';

export async function insert(row) {
  return one(db.from('data_deletion_requests').insert(row).select(COLUMNS).maybeSingle());
}

export async function find(id) {
  return one(db.from('data_deletion_requests')
    .select(`${COLUMNS}, user:profiles!data_deletion_requests_user_id_fkey(id, full_name, email, account_status)`)
    .eq('id', id).maybeSingle());
}

export async function listForUser(userId) {
  return run(db.from('data_deletion_requests').select(COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }));
}

export async function openForUser(userId, type) {
  return one(db.from('data_deletion_requests').select(COLUMNS).eq('user_id', userId).eq('request_type', type)
    .in('status', ['pending', 'in_review']).maybeSingle());
}

/** Conditional update: only applies when the row is still in one of `fromStatuses`. */
export async function transition(id, fromStatuses, patch) {
  return one(db.from('data_deletion_requests').update(patch).eq('id', id).in('status', fromStatuses).select(COLUMNS).maybeSingle());
}

export async function list({ status, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('data_deletion_requests')
    .select(`${COLUMNS}, user:profiles!data_deletion_requests_user_id_fkey(id, full_name, email)`, { count: 'exact' })
    .order('created_at', { ascending: true }).range(from, to);
  if (status) q = q.eq('status', status);
  return runPaged(q);
}

export async function eraseOptionalPersonalData(userId, actorId, requestId) {
  return rpc('erase_optional_personal_data', { p_user_id: userId, p_actor: actorId, p_request_id: requestId });
}
