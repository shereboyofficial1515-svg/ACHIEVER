import { env } from '../config/env.js';
import { paystack } from '../integrations/paystack/paystackClient.js';
import * as walletRepo from '../repositories/walletRepository.js';
import * as txRepo from '../repositories/transactionSecurityRepository.js';
import * as riskRepo from '../repositories/riskRepository.js';
import * as paymentService from './paymentService.js';
import * as settingsService from './settingsService.js';
import * as transactionAuth from './transactionAuthService.js';
import * as feeService from './feeService.js';
import * as auditService from './auditService.js';
import * as notificationService from './notificationService.js';
import * as riskService from './riskService.js';
import { AppError } from '../utils/AppError.js';
import { newPaymentReference } from '../utils/crypto.js';
import { pageMeta } from '../utils/pagination.js';
import { logger } from '../utils/logger.js';

/**
 * ACHIEVER Wallet → Nigerian bank account.
 *
 *   select bank → account number → verified with the bank (server-side) →
 *   amount → fee from the fee engine → review → approve (PIN / PIN + email
 *   code / biometric) → wallet debited once (database, row locks) → Paystack
 *   Transfer (or the manual payout queue) → final status only from the
 *   provider's webhook or a verify/requery — never from "HTTP 200".
 *
 * Failures and reversals return the full debit, fee included, automatically.
 */
