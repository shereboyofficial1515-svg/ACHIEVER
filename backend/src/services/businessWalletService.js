import { env } from '../config/env.js';
import { db, one, rpc, run } from '../integrations/supabase/db.js';
import { paystack } from '../integrations/paystack/paystackClient.js';
import * as paymentService from './paymentService.js';
import * as auditService from './auditService.js';
import * as settingsService from './settingsService.js';
import * as vtpassHealth from './vtpass/health.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

/**
 * ACHIEVER business wallet = the platform's fee revenue (the SYS-FEES ledger account).
 *
 * It is NOT customer money. Customer wallets, OSUSU pools, collector pools, bill settlement
 * and payout clearing are reported separately and can never be withdrawn here: the database
 * functions only ever debit the fees account and refuse to take it below zero.
 *
 * Withdrawals go to ONE company payout account (verified with the bank, approved by a second
 * administrator, usable after a cooling-off period). Large withdrawals need a second admin.
 * The final status comes from Paystack (webhook / verify), never from "HTTP 200".
 */
export const REFERENCE_PREFIX = 'ACH-BWD-';
const mask = (n) => `****${String(n).slice(-4)}`;

const formatAccount = (a) => a && ({
  id: a.id, bankName: a.bank_name, bankCode: a.bank_code, accountNumber: mask(a.account_number), accountName: a.account_name,
  status: a.status, reason: a.reason, addedBy: a.added_by, approvedBy: a.approved_by, approvedAt: a.approved_at,
  activeFrom: a.active_from, usable: a.status === 'active' && a.active_from && new Date(a.active_from) <= new Date(), createdAt: a.created_at,
});
const formatWithdrawal = (w) => ({
  id: w.id, reference: w.reference, amount: Number(w.amount), status: w.status, reason: w.reason,
  requestedBy: w.requested_by, approvedBy: w.approved_by, approvedAt: w.approved_at, decisionNote: w.decision_note,
  transferCode: w.transfer_code, providerStatus: w.provider_status, failureReason: w.failure_reason,
  createdAt: w.created_at, updatedAt: w.updated_at, completedAt: w.completed_at,
  account: w.account ? { bankName: w.account.bank_name, accountNumber: mask(w.account.account_number), accountName: w.account.account_name } : undefined,
});

// Overview --------------------------------------------------------------------------------------
export async function overview() {
  const [o, vt, lowKobo, limits] = await Promise.all([
    rpc('finance_overview'),
    vtpassHealth.lastCheck(),
    settingsService.getInt('vtpass.low_balance_kobo', 5_000_000),
    Promise.all(['min', 'max', 'daily', 'monthly', 'dual_approval'].map((k) => settingsService.getInt(`business.withdrawal_${k}_kobo`, 0))),
  ]);
  const sys = o.system || {};
  const vtBalance = vt?.balance == null ? null : Number(vt.balance);
  return {
    // Money that belongs to members (a liability). Never withdrawable as revenue.
    customerFunds: {
      total: Number(o.customer.balance), held: Number(o.customer.held), available: Number(o.customer.available),
      restricted: Number(o.customer.restrictedBalance), wallets: Number(o.customer.wallets), fundedWallets: Number(o.customer.fundedWallets),
      osusuPool: Number(sys.osusu_pool || 0), collectorPool: Number(sys.collector_pool || 0),
    },
    // Money in transit (owed to banks / providers / members until settled).
    pending: {
      bankTransfersOpen: Number(o.bankTransfers.openAmount), bankTransfersOpenCount: Number(o.bankTransfers.openCount),
      payoutClearing: Number(sys.payout_clearing || 0), billSettlement: Number(sys.bill_settlement || 0), openBills: Number(o.bills.openCount),
    },
    // ACHIEVER revenue.
    business: {
      revenueBalance: Number(o.business.revenueBalance || 0), withdrawable: Number(o.business.available),
      awaitingApproval: Number(o.business.awaitingApproval), inProgress: Number(o.business.inProgress),
      withdrawn: Number(o.business.withdrawn), returned: Number(o.business.returned),
      vtpassCommissionEarned: Number(o.bills.vtpassCommission), rewardsAccount: Number(sys.rewards || 0), adjustments: Number(sys.adjustments || 0),
    },
    // Cash ACHIEVER should hold at Paystack per the books (top-ups in, payouts out).
    paystackBooks: -Number(sys.paystack_clearing || 0),
    vtpass: {
      balance: vtBalance, environment: vt?.environment || null, status: vt?.status || 'unknown', checkedAt: vt?.checked_at || null,
      lastSuccessAt: vt?.last_success_at || null, lastFailureAt: vt?.last_failure_at || null, lastError: vt?.last_error || null,
      lowBalanceThreshold: lowKobo, lowBalance: vtBalance != null && vtBalance < lowKobo,
    },
    limits: { min: limits[0], max: limits[1], daily: limits[2], monthly: limits[3], dualApprovalFrom: limits[4] },
    computedAt: o.computedAt,
  };
}

