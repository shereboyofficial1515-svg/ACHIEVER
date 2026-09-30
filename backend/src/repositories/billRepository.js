import { db, one, run, runPaged, rpc } from '../integrations/supabase/db.js';
import { likePattern, toRange } from '../utils/pagination.js';

const COLUMNS =
  'id, reference, user_id, category, service_id, service_name, variation_code, customer_identifier, customer_name, phone, amount, fee, ' +
  'total_amount, provider_cost, quantity, subscription_type, verified_customer, status, payment_reference, transaction_id, provider, ' +
  'provider_request_id, provider_reference, provider_transaction_id, secure_payload, token, units, attempts, last_error, last_provider_code, ' +
  'next_retry_at, auth_method, auth_challenge_id, authorized_at, quote_expires_at, idempotency_key, reversed_at, created_at, updated_at, completed_at';

// Bills -------------------------------------------------------------------------------------------
export async function insert(row) {
  return one(db.from('bill_payments').insert(row).select(COLUMNS).maybeSingle());
}

export async function find(id) {
  return one(db.from('bill_payments').select(COLUMNS).eq('id', id).maybeSingle());
}

export async function findByRequestId(requestId) {
  return one(db.from('bill_payments').select(COLUMNS).eq('provider_request_id', requestId).maybeSingle());
}

export async function findByIdempotencyKey(userId, key) {
  return one(db.from('bill_payments').select(COLUMNS).eq('user_id', userId).eq('idempotency_key', key).maybeSingle());
}

export async function update(id, patch, { fromStatus } = {}) {
  let q = db.from('bill_payments').update(patch).eq('id', id);
  if (fromStatus) q = q.eq('status', fromStatus);
  return one(q.select(COLUMNS).maybeSingle());
}

const LIST_STATUSES = {
  PENDING: ['awaiting_payment', 'paid'],
  PROCESSING: ['processing'],
  SUCCESS: ['delivered'],
  FAILED: ['failed', 'refund_pending'],
  REVERSED: ['reversed'],
  REFUNDED: ['refunded'],
  CANCELLED: ['cancelled'],
};

export async function list({ userId, status, category, serviceId, search, page, pageSize, withUser, fromDate, toDate, requestId, providerTransactionId }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('bill_payments').select(withUser ? `${COLUMNS}, user:profiles(full_name, email)` : COLUMNS, { count: 'exact' })
    .neq('status', 'awaiting_authorization')
    .order('created_at', { ascending: false }).range(from, to);
  if (userId) q = q.eq('user_id', userId);
  if (status) q = LIST_STATUSES[status] ? q.in('status', LIST_STATUSES[status]) : q.eq('status', status);
  if (category) q = q.eq('category', category);
  if (serviceId) q = q.eq('service_id', serviceId);
  if (fromDate) q = q.gte('created_at', fromDate);
  if (toDate) q = q.lte('created_at', toDate);
  if (requestId) q = q.eq('provider_request_id', requestId);
  if (providerTransactionId) q = q.eq('provider_transaction_id', providerTransactionId);
  if (search) q = q.or(`reference.ilike.${likePattern(search)},provider_request_id.ilike.${likePattern(search)},provider_transaction_id.ilike.${likePattern(search)}`);
  return runPaged(q);
}

export async function listDueForRequery(limit = 20) {
  return run(
    db.from('bill_payments').select(COLUMNS).eq('status', 'processing')
      .lte('next_retry_at', new Date().toISOString()).lt('attempts', 30).order('next_retry_at').limit(limit),
  );
}

export async function listPaidNotDispatched(olderThanIso, limit = 20) {
  return run(db.from('bill_payments').select(COLUMNS).eq('status', 'paid').lt('updated_at', olderThanIso).limit(limit));
}

/** Processing bills whose automatic requeries are exhausted: need reconciliation. */
export async function listStuckProcessing(limit = 50) {
  return run(db.from('bill_payments').select(COLUMNS).eq('status', 'processing').gte('attempts', 30).limit(limit));
}

export async function cancelStaleAwaiting(olderThanIso) {
  return run(db.from('bill_payments').update({ status: 'cancelled' }).eq('status', 'awaiting_payment').lt('created_at', olderThanIso).select('id'));
}

export async function cancelExpiredQuotes(nowIso) {
  return run(db.from('bill_payments').update({ status: 'cancelled' }).eq('status', 'awaiting_authorization').lt('quote_expires_at', nowIso).select('id'));
}

export async function recordResult(params) {
  return rpc('record_bill_result', params);
}

export async function recordReversal(params) {
  return rpc('record_bill_reversal', params);
}

export async function events(billId) {
  return run(db.from('bill_transaction_events').select('id, from_status, to_status, source, provider_code, note, created_at')
    .eq('bill_id', billId).order('id'));
}

export async function logProviderResponse(row) {
  return run(db.from('bill_provider_responses').insert(row));
}

export async function providerResponses(billId) {
  return run(db.from('bill_provider_responses').select('id, kind, http_status, code, status, payload, created_at').eq('bill_id', billId).order('id'));
}

export async function insertReconciliation(row) {
  return run(db.from('bill_reconciliation').insert(row));
}

export async function listReconciliation({ open = true, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('bill_reconciliation').select('*, bill:bill_payments(reference, category, service_name, total_amount, status)', { count: 'exact' })
    .order('created_at', { ascending: false }).range(from, to);
  if (open) q = q.in('outcome', ['mismatch', 'unresolved']).is('resolved_at', null);
  return runPaged(q);
}

export async function resolveReconciliation(id, patch) {
  return one(db.from('bill_reconciliation').update(patch).eq('id', id).is('resolved_at', null).select('*').maybeSingle());
}

// Catalogue cache ---------------------------------------------------------------------------------
export async function listServices(category) {
  let q = db.from('bill_services').select('*').order('name');
  if (category) q = q.eq('category', category);
  return run(q);
}

export async function findService(serviceId) {
  return one(db.from('bill_services').select('*').eq('service_id', serviceId).maybeSingle());
}

export async function upsertServices(rows) {
  if (!rows.length) return [];
  return run(db.from('bill_services').upsert(rows, { onConflict: 'service_id', ignoreDuplicates: false }).select('service_id'));
}

export async function markServicesUnavailable(category, keepIds) {
  let q = db.from('bill_services').update({ available: false }).eq('category', category);
  if (keepIds.length) q = q.not('service_id', 'in', `(${keepIds.map((id) => `"${id}"`).join(',')})`);
  return run(q.select('service_id'));
}

export async function updateService(serviceId, patch) {
  return one(db.from('bill_services').update({ ...patch, changed_at: new Date().toISOString() }).eq('service_id', serviceId).select('*').maybeSingle());
}

export async function serviceStats() {
  return rpc('bill_service_stats', {});
}

export async function listProducts(serviceId) {
  return run(db.from('bill_products').select('*').eq('service_id', serviceId).eq('available', true).order('amount'));
}

export async function replaceProducts(serviceId, rows) {
  await run(db.from('bill_products').update({ available: false }).eq('service_id', serviceId).select('variation_code'));
  if (rows.length) await run(db.from('bill_products').upsert(rows, { onConflict: 'service_id,variation_code' }).select('variation_code'));
}
