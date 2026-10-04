import { db, one, rpc, run, runPaged } from '../integrations/supabase/db.js';
import { likePattern, toRange } from '../utils/pagination.js';

/**
 * ACHIEVER Wallet data access. Balances are a projection of the ledger and
 * change only inside SQL functions (wallet_* / _wallet_post); nothing here
 * writes wallet_accounts.balance or ledger rows directly.
 */
const ACCOUNT = 'id, kind, user_id, wallet_code, status, status_reason, balance, held, currency, created_at, updated_at';
const TX = 'id, reference, type, status, amount, fee, user_id, counterparty_user_id, description, payment_reference, bill_payment_id, group_id, reward_id, reverses_id, metadata, created_at, completed_at';
const TRANSFER = 'id, reference, sender_user_id, sender_wallet_id, recipient_wallet_id, amount, fee, note, status, idempotency_key, auth_method, authorized_at, transaction_id, failure_reason, reviewed_by, review_reason, expires_at, created_at, completed_at';
const MANDATE = 'id, user_id, source_wallet_id, destination_type, destination_id, amount, frequency, start_date, end_date, maximum_total, total_paid, max_attempts, retry_hours, status, auth_method, authorized_at, created_at, updated_at, cancelled_at, cancel_reason';

// Accounts ------------------------------------------------------------------------------------------
export async function ensureWallet(userId) {
  return rpc('ensure_wallet', { p_user_id: userId });
}

export async function findAccount(id) {
  return one(db.from('wallet_accounts').select(ACCOUNT).eq('id', id).maybeSingle());
}

export async function findAccountByUser(userId) {
  return one(db.from('wallet_accounts').select(ACCOUNT).eq('user_id', userId).maybeSingle());
}

/** Current account number, or a legacy ACHW-… ID kept as an alias. */
export async function findAccountByCode(code) {
  const id = await rpc('resolve_wallet_code', { p_code: code });
  if (!id) return null;
  return one(db.from('wallet_accounts').select(`${ACCOUNT}, owner:profiles!wallet_accounts_user_id_fkey(id, full_name, avatar_path, account_status)`)
    .eq('id', id).eq('kind', 'user').maybeSingle());
}

export async function setAccountStatus(id, status, reason) {
  return one(db.from('wallet_accounts').update({ status, status_reason: reason }).eq('id', id).eq('kind', 'user').select(ACCOUNT).maybeSingle());
}

// Transactions ---------------------------------------------------------------------------------------
const TYPE_GROUPS = {
  topup: ['topup'], transfer: ['transfer', 'bank_transfer'], bills: ['bill_payment'], osusu: ['osusu_contribution', 'collector_savings'],
  refunds: ['refund', 'reversal'], rewards: ['referral_reward'], adjustments: ['adjustment', 'fee'],
};