export const REFERENCE_PREFIX = 'ACH-WBT';
const naira = (k) => `₦${(Number(k) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const maskAccount = (n) => `******${String(n).slice(-4)}`;

/** Paystack's published NGN transfer fees (used only when the provider does not report the fee). */
export function estimateProviderCost(amount) {
  if (amount <= 500_000) return 1_000;
  if (amount <= 5_000_000) return 2_500;
  return 5_000;
}

async function assertOpen() {
  const [walletOn, bankOn] = await Promise.all([
    settingsService.getBool('wallet.enabled', true),
    settingsService.getInt('wallet.bank_transfers_enabled', 1),
  ]);
  if (!walletOn || !bankOn) throw AppError.unavailable('Bank transfers are temporarily unavailable. Please try again later.', 'BANK_TRANSFERS_DISABLED');
}

async function bankName(bankCode) {
  const banks = await paymentService.listBanks();
  const bank = banks.find((b) => b.code === bankCode);
  if (!bank) throw AppError.badRequest('Choose a valid bank', 'INVALID_BANK');
  return bank.name;
}

/** Name enquiry with the bank. The name shown to the member comes from here, never from the app. */
export async function resolveAccount(user, { bankCode, accountNumber }) {
  await assertOpen();
  const name = await bankName(bankCode);
  let data;
  try {
    data = await paystack.resolveAccount({ accountNumber, bankCode });
  } catch (err) {
    if (err.providerStatus && err.providerStatus < 500) throw AppError.unprocessable('We could not verify this account number with the bank. Check the bank and number.', 'ACCOUNT_NOT_FOUND');
    throw err;
  }
  if (!data?.account_name) throw AppError.unprocessable('We could not verify this account number with the bank.', 'ACCOUNT_NOT_FOUND');
  return { bankCode, bankName: name, accountNumber, accountName: String(data.account_name).trim(), verified: true };
}

const hashOf = (t) => transactionAuth.hashFor('wallet_bank_transfer', [t.id, t.user_id, t.bank_code, t.account_number, t.account_name, t.amount, t.fee, t.total_debit, t.recipient_amount]);
const targetOf = (t) => ({ purpose: 'wallet_bank_transfer', id: t.id, hash: hashOf(t), amount: Number(t.total_debit) });

async function approvalFor(user, t) {
  const options = await transactionAuth.approvalOptions(user, { amount: Number(t.total_debit), purpose: 'wallet_bank_transfer' });
  const known = await walletRepo.hasPaidAccount(user.id, t.bank_code, t.account_number);
  const stepUp = await settingsService.getInt('wallet.new_recipient_step_up_kobo', 2_000_000);
  if (!known && Number(t.amount) >= stepUp && options.methods.includes('pin')) {
    return { ...options, methods: options.methods.filter((m) => m !== 'pin'), stepUpRequired: true,
      reason: 'This is your first transfer to this bank account, so we also send a code to your email.', newAccount: true };
  }
  return { ...options, newAccount: !known };
}

export function format(t, { admin = false } = {}) {
  return {
    id: t.id, reference: t.reference, status: t.status,
    bankCode: t.bank_code, bankName: t.bank_name, accountNumber: admin ? t.account_number : maskAccount(t.account_number), accountName: t.account_name,
    amount: Number(t.amount), fee: Number(t.fee), totalDebit: Number(t.total_debit), recipientAmount: Number(t.recipient_amount),
    feeBearingMode: t.fee_snapshot?.fee_bearing_mode ?? 'FEE_ADDED', feeRule: t.fee_snapshot?.rule ?? null,
    narration: t.narration, failureReason: t.failure_reason, createdAt: t.created_at, completedAt: t.completed_at, expiresAt: t.expires_at,
    message: {
      INITIATED: 'Waiting for your approval', PENDING: 'Transfer queued', PROCESSING: 'Transfer is being processed by the bank',
      SUCCESS: 'Transfer successful', FAILED: 'Transfer failed. The money (including the fee) is back in your wallet.',
      REVERSED: 'The bank returned this transfer. The money (including the fee) is back in your wallet.',
      REFUNDED: 'This transfer was cancelled and refunded to your wallet.', CANCELLED: 'Cancelled',
    }[t.status],
    ...(admin ? {
      executionMode: t.execution_mode, transferCode: t.transfer_code, providerReference: t.provider_reference, providerStatus: t.provider_status,
      providerCost: t.provider_cost == null ? null : Number(t.provider_cost), providerCostEstimated: t.provider_cost_estimated,
      manualReference: t.manual_reference, attempts: t.attempts, user: t.user ? { name: t.user.full_name, email: t.user.email } : undefined,
    } : {}),
  };
}

/** Review (nothing moves). The fee is priced by the database when the row is created. */
export async function start(user, { bankCode, accountNumber, amount, narration }, idempotencyKey) {
  await assertOpen();
  await riskService.assertNotRestricted(user.id);
  if (idempotencyKey) {
    const existing = await walletRepo.findBankTransferByKey(user.id, idempotencyKey);
    if (existing) return { ...format(existing), approval: await approvalFor(user, existing) };
  }
  const min = await settingsService.getInt('wallet.bank_transfer_min_kobo', 10_000);
  const max = await settingsService.getInt('wallet.bank_transfer_single_max_kobo', 20_000_000);
  if (!Number.isSafeInteger(amount) || amount < min) throw AppError.badRequest(`The minimum bank transfer is ${naira(min)}`, 'AMOUNT_TOO_LOW');
  if (amount > max) throw AppError.badRequest(`The maximum single bank transfer is ${naira(max)}`, 'AMOUNT_TOO_HIGH');

  await walletRepo.ensureWallet(user.id);
  const wallet = await walletRepo.findAccountByUser(user.id);
  if (wallet.status !== 'active') throw AppError.forbidden('Your wallet cannot send money right now. Contact support.', 'WALLET_NOT_ACTIVE');
  const account = await resolveAccount(user, { bankCode, accountNumber });   // verified again here; never trusted from the app
  const preview = await feeService.preview('bank_transfer', amount);
  if (Number(wallet.balance) - Number(wallet.held) < preview.totalDebit) {
    throw AppError.unprocessable(`Insufficient balance. You need ${naira(preview.totalDebit)} (amount + ${naira(preview.fee)} fee).`, 'INSUFFICIENT_FUNDS');
  }
  const row = await walletRepo.insertBankTransfer({
    reference: newPaymentReference(REFERENCE_PREFIX), user_id: user.id, wallet_id: wallet.id,
    bank_code: account.bankCode, bank_name: account.bankName, account_number: account.accountNumber, account_name: account.accountName,
    amount, total_debit: amount, recipient_amount: amount, fee_snapshot: {},   // replaced by the database's fee engine
    narration: narration || null, idempotency_key: idempotencyKey || null,
  });
  await auditService.record({ actorId: user.id, action: 'wallet.bank_transfer.initiated', resourceType: 'wallet_bank_transfer', resourceId: row.id,
    metadata: { amount, fee: Number(row.fee), bank: row.bank_name, account: maskAccount(row.account_number) } });
  return { ...format(row), approval: await approvalFor(user, row) };
}

async function openTransfer(user, id) {
  const t = await walletRepo.findBankTransfer(id);
  if (!t || t.user_id !== user.id) throw AppError.notFound('Transfer not found');
  if (t.status !== 'INITIATED' || t.authorized_at) throw AppError.conflict('This transfer has already been approved or cancelled', 'TRANSFER_NOT_AWAITING_APPROVAL');
  if (new Date(t.expires_at).getTime() < Date.now()) throw AppError.badRequest('This review has expired. Start again.', 'TRANSFER_EXPIRED');
  return t;
}

export async function authorize(user, id, { method, pin, deviceKeyId }, req) {
  const t = await openTransfer(user, id);
  const options = await approvalFor(user, t);
  if (!options.methods.includes(method)) throw AppError.forbidden(options.reason || 'Choose another approval method', 'TX_STEP_UP_REQUIRED');
  return transactionAuth.createChallenge(user, {
    target: targetOf(t), method, pin, deviceKeyId,
    describe: `a ${naira(t.total_debit)} bank transfer to ${t.account_name}`,
  }, req);
}

/** Approval consumed → wallet debited once (database) → payout dispatched. */
export async function confirm(user, id, body, req) {
  const t = await openTransfer(user, id);
  const auth = await transactionAuth.consumeChallenge(user, body, targetOf(t), req);
  if (!(await walletRepo.markBankTransferAuthorized(t.id, auth))) throw AppError.conflict('This transfer has already been approved', 'TRANSFER_NOT_AWAITING_APPROVAL');
  await txRepo.insertEvent({ user_id: user.id, type: 'transaction_authorized', session_id: user.sessionId ?? null, ip_address: req?.ip || null, metadata: { bank_transfer_id: t.id, method: auth.method } });
  try {
    await walletRepo.debitBankTransfer(t.id);
  } catch (err) {
    if (err.status && err.status < 500) await walletRepo.failBankTransfer(t.id, 'FAILED', err.message).catch(() => {});
    throw err;
  }
  await auditService.record({ actorId: user.id, action: 'wallet.bank_transfer.authorized', resourceType: 'wallet_bank_transfer', resourceId: t.id, metadata: { method: auth.method }, req });
  await dispatch(await walletRepo.findBankTransfer(t.id)).catch((err) => logger.warn({ id: t.id, err: err.message }, 'bank payout dispatch deferred'));
  notificationService.kickDispatcher();
  return format(await walletRepo.findBankTransfer(t.id));
}

export async function cancel(user, id) {
  const t = await openTransfer(user, id);
  await walletRepo.updateBankTransfer(t.id, { status: 'CANCELLED', failure_reason: 'Cancelled by sender' }, { fromStatus: 'INITIATED' });
  return { cancelled: true };
}

/**
 * Send a debited (PENDING) transfer to Paystack. The reference is fixed per
 * transfer, so a retry can never pay twice (Paystack rejects a reused reference).
 */
export async function dispatch(t) {
  if (!t || t.status !== 'PENDING') return { dispatched: false };
  if (t.execution_mode !== 'paystack_transfer') return { dispatched: false, reason: 'MANUAL' };
  if (!env.features.transfers) {
    await walletRepo.updateBankTransfer(t.id, { execution_mode: 'manual' }, { fromStatus: 'PENDING' });
    return { dispatched: false, reason: 'MANUAL' };
  }
  let recipientCode = t.recipient_code || await walletRepo.recipientCodeFor(t.user_id, t.bank_code, t.account_number);
  if (!recipientCode) {
    const r = await paystack.createTransferRecipient({ name: t.account_name, accountNumber: t.account_number, bankCode: t.bank_code });
    recipientCode = r.recipient_code;
  }
  if (recipientCode !== t.recipient_code) await walletRepo.updateBankTransfer(t.id, { recipient_code: recipientCode });
  try {
    const data = await paystack.initiateTransfer({
      amount: Number(t.recipient_amount), recipientCode, reference: t.reference, reason: t.narration || 'ACHIEVER Wallet transfer',
    });
    const status = String(data.status || '').toLowerCase();
    if (status === 'failed' || status === 'reversed') {
      await walletRepo.failBankTransfer(t.id, status === 'reversed' ? 'REVERSED' : 'FAILED', `Provider status: ${status}`);
    } else {
      // pending / otp / received / success: the final state comes from the webhook or a verify call.
      await walletRepo.bankTransferProcessing(t.id, data.transfer_code, status);
    }
    return { dispatched: true, status };
  } catch (err) {
    if (err.providerStatus && err.providerStatus < 500) {
      if (/duplicate|already/i.test(err.message)) {
        await walletRepo.bankTransferProcessing(t.id, null, 'duplicate_reference');   // sent before: confirm by requery
        return { dispatched: true, status: 'requery' };
      }
      await walletRepo.failBankTransfer(t.id, 'FAILED', err.message.slice(0, 300));
      return { dispatched: false, reason: 'REJECTED' };
    }
    throw err;   // provider unreachable: stays PENDING; the job retries with the same reference
  }
}

/** Paystack transfer.* webhook for a wallet bank transfer (signature already verified). */
export async function handleTransferEvent(event, data) {
  const t = await walletRepo.findBankTransferByReference(data.reference);
  if (!t) {
    logger.warn({ event }, 'bank transfer event for unknown reference');
    return;
  }
  await applyProviderStatus(t, event.split('.')[1], data);
  notificationService.kickDispatcher();
}

async function applyProviderStatus(t, status, data = {}) {
  const reportedFee = Number(data.fee_charged ?? data.fees ?? NaN);
  if (status === 'success') {
    const cost = Number.isFinite(reportedFee) && reportedFee >= 0 ? reportedFee : estimateProviderCost(Number(t.recipient_amount));
    await walletRepo.completeBankTransfer(t.id, { providerReference: data.transfer_code || t.transfer_code, providerCost: cost, estimated: !Number.isFinite(reportedFee) });
  } else if (status === 'failed' || status === 'abandoned') {
    await walletRepo.failBankTransfer(t.id, 'FAILED', data.reason || data.gateway_response || 'Failed at the bank');
  } else if (status === 'reversed') {
    await walletRepo.failBankTransfer(t.id, 'REVERSED', data.reason || 'Reversed by the bank');
    if (t.status === 'SUCCESS') {
      // Money came back after we reported success: refunded above; raised for review.
      await riskRepo.insert({
        subject_user_id: t.user_id, context: 'payments', reason_code: 'bank_transfer_reversed_after_success', severity: 'high',
        status: 'review_required', details: { bank_transfer_id: t.id, reference: t.reference },
      }).catch((err) => logger.warn({ err: err.message }, 'risk flag not recorded'));
    }
  }
}

/** Job: push PENDING transfers again (same reference) and verify PROCESSING ones with Paystack. */
export async function processOpen() {
  if (!env.features.transfers) return { checked: 0 };
  const rows = await walletRepo.listOpenBankTransfers({ olderThan: new Date(Date.now() - 2 * 60_000).toISOString() });
  for (const t of rows) {
    try {
      if (t.status === 'PENDING') {
        await dispatch(t);
      } else {
        const data = await paystack.verifyTransfer(t.reference);
        await walletRepo.updateBankTransfer(t.id, { last_checked_at: new Date().toISOString(), provider_status: String(data.status || '').slice(0, 40) });
        await applyProviderStatus(t, String(data.status || '').toLowerCase(), data);
      }
    } catch (err) {
      logger.warn({ id: t.id, err: err.message }, 'bank transfer check failed');
    }
  }
  if (rows.length) notificationService.kickDispatcher();
  return { checked: rows.length };
}

// Member reads ------------------------------------------------------------------------------------
export async function get(user, id) {
  const t = await walletRepo.findBankTransfer(id);
  if (!t || t.user_id !== user.id) throw AppError.notFound('Transfer not found');
  return format(t);
}

export async function list(user, filters) {
  const r = await walletRepo.listBankTransfers({ ...filters, userId: user.id });
  return { items: r.rows.map((t) => format(t)), meta: pageMeta(filters, r.total) };
}

// Admin -----------------------------------------------------------------------------------------------
export async function adminList(filters) {
  const r = await walletRepo.listBankTransfers(filters);
  return { items: r.rows.map((t) => format(t, { admin: true })), meta: pageMeta(filters, r.total) };
}

/** Manual payout: finance paid it from the bank and records the bank reference. */
export async function adminMarkPaid(actor, id, { manualReference, providerCost }, req) {
  const t = await walletRepo.findBankTransfer(id);
  if (!t) throw AppError.notFound('Transfer not found');
  if (t.execution_mode !== 'manual' || t.status !== 'PENDING') throw AppError.conflict('Only a queued manual payout can be marked as paid', 'NOT_MANUAL_PENDING');
  await walletRepo.completeBankTransfer(t.id, { providerReference: null, providerCost: providerCost ?? null, estimated: false, actorId: actor.id, manualReference });
  await auditService.record({ actorId: actor.id, action: 'admin.wallet.bank_transfer.paid', resourceType: 'wallet_bank_transfer', resourceId: t.id, metadata: { manualReference }, req });
  notificationService.kickDispatcher();
  return format(await walletRepo.findBankTransfer(t.id), { admin: true });
}

/** Refund a payout that was never sent (manual queue, or stuck before the provider accepted it). */
export async function adminRefund(actor, id, { reason }, req) {
  const t = await walletRepo.findBankTransfer(id);
  if (!t) throw AppError.notFound('Transfer not found');
  if (t.status !== 'PENDING') throw AppError.conflict('Only a transfer that has not been sent can be refunded here', 'NOT_REFUNDABLE');
  await walletRepo.failBankTransfer(t.id, 'REFUNDED', reason, actor.id);
  await auditService.record({ actorId: actor.id, action: 'admin.wallet.bank_transfer.refunded', resourceType: 'wallet_bank_transfer', resourceId: t.id, metadata: { reason }, req });
  notificationService.kickDispatcher();
  return format(await walletRepo.findBankTransfer(t.id), { admin: true });
}

export async function adminRequery(id) {
  const t = await walletRepo.findBankTransfer(id);
  if (!t) throw AppError.notFound('Transfer not found');
  if (t.status === 'PENDING') await dispatch(t);
  else if (t.status === 'PROCESSING') {
    const data = await paystack.verifyTransfer(t.reference);
    await applyProviderStatus(t, String(data.status || '').toLowerCase(), data);
  }
  return format(await walletRepo.findBankTransfer(t.id), { admin: true });
}