export const vtpassCheck = async (actor, req) => {
  const report = await vtpassHealth.runHealthCheck();
  await auditService.record({ actorId: actor.id, action: 'admin.provider.vtpass_health_check', resourceType: 'provider', resourceId: 'vtpass', metadata: { status: report.status }, req });
  return report;
};

// Company payout account ---------------------------------------------------------------------------
export async function listAccounts() {
  const rows = await run(db.from('business_bank_accounts').select('*').order('created_at', { ascending: false }).limit(20));
  return rows.map(formatAccount);
}

/** Propose the company account: the name comes from the bank (never typed), then a second admin approves. */
export async function proposeAccount(actor, { bankCode, accountNumber, reason }, req) {
  const bank = (await paymentService.listBanks()).find((b) => b.code === bankCode);
  if (!bank) throw AppError.badRequest('Choose a valid bank', 'INVALID_BANK');
  let resolved;
  try {
    resolved = await paystack.resolveAccount({ accountNumber, bankCode });
  } catch (err) {
    if (err.providerStatus && err.providerStatus < 500) throw AppError.unprocessable('The bank could not verify this account number', 'ACCOUNT_NOT_FOUND');
    throw err;
  }
  if (!resolved?.account_name) throw AppError.unprocessable('The bank could not verify this account number', 'ACCOUNT_NOT_FOUND');
  const row = await one(db.from('business_bank_accounts').insert({
    bank_code: bankCode, bank_name: bank.name, account_number: accountNumber, account_name: String(resolved.account_name).trim(),
    reason, added_by: actor.id,
  }).select('*').single());
  await auditService.record({ actorId: actor.id, action: 'business.payout_account.proposed', resourceType: 'business_bank_account', resourceId: row.id,
    metadata: { bank: bank.name, account: mask(accountNumber), reason }, req });
  return formatAccount(row);
}

export async function decideAccount(actor, id, { approve }, req) {
  const row = await rpc('business_bank_account_decide', { p_id: id, p_actor: actor.id, p_approve: approve });
  await auditService.record({ actorId: actor.id, action: `business.payout_account.${approve ? 'approve' : 'reject'}.request`, resourceType: 'business_bank_account', resourceId: id, req });
  return formatAccount(row);
}

// Withdrawals --------------------------------------------------------------------------------------
export async function listWithdrawals({ status } = {}) {
  let q = db.from('business_withdrawals').select('*, account:business_bank_accounts(bank_name, account_number, account_name)').order('created_at', { ascending: false }).limit(50);
  if (status) q = q.eq('status', status);
  return (await run(q)).map(formatWithdrawal);
}

const findWithdrawal = (id) => one(db.from('business_withdrawals').select('*, account:business_bank_accounts(*)').eq('id', id).maybeSingle());

export async function requestWithdrawal(actor, { amount, reason }, idempotencyKey, req) {
  const row = await rpc('business_withdrawal_request', { p_actor: actor.id, p_amount: amount, p_reason: reason, p_idempotency_key: idempotencyKey || null });
  await auditService.record({ actorId: actor.id, action: 'business.withdrawal.request', resourceType: 'business_withdrawal', resourceId: row.id, metadata: { amount, status: row.status }, req });
  if (row.status === 'PENDING') await dispatch(await findWithdrawal(row.id)).catch((err) => logger.warn({ id: row.id, err: err.message }, 'business withdrawal dispatch deferred'));
  return formatWithdrawal(await findWithdrawal(row.id));
}

export async function decideWithdrawal(actor, id, { approve, note }, req) {
  const row = await rpc('business_withdrawal_decide', { p_id: id, p_actor: actor.id, p_approve: approve, p_note: note || null });
  await auditService.record({ actorId: actor.id, action: `business.withdrawal.${approve ? 'approve' : 'reject'}.request`, resourceType: 'business_withdrawal', resourceId: id, req });
  if (approve && row.status === 'PENDING') await dispatch(await findWithdrawal(id)).catch((err) => logger.warn({ id, err: err.message }, 'business withdrawal dispatch deferred'));
  return formatWithdrawal(await findWithdrawal(id));
}