export async function listTransactions({ userId, type, page = 1, pageSize = 20, from, to }) {
  let q = db.from('wallet_transactions').select(TX, { count: 'exact' })
    .or(`user_id.eq.${userId},counterparty_user_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (type && TYPE_GROUPS[type]) q = q.in('type', TYPE_GROUPS[type]);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lt('created_at', to);
  const { from: a, to: b } = toRange({ page, pageSize });
  return runPaged(q.range(a, b));
}

export async function findTransaction(id) {
  return one(db.from('wallet_transactions').select(TX).eq('id', id).maybeSingle());
}

/** Ledger lines for one transaction (admin view / receipts). */
export async function ledgerFor(transactionId) {
  return run(db.from('wallet_ledger_entries').select('id, account_id, direction, amount, balance_after, created_at, account:wallet_accounts(kind, wallet_code)')
    .eq('transaction_id', transactionId).order('id'));
}

export async function sumOutgoingToday(userId, sinceIso) {
  const rows = await run(db.from('wallet_transfers').select('amount').eq('sender_user_id', userId)
    .in('status', ['SUCCESS', 'PENDING_REVIEW']).gte('created_at', sinceIso));
  return rows.reduce((t, r) => t + Number(r.amount), 0);
}

export async function countTransfersSince(userId, sinceIso) {
  const { count, error } = await db.from('wallet_transfers').select('id', { count: 'exact', head: true })
    .eq('sender_user_id', userId).gte('created_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}

export async function hasSentTo(userId, recipientWalletId) {
  const { count, error } = await db.from('wallet_transfers').select('id', { count: 'exact', head: true })
    .eq('sender_user_id', userId).eq('recipient_wallet_id', recipientWalletId).eq('status', 'SUCCESS');
  if (error) throw error;
  return (count ?? 0) > 0;
}

// Top-ups --------------------------------------------------------------------------------------------
export async function insertTopup(row) {
  return one(db.from('wallet_topups').insert(row).select('*').maybeSingle());
}

export async function findTopup(id) {
  return one(db.from('wallet_topups').select('*').eq('id', id).maybeSingle());
}

export async function findTopupByKey(userId, key) {
  return one(db.from('wallet_topups').select('*').eq('user_id', userId).eq('idempotency_key', key).maybeSingle());
}

export async function findTopupByReference(reference) {
  return one(db.from('wallet_topups').select('*').eq('payment_reference', reference).maybeSingle());
}

export async function updateTopup(id, patch) {
  return one(db.from('wallet_topups').update(patch).eq('id', id).select('*').maybeSingle());
}

export async function listTopups(userId, limit = 10) {
  return run(db.from('wallet_topups').select('id, amount, status, payment_reference, created_at, completed_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit));
}

export async function reverseTopup(topupId, reason, status = 'REVERSED') {
  return rpc('wallet_reverse_topup', { p_topup: topupId, p_reason: reason, p_status: status });
}

// Transfers ------------------------------------------------------------------------------------------
export async function insertTransfer(row) {
  return one(db.from('wallet_transfers').insert(row).select(TRANSFER).maybeSingle());
}

export async function findTransfer(id) {
  return one(db.from('wallet_transfers').select(TRANSFER).eq('id', id).maybeSingle());
}

export async function findTransferByKey(userId, key) {
  return one(db.from('wallet_transfers').select(TRANSFER).eq('sender_user_id', userId).eq('idempotency_key', key).maybeSingle());
}

/** Authorise once: only an AWAITING_AUTHORIZATION, not-yet-authorised transfer is updated. */
export async function markTransferAuthorized(id, { method, challengeId }) {
  return one(db.from('wallet_transfers').update({ authorized_at: new Date().toISOString(), auth_method: method, auth_challenge_id: challengeId })
    .eq('id', id).eq('status', 'AWAITING_AUTHORIZATION').is('authorized_at', null).select(TRANSFER).maybeSingle());
}

export async function cancelTransfer(id, userId) {
  return one(db.from('wallet_transfers').update({ status: 'CANCELLED', failure_reason: 'Cancelled by sender' })
    .eq('id', id).eq('sender_user_id', userId).eq('status', 'AWAITING_AUTHORIZATION').select(TRANSFER).maybeSingle());
}

export async function failTransfer(id, reason) {
  return run(db.from('wallet_transfers').update({ status: 'FAILED', failure_reason: String(reason).slice(0, 300), completed_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'AWAITING_AUTHORIZATION').select('id'));
}

export async function executeTransfer(id) {
  return rpc('wallet_execute_transfer', { p_transfer: id });
}

export async function reviewTransfer(id, actorId, approve, reason) {
  return rpc('wallet_review_transfer', { p_transfer: id, p_actor: actorId, p_approve: approve, p_reason: reason });
}

export async function listTransfersForReview() {
  return run(db.from('wallet_transfers').select(`${TRANSFER}, sender:profiles!wallet_transfers_sender_user_id_fkey(full_name, email)`)
    .eq('status', 'PENDING_REVIEW').order('created_at'));
}

// Payments from the wallet ---------------------------------------------------------------------------
export const payBill = (billId) => rpc('wallet_pay_bill', { p_bill: billId });
export const payOsusuContribution = (userId, contributionId) =>
  rpc('wallet_pay_osusu_contribution', { p_user: userId, p_contribution: contributionId, p_mandate: null });
export const payCollectorSavings = (userId, planId, amount) =>
  rpc('wallet_pay_collector_savings', { p_user: userId, p_plan: planId, p_amount: amount });
export const payReferralReward = (rewardId, actorId, reason) =>
  rpc('wallet_pay_referral_reward', { p_reward: rewardId, p_actor: actorId, p_reason: reason });

// Mandates -------------------------------------------------------------------------------------------
export async function insertMandate(row) {
  return one(db.from('wallet_payment_mandates').insert(row).select(MANDATE).maybeSingle());
}

export async function findMandate(id) {
  return one(db.from('wallet_payment_mandates').select(MANDATE).eq('id', id).maybeSingle());
}

export async function listMandates(userId) {
  return run(db.from('wallet_payment_mandates').select(`${MANDATE}, runs:wallet_mandate_runs(id, attempt, status, amount, reason, created_at)`)
    .eq('user_id', userId).order('created_at', { ascending: false }).order('created_at', { ascending: false, referencedTable: 'runs' })
    .limit(5, { referencedTable: 'runs' }));
}

export async function updateMandate(id, userId, patch, fromStatuses) {
  return one(db.from('wallet_payment_mandates').update(patch).eq('id', id).eq('user_id', userId).in('status', fromStatuses)
    .select(MANDATE).maybeSingle());
}

export const runMandates = () => rpc('run_wallet_mandates', { p_limit: 200 });

// Admin ----------------------------------------------------------------------------------------------
export async function stats() {
  const [accounts, system] = await Promise.all([
    run(db.from('wallet_accounts').select('balance, held, status').eq('kind', 'user')),
    run(db.from('wallet_accounts').select('kind, wallet_code, balance').neq('kind', 'user')),
  ]);
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [{ total: tx24h }, { total: pendingReview }, { total: pendingAdjust }] = await Promise.all([
    runPaged(db.from('wallet_transactions').select('id', { count: 'exact', head: true }).gte('created_at', since)),
    runPaged(db.from('wallet_transfers').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_REVIEW')),
    runPaged(db.from('wallet_adjustment_requests').select('id', { count: 'exact', head: true }).eq('status', 'PENDING')),
  ]);
  return {
    wallets: accounts.length,
    frozen: accounts.filter((a) => a.status !== 'active').length,
    totalBalance: accounts.reduce((t, a) => t + Number(a.balance), 0),
    totalHeld: accounts.reduce((t, a) => t + Number(a.held), 0),
    negative: accounts.filter((a) => Number(a.balance) < 0).length,
    system: system.map((s) => ({ kind: s.kind, code: s.wallet_code, balance: Number(s.balance) })),
    transactions24h: tx24h,
    pendingReview,
    pendingAdjustments: pendingAdjust,
  };
}

export async function searchAccounts({ q, status, page = 1, pageSize = 20 }) {
  let query = db.from('wallet_accounts').select(`${ACCOUNT}, owner:profiles!wallet_accounts_user_id_fkey!inner(full_name, email, phone)`, { count: 'exact' })
    .eq('kind', 'user').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (q) {
    const term = likePattern(q);
    if (/^ACHW-/i.test(q)) query = query.ilike('wallet_code', term);
    else query = query.or(`full_name.ilike.${term},email.ilike.${term}`, { referencedTable: 'owner' });
  }
  const { from: a, to: b } = toRange({ page, pageSize });
  return runPaged(query.range(a, b));
}

export async function listAccountTransactions(accountId, limit = 50) {
  const acct = await findAccount(accountId);
  if (!acct) return [];
  return run(db.from('wallet_transactions').select(TX).or(`user_id.eq.${acct.user_id},counterparty_user_id.eq.${acct.user_id}`)
    .order('created_at', { ascending: false }).limit(limit));
}

export async function insertAdjustment(row) {
  return one(db.from('wallet_adjustment_requests').insert(row).select('*').maybeSingle());
}

export async function listAdjustments(status) {
  let q = db.from('wallet_adjustment_requests').select('*, wallet:wallet_accounts(wallet_code, user_id), requester:profiles!wallet_adjustment_requests_requested_by_fkey(full_name)')
    .order('created_at', { ascending: false }).limit(100);
  if (status) q = q.eq('status', status);
  return run(q);
}

export const decideAdjustment = (id, actorId, approve, reason) =>
  rpc('wallet_decide_adjustment', { p_request: id, p_actor: actorId, p_approve: approve, p_reason: reason });

// Bank transfers --------------------------------------------------------------------------------------
const BANK = 'id, reference, user_id, wallet_id, bank_code, bank_name, account_number, account_name, recipient_code, amount, fee, total_debit, ' +
  'recipient_amount, fee_snapshot, narration, status, execution_mode, idempotency_key, auth_method, authorized_at, debit_transaction_id, ' +
  'refund_transaction_id, transfer_code, provider_reference, provider_status, provider_cost, provider_cost_estimated, failure_reason, ' +
  'processed_by, manual_reference, attempts, last_checked_at, expires_at, created_at, updated_at, completed_at';

export async function insertBankTransfer(row) {
  return one(db.from('wallet_bank_transfers').insert(row).select(BANK).maybeSingle());
}

export async function findBankTransfer(id) {
  return one(db.from('wallet_bank_transfers').select(BANK).eq('id', id).maybeSingle());
}

export async function findBankTransferByReference(reference) {
  return one(db.from('wallet_bank_transfers').select(BANK).eq('reference', reference).maybeSingle());
}

export async function findBankTransferByKey(userId, key) {
  return one(db.from('wallet_bank_transfers').select(BANK).eq('user_id', userId).eq('idempotency_key', key).maybeSingle());
}

export async function updateBankTransfer(id, patch, { fromStatus } = {}) {
  let q = db.from('wallet_bank_transfers').update(patch).eq('id', id);
  if (fromStatus) q = q.eq('status', fromStatus);
  return one(q.select(BANK).maybeSingle());
}

/** Authorise once: only an INITIATED, not-yet-authorised transfer is updated. */
export async function markBankTransferAuthorized(id, { method, challengeId }) {
  return one(db.from('wallet_bank_transfers').update({ authorized_at: new Date().toISOString(), auth_method: method, auth_challenge_id: challengeId })
    .eq('id', id).eq('status', 'INITIATED').is('authorized_at', null).select(BANK).maybeSingle());
}

export async function hasPaidAccount(userId, bankCode, accountNumber) {
  const { count, error } = await db.from('wallet_bank_transfers').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('bank_code', bankCode).eq('account_number', accountNumber).eq('status', 'SUCCESS');
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function recipientCodeFor(userId, bankCode, accountNumber) {
  const rows = await run(db.from('wallet_bank_transfers').select('recipient_code').eq('user_id', userId).eq('bank_code', bankCode)
    .eq('account_number', accountNumber).not('recipient_code', 'is', null).order('created_at', { ascending: false }).limit(1));
  return rows[0]?.recipient_code ?? null;
}

export async function listBankTransfers({ userId, status, page = 1, pageSize = 20, search }) {
  let q = db.from('wallet_bank_transfers').select(`${BANK}, user:profiles!wallet_bank_transfers_user_id_fkey(full_name, email)`, { count: 'exact' })
    .order('created_at', { ascending: false });
  if (userId) q = q.eq('user_id', userId);
  if (status) q = q.eq('status', status);
  if (search) q = q.ilike('reference', likePattern(search));
  const { from: a, to: b } = toRange({ page, pageSize });
  return runPaged(q.range(a, b));
}

/** Open transfers the job should push or check with the provider. */
/** The same transfer still in progress (same account and amount, last 2 hours): warn before sending it again. */
export async function findRecentOpenBankTransfer(userId, { bankCode, accountNumber, amount, excludeId = null }) {
  let q = db.from('wallet_bank_transfers').select('id, reference, status, created_at')
    .eq('user_id', userId).eq('bank_code', bankCode).eq('account_number', accountNumber).eq('amount', amount)
    .in('status', ['PENDING', 'PROCESSING']).gt('created_at', new Date(Date.now() - 2 * 3600_000).toISOString())
    .order('created_at', { ascending: false }).limit(1);
  if (excludeId) q = q.neq('id', excludeId);
  return one(q.maybeSingle());
}

/** Current status of several bank transfers at once (for the wallet history page). */
export async function bankTransferStatuses(ids) {
  if (!ids.length) return [];
  return run(db.from('wallet_bank_transfers').select('id, status').in('id', ids));
}

export async function listOpenBankTransfers({ olderThan, limit = 50 }) {
  return run(db.from('wallet_bank_transfers').select(BANK).in('status', ['PENDING', 'PROCESSING']).eq('execution_mode', 'paystack_transfer')
    .lt('updated_at', olderThan).order('updated_at').limit(limit));
}

export const debitBankTransfer = (id) => rpc('wallet_bank_transfer_debit', { p_id: id });
export const bankTransferProcessing = (id, transferCode, providerStatus) =>
  rpc('wallet_bank_transfer_processing', { p_id: id, p_transfer_code: transferCode ?? null, p_provider_status: providerStatus ?? null });
export const completeBankTransfer = (id, { providerReference = null, providerCost = null, estimated = false, actorId = null, manualReference = null } = {}) =>
  rpc('wallet_bank_transfer_complete', { p_id: id, p_provider_reference: providerReference, p_provider_cost: providerCost, p_cost_estimated: estimated, p_actor: actorId, p_manual_reference: manualReference });
export const failBankTransfer = (id, status, reason, actorId = null) =>
  rpc('wallet_bank_transfer_fail', { p_id: id, p_status: status, p_reason: reason, p_actor: actorId });
