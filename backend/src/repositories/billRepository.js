import { db, one, run, runPaged, rpc } from '../integrations/supabase/db.js';
import { likePattern, toRange } from '../utils/pagination.js';

const COLUMNS =
  'id, reference, user_id, category, service_id, variation_code, customer_identifier, customer_name, phone, amount, status, ' +
  'payment_reference, transaction_id, provider, provider_request_id, provider_reference, token, units, attempts, last_error, ' +
  'next_retry_at, created_at, updated_at, completed_at';

export async function insert(row) {
  return one(db.from('bill_payments').insert(row).select(COLUMNS).maybeSingle());
}

export async function find(id) {
  return one(db.from('bill_payments').select(COLUMNS).eq('id', id).maybeSingle());
}

export async function list({ userId, status, category, search, page, pageSize, withUser }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('bill_payments').select(withUser ? `${COLUMNS}, user:profiles(full_name, email)` : COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false }).range(from, to);
  if (userId) q = q.eq('user_id', userId);
  if (status) q = q.eq('status', status);
  if (category) q = q.eq('category', category);
  if (search) q = q.or(`reference.ilike.${likePattern(search)},customer_identifier.ilike.${likePattern(search)}`);
  return runPaged(q);
}

export async function listDueForRequery(limit = 20) {
  return run(
    db.from('bill_payments').select(COLUMNS).eq('status', 'processing')
      .lte('next_retry_at', new Date().toISOString()).lt('attempts', 15).order('next_retry_at').limit(limit),
  );
}

export async function listPaidNotDispatched(olderThanIso, limit = 20) {
  return run(db.from('bill_payments').select(COLUMNS).eq('status', 'paid').lt('updated_at', olderThanIso).limit(limit));
}

export async function cancelStaleAwaiting(olderThanIso) {
  return run(db.from('bill_payments').update({ status: 'cancelled' }).eq('status', 'awaiting_payment').lt('created_at', olderThanIso));
}

export async function recordResult(params) {
  return rpc('record_bill_result', params);
}
