import { db, one, run, runPaged, rpc } from '../integrations/supabase/db.js';
import { likePattern, toRange } from '../utils/pagination.js';

// Payment attempts (initiation) ------------------------------------------------
export async function insertAttempt(row) {
  return one(db.from('payment_attempts').insert(row).select('*').maybeSingle());
}

export async function updateAttempt(id, patch) {
  return one(db.from('payment_attempts').update(patch).eq('id', id).select('*').maybeSingle());
}

export async function findAttemptByReference(reference) {
  return one(db.from('payment_attempts').select('*').eq('reference', reference).maybeSingle());
}

/** Reusable open checkout for the same target (double-click / refresh safety). */
export async function findOpenAttempt({ userId, purpose, targetId, amount, since }) {
  return one(
    db.from('payment_attempts').select('*')
      .eq('user_id', userId).eq('purpose', purpose).eq('target_id', targetId).eq('amount', amount)
      .eq('status', 'initialized').gte('created_at', since).not('authorization_url', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  );
}

export async function listStaleAttempts({ olderThan, newerThan, limit = 50 }) {
  return run(
    db.from('payment_attempts').select('reference, created_at').eq('status', 'initialized')
      .lt('created_at', olderThan).gte('created_at', newerThan).order('created_at').limit(limit),
  );
}

export async function abandonExpiredAttempts(olderThan) {
  return run(
    db.from('payment_attempts').update({ status: 'abandoned', gateway_response: 'expired' })
      .eq('status', 'initialized').lt('created_at', olderThan),
  );
}

export async function listAttempts({ userId, status, purpose, search, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db
    .from('payment_attempts')
    .select('id, reference, user_id, purpose, target_id, amount, status, channel, gateway_response, paid_at, created_at, user:profiles(full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (userId) q = q.eq('user_id', userId);
  if (status) q = q.eq('status', status);
  if (purpose) q = q.eq('purpose', purpose);
  if (search) q = q.ilike('reference', likePattern(search));
  return runPaged(q);
}

export async function confirmPayment(params) {
  return rpc('confirm_payment', params);
}

export async function markPaymentFailed(reference, status, reason) {
  return rpc('mark_payment_failed', { p_reference: reference, p_status: status, p_reason: reason });
}

// Webhooks --------------------------------------------------------------------
/** Returns the stored row, or null when this event was already received. */
export async function recordWebhook(row) {
  const { data, error } = await db
    .from('payment_webhooks')
    .upsert(row, { onConflict: 'event_key', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateWebhook(id, patch) {
  return run(db.from('payment_webhooks').update(patch).eq('id', id));
}

export async function listRetryableWebhooks(limit = 20) {
  return run(
    db.from('payment_webhooks').select('id, provider, event, payload, attempts').eq('status', 'failed')
      .lt('attempts', 5).order('received_at').limit(limit),
  );
}

// Ledger ------------------------------------------------------------------------
const TX_COLUMNS =
  'id, reference, user_id, group_id, collector_saver_id, bill_payment_id, type, direction, amount, currency, provider, ' +
  'provider_reference, status, description, metadata, created_at, completed_at, related_transaction_id, counterparty_user_id, ' +
  'collector_id, channel, session_id, processed_at, settled_at, failure_reason, dispute_case_id, destination_bank_name, ' +
  'destination_last4, created_by';

export async function listTransactions({ userId, type, status, from: fromDate, to: toDate, search, groupId, page, pageSize, withUser }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db
    .from('transactions')
    .select(withUser ? `${TX_COLUMNS}, user:profiles!transactions_user_id_fkey(full_name, email)` : TX_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (userId) q = q.eq('user_id', userId);
  if (groupId) q = q.eq('group_id', groupId);
  if (type) q = q.eq('type', type);
  if (status) q = q.eq('status', status);
  if (fromDate) q = q.gte('created_at', fromDate);
  if (toDate) q = q.lte('created_at', toDate);
  if (search) q = q.or(`reference.ilike.${likePattern(search)},description.ilike.${likePattern(search)},provider_reference.ilike.${likePattern(search)}`);
  return runPaged(q);
}

export async function findTransaction(id) {
  return one(db.from('transactions').select(TX_COLUMNS).eq('id', id).maybeSingle());
}

export async function findRefund({ providerReference, paymentReference }) {
  let q = db.from('transactions').select(TX_COLUMNS).eq('type', 'refund');
  q = providerReference ? q.eq('provider_reference', providerReference) : q.eq('metadata->>payment_reference', paymentReference);
  return one(q.order('created_at', { ascending: false }).limit(1).maybeSingle());
}

export async function listPendingRefunds({ olderThan, limit = 20 }) {
  return run(
    db.from('transactions').select(TX_COLUMNS).eq('type', 'refund').eq('status', 'pending')
      .lt('created_at', olderThan).order('created_at').limit(limit),
  );
}

export async function setRefundStatus(transactionId, status, providerReference) {
  return rpc('set_refund_status', { p_transaction_id: transactionId, p_status: status, p_provider_reference: providerReference ?? null });
}

export async function sumTransactions({ userId, types, status = 'success' }) {
  const rows = await run(db.from('transactions').select('amount').eq('user_id', userId).in('type', types).eq('status', status));
  return rows.reduce((s, r) => s + Number(r.amount), 0);
}

export async function findAttemptForTransaction(tx) {
  if (tx.provider !== 'paystack' || !tx.provider_reference) return null;
  return one(db.from('payment_attempts')
    .select('id, reference, purpose, target_id, amount, status, channel, gateway_response, paid_at, session_id, created_at')
    .eq('reference', tx.provider_reference).maybeSingle());
}

export async function relatedTransactions(id) {
  return run(db.from('transactions').select(TX_COLUMNS).eq('related_transaction_id', id).order('created_at'));
}