export async function cancelWithdrawal(actor, id) {
  await rpc('business_withdrawal_cancel', { p_id: id, p_actor: actor.id });
  return formatWithdrawal(await findWithdrawal(id));
}

/** Send a booked (PENDING) withdrawal with Paystack Transfers. The reference is fixed, so a retry can never pay twice. */
export async function dispatch(w) {
  if (!w || w.status !== 'PENDING') return { dispatched: false };
  if (!env.features.transfers) return { dispatched: false, reason: 'TRANSFERS_DISABLED' };   // stays PENDING (booked); finance can mark it later
  let recipient = w.account.recipient_code;
  if (!recipient) {
    const r = await paystack.createTransferRecipient({ name: w.account.account_name, accountNumber: w.account.account_number, bankCode: w.account.bank_code });
    recipient = r.recipient_code;
    await run(db.from('business_bank_accounts').update({ recipient_code: recipient }).eq('id', w.account.id));
  }
  try {
    const data = await paystack.initiateTransfer({ amount: Number(w.amount), recipientCode: recipient, reference: w.reference, reason: 'ACHIEVER revenue withdrawal' });
    const status = String(data.status || '').toLowerCase();
    if (status === 'failed' || status === 'reversed') await rpc('business_withdrawal_fail', { p_id: w.id, p_status: status === 'reversed' ? 'REVERSED' : 'FAILED', p_reason: `Provider status: ${status}` });
    else await rpc('business_withdrawal_processing', { p_id: w.id, p_transfer_code: data.transfer_code ?? null, p_provider_status: status });
    return { dispatched: true, status };
  } catch (err) {
    if (err.providerStatus && err.providerStatus < 500) {
      if (/duplicate|already/i.test(err.message)) {
        await rpc('business_withdrawal_processing', { p_id: w.id, p_transfer_code: null, p_provider_status: 'duplicate_reference' });
        return { dispatched: true, status: 'requery' };
      }
      await rpc('business_withdrawal_fail', { p_id: w.id, p_status: 'FAILED', p_reason: err.message.slice(0, 300) });   // back to revenue
      return { dispatched: false, reason: 'REJECTED' };
    }
    throw err;   // provider unreachable: stays PENDING; the job retries with the same reference
  }
}

async function applyStatus(w, status, data = {}) {
  if (status === 'success') await rpc('business_withdrawal_complete', { p_id: w.id });
  else if (status === 'failed' || status === 'abandoned') await rpc('business_withdrawal_fail', { p_id: w.id, p_status: 'FAILED', p_reason: data.reason || data.gateway_response || 'Failed at the bank' });
  else if (status === 'reversed') await rpc('business_withdrawal_fail', { p_id: w.id, p_status: 'REVERSED', p_reason: data.reason || 'Reversed by the bank' });
}

/** Paystack transfer.* webhook for a business withdrawal (signature already verified; repeats are harmless). */
export async function handleTransferEvent(event, data) {
  const w = await one(db.from('business_withdrawals').select('*').eq('reference', data.reference).maybeSingle());
  if (!w) { logger.warn({ event }, 'business withdrawal event for unknown reference'); return; }
  await applyStatus(w, event.split('.')[1], data);
}

/** Job: resend PENDING (same reference) and verify PROCESSING withdrawals with Paystack. */
export async function processOpen() {
  if (!env.features.transfers) return { checked: 0 };
  const rows = await run(db.from('business_withdrawals').select('*, account:business_bank_accounts(*)').in('status', ['PENDING', 'PROCESSING'])
    .lt('updated_at', new Date(Date.now() - 2 * 60_000).toISOString()).limit(20));
  for (const w of rows) {
    try {
      if (w.status === 'PENDING') await dispatch(w);
      else {
        const data = await paystack.verifyTransfer(w.reference);
        await run(db.from('business_withdrawals').update({ last_checked_at: new Date().toISOString(), provider_status: String(data.status || '').slice(0, 40) }).eq('id', w.id));
        await applyStatus(w, String(data.status || '').toLowerCase(), data);
      }
    } catch (err) {
      logger.warn({ id: w.id, err: err.message }, 'business withdrawal check failed');
    }
  }
  return { checked: rows.length };
}
