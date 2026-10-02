import crypto from 'node:crypto';
import * as walletRepo from '../repositories/walletRepository.js';
import * as osusuRepo from '../repositories/osusuRepository.js';
import * as collectorRepo from '../repositories/collectorRepository.js';
import * as txRepo from '../repositories/transactionSecurityRepository.js';
import * as paymentService from './paymentService.js';
import * as settingsService from './settingsService.js';
import * as transactionAuth from './transactionAuthService.js';
import * as auditService from './auditService.js';
import * as notificationService from './notificationService.js';
import * as riskService from './riskService.js';
import { AppError } from '../utils/AppError.js';
import { newPaymentReference } from '../utils/crypto.js';
import { pageMeta } from '../utils/pagination.js';
import { logger } from '../utils/logger.js';

/**
 * ACHIEVER Wallet — an internal stored-value balance inside ACHIEVER.
 *
 *  - The wallet ID (ACHW-XXXXXXXX) is an ACHIEVER identifier, not a bank
 *    account number. Money enters only through a verified Paystack payment.
 *  - Balances are a projection of a double-entry ledger; every movement is a
 *    balanced posting made inside one SQL transaction with row locks.
 *  - Money never moves on the client's word: every debit is reviewed, then
 *    approved (PIN / PIN + emailed code / device biometric), then executed
 *    by the server, which re-checks balances and limits.
 */
const naira = (k) => `₦${(Number(k) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const TYPE_LABELS = {
  topup: 'Wallet top-up', transfer: 'Transfer', bill_payment: 'Bill payment', osusu_contribution: 'OSUSU contribution',
  collector_savings: 'Savings deposit', refund: 'Refund', reversal: 'Reversal', referral_reward: 'Referral reward',
  fee: 'Fee', adjustment: 'Adjustment',
};
const CREDIT_TYPES = new Set(['topup', 'refund', 'referral_reward']);

/** "Adaeze Okafor" -> "Ad**** O*****" (enough to recognise, not to harvest). */
export function maskName(name) {
  return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 3)
    .map((w, i) => (i === 0 ? w.slice(0, 2) : w.slice(0, 1)) + '*'.repeat(Math.max(2, w.length - (i === 0 ? 2 : 1))))
    .join(' ') || 'ACHIEVER member';
}

/** "ACHW-7KQ2M9XA" -> "ACHW-••••M9XA" */
export function maskWalletCode(code) {
  const s = String(code || '');
  return s.length === 13 ? `ACHW-••••${s.slice(-4)}` : s;
}

export function normaliseWalletCode(input) {
  const raw = String(input || '').toUpperCase().replace(/[\s-]/g, '');
  const body = raw.startsWith('ACHW') ? raw.slice(4) : raw;
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(body) ? `ACHW-${body}` : null;
}

async function walletSettings() {
  const [enabled, transfers, topupMin, topupMax, maxBalance, transferMin, single, daily, review, fee, hourly, billDaily] = await Promise.all([
    settingsService.getBool('wallet.enabled', true),
    settingsService.getBool('wallet.transfers_enabled', true),
    settingsService.getInt('wallet.topup_min_kobo', 10_000),
    settingsService.getInt('wallet.topup_max_kobo', 50_000_000),
    settingsService.getInt('wallet.max_balance_kobo', 500_000_000),
    settingsService.getInt('wallet.transfer_min_kobo', 10_000),
    settingsService.getInt('wallet.transfer_single_max_kobo', 20_000_000),
    settingsService.getInt('wallet.transfer_daily_max_kobo', 50_000_000),
    settingsService.getInt('wallet.transfer_review_threshold_kobo', 50_000_000),
    settingsService.getInt('wallet.transfer_fee_kobo', 0),
    settingsService.getInt('wallet.transfer_hourly_max_count', 10),
    settingsService.getInt('wallet.bill_daily_max_kobo', 20_000_000),
  ]);
  return { enabled, transfers, topupMin, topupMax, maxBalance, transferMin, single, daily, review, fee, hourly, billDaily };
}

async function assertWalletOpen() {
  if (!(await settingsService.getBool('wallet.enabled', true))) {
    throw AppError.unavailable('ACHIEVER Wallet is temporarily unavailable. Please try again later.', 'WALLET_DISABLED');
  }
}

async function myAccount(user) {
  await walletRepo.ensureWallet(user.id);
  const acct = await walletRepo.findAccountByUser(user.id);
  if (!acct) throw AppError.unavailable('Your wallet could not be opened. Please try again.', 'WALLET_UNAVAILABLE');
  return acct;
}

const startOfLagosDay = () => {
  const now = new Date();
  const lagos = new Date(now.getTime() + 3600_000);              // WAT = UTC+1, no DST
  return new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) - 3600_000).toISOString();
};

// Overview ------------------------------------------------------------------------------------------
export async function summary(user) {
  const [acct, cfg] = await Promise.all([myAccount(user), walletSettings()]);
  const sentToday = await walletRepo.sumOutgoingToday(user.id, startOfLagosDay());
  return {
    walletId: acct.wallet_code,
    status: acct.status,
    statusReason: acct.status === 'active' ? null : 'Your wallet is under review. Contact support for help.',
    balance: Number(acct.balance),
    held: Number(acct.held),
    available: Math.max(0, Number(acct.balance) - Number(acct.held)),
    currency: acct.currency,
    enabled: cfg.enabled,
    transfersEnabled: cfg.transfers,
    limits: {
      topupMin: cfg.topupMin, topupMax: cfg.topupMax, maxBalance: cfg.maxBalance,
      transferMin: cfg.transferMin, transferSingleMax: cfg.single, transferDailyMax: cfg.daily,
      transferDailyRemaining: Math.max(0, cfg.daily - sentToday), transferFee: cfg.fee,
    },
    notice: 'ACHIEVER Wallet is a balance held inside ACHIEVER for payments within the app. It is not a bank account.',
  };
}

function formatTx(t, userId) {
  const incoming = t.type === 'transfer' ? t.counterparty_user_id === userId : CREDIT_TYPES.has(t.type)
    || (t.type === 'adjustment' && t.metadata?.direction === 'credit');
  const amount = Number(t.amount) + (incoming ? 0 : Number(t.fee || 0));
  return {
    id: t.id,
    reference: t.reference,
    type: t.type,
    label: t.type === 'transfer' ? (incoming ? 'Money received' : 'Money sent') : TYPE_LABELS[t.type] || t.type,
    description: t.description,
    direction: incoming ? 'credit' : 'debit',
    amount,
    fee: incoming ? 0 : Number(t.fee || 0),
    status: t.status,
    createdAt: t.created_at,
    billPaymentId: t.bill_payment_id,
    groupId: t.group_id,
  };
}

export async function transactions(user, filters) {
  await myAccount(user);
  const result = await walletRepo.listTransactions({ ...filters, userId: user.id });
  return { items: result.rows.map((t) => formatTx(t, user.id)), meta: pageMeta(filters, result.total) };
}

export async function receipt(user, id) {
  const t = await walletRepo.findTransaction(id);
  if (!t || (t.user_id !== user.id && t.counterparty_user_id !== user.id)) throw AppError.notFound('Transaction not found');
  const f = formatTx(t, user.id);
  let counterparty = null;
  if (t.type === 'transfer') {
    const otherId = f.direction === 'credit' ? t.user_id : t.counterparty_user_id;
    const other = await walletRepo.findAccountByUser(otherId);
    const named = other ? await walletRepo.findAccountByCode(other.wallet_code) : null;
    counterparty = { name: maskName(named?.owner?.full_name), walletId: maskWalletCode(other?.wallet_code) };
  }
  return { ...f, counterparty, note: t.type === 'transfer' ? t.description.replace(/^Transfer: /, '') : null, completedAt: t.completed_at };
}

// Top-up (Paystack) -----------------------------------------------------------------------------------
export async function startTopup(user, { amount }, idempotencyKey) {
  await assertWalletOpen();
  const cfg = await walletSettings();
  if (!Number.isSafeInteger(amount) || amount < cfg.topupMin) throw AppError.badRequest(`The minimum top-up is ${naira(cfg.topupMin)}`, 'AMOUNT_TOO_LOW');
  if (amount > cfg.topupMax) throw AppError.badRequest(`The maximum single top-up is ${naira(cfg.topupMax)}`, 'AMOUNT_TOO_HIGH');
  const acct = await myAccount(user);
  if (acct.status !== 'active') throw AppError.forbidden('Your wallet cannot be funded right now. Contact support.', 'WALLET_NOT_ACTIVE');
  if (Number(acct.balance) + amount > cfg.maxBalance) {
    throw AppError.unprocessable(`This top-up would take your wallet above the ${naira(cfg.maxBalance)} limit`, 'BALANCE_LIMIT');
  }
  if (idempotencyKey) {
    const existing = await walletRepo.findTopupByKey(user.id, idempotencyKey);
    if (existing && existing.status !== 'INITIALIZED') return topupView(existing);
  }
  const topup = await walletRepo.insertTopup({
    user_id: user.id, wallet_id: acct.id, amount, status: 'INITIALIZED', idempotency_key: idempotencyKey || null,
  });
  try {
    const pay = await paymentService.initialize({ user, purpose: 'wallet_topup', targetId: topup.id, amount, metadata: { wallet_topup_id: topup.id } });
    const updated = await walletRepo.updateTopup(topup.id, { status: 'PENDING', payment_reference: pay.reference });
    await auditService.record({ actorId: user.id, action: 'wallet.topup.started', resourceType: 'wallet_topup', resourceId: topup.id, metadata: { amount } });
    return { ...topupView(updated), authorizationUrl: pay.authorizationUrl };
  } catch (err) {
    await walletRepo.updateTopup(topup.id, { status: 'FAILED', failure_reason: 'Checkout could not be started' }).catch(() => {});
    throw err;
  }
}

function topupView(t) {
  return {
    topupId: t.id, amount: Number(t.amount), status: t.status, reference: t.payment_reference,
    message: {
      INITIALIZED: 'Starting secure payment…', PENDING: 'Waiting for payment confirmation…', SUCCESS: 'Your wallet has been funded.',
      FAILED: 'Payment failed. No money was added.', ABANDONED: 'Payment was not completed.',
      REVERSED: 'This top-up was reversed by the payment provider.', REFUNDED: 'This top-up was refunded.',
    }[t.status],
  };
}

/** Polled by the payment callback page; verifies with Paystack on demand. */
export async function topupStatus(user, id) {
  let t = await walletRepo.findTopup(id);
  if (!t || t.user_id !== user.id) throw AppError.notFound('Top-up not found');
  if (t.status === 'PENDING' && t.payment_reference) {
    await paymentService.statusForUser(user, t.payment_reference).catch((err) => logger.warn({ err: err.message }, 'top-up verify deferred'));
    t = await walletRepo.findTopup(id);
  }
  return topupView(t);
}

// Transfers -------------------------------------------------------------------------------------------
/** Shows only a masked name and masked wallet ID, so the sender can confirm without exposing data. */
export async function resolveRecipient(user, walletCode) {
  const code = normaliseWalletCode(walletCode);
  if (!code) throw AppError.badRequest('Enter a valid ACHIEVER Wallet ID (ACHW-XXXXXXXX)', 'INVALID_WALLET_ID');
  const acct = await walletRepo.findAccountByCode(code);
  if (!acct || acct.owner?.account_status === 'closed') throw AppError.notFound('No ACHIEVER Wallet has this ID', 'WALLET_NOT_FOUND');
  if (acct.user_id === user.id) throw AppError.badRequest('This is your own wallet', 'SELF_TRANSFER');
  if (acct.status !== 'active') throw AppError.unprocessable('This wallet cannot receive money right now', 'RECIPIENT_UNAVAILABLE');
  return { walletId: maskWalletCode(acct.wallet_code), name: maskName(acct.owner?.full_name), verified: true };
}

const transferHash = (t) => transactionAuth.hashFor('wallet_transfer', [t.id, t.sender_user_id, t.sender_wallet_id, t.recipient_wallet_id, t.amount, t.fee]);
const transferTarget = (t) => ({ purpose: 'wallet_transfer', id: t.id, hash: transferHash(t), amount: Number(t.amount) + Number(t.fee) });

async function transferReview(t, recipient, user) {
  const newRecipient = !(await walletRepo.hasSentTo(user.id, t.recipient_wallet_id));
  const options = await transferApprovalOptions(user, t, newRecipient);
  return {
    transferId: t.id, reference: t.reference, status: t.status, amount: Number(t.amount), fee: Number(t.fee),
    total: Number(t.amount) + Number(t.fee), note: t.note, recipient, expiresAt: t.expires_at,
    newRecipient, approval: options,
  };
}

/** A first transfer of a large amount to a new wallet always needs the step-up (explained to the user). */
async function transferApprovalOptions(user, t, newRecipient) {
  const amount = Number(t.amount) + Number(t.fee);
  const options = await transactionAuth.approvalOptions(user, { amount, purpose: 'wallet_transfer' });
  const newLarge = await settingsService.getInt('wallet.new_recipient_step_up_kobo', 2_000_000);
  if (newRecipient && amount >= newLarge && options.methods.includes('pin')) {
    return { ...options, methods: options.methods.filter((m) => m !== 'pin'), stepUpRequired: true,
      reason: 'This is your first transfer to this wallet, so we also send a code to your email.' };
  }
  return options;
}

export async function startTransfer(user, { walletCode, amount, note }, idempotencyKey) {
  await assertWalletOpen();
  const cfg = await walletSettings();
  if (!cfg.transfers) throw AppError.unavailable('Wallet transfers are temporarily unavailable', 'TRANSFERS_DISABLED');
  await riskService.assertNotRestricted(user.id);
  if (idempotencyKey) {
    const existing = await walletRepo.findTransferByKey(user.id, idempotencyKey);
    if (existing) {
      const r = await walletRepo.findAccount(existing.recipient_wallet_id);
      return transferReview(existing, await resolveRecipient(user, r.wallet_code).catch(() => null), user);
    }
  }
  if (!Number.isSafeInteger(amount) || amount < cfg.transferMin) throw AppError.badRequest(`The minimum transfer is ${naira(cfg.transferMin)}`, 'AMOUNT_TOO_LOW');
  if (amount > cfg.single) throw AppError.badRequest(`The maximum single transfer is ${naira(cfg.single)}`, 'AMOUNT_TOO_HIGH');

  const recipient = await resolveRecipient(user, walletCode);
  const [from, to] = await Promise.all([myAccount(user), walletRepo.findAccountByCode(normaliseWalletCode(walletCode))]);
  if (from.status !== 'active') throw AppError.forbidden('Your wallet cannot send money right now. Contact support.', 'WALLET_NOT_ACTIVE');
  const sentToday = await walletRepo.sumOutgoingToday(user.id, startOfLagosDay());
  if (sentToday + amount > cfg.daily) {
    throw AppError.unprocessable(`This transfer would exceed your daily limit. You can send up to ${naira(Math.max(0, cfg.daily - sentToday))} more today.`, 'DAILY_LIMIT_REACHED');
  }
  const recent = await walletRepo.countTransfersSince(user.id, new Date(Date.now() - 3600_000).toISOString());
  if (recent >= cfg.hourly) throw AppError.tooMany('You have made many transfers in the last hour. Please wait a while and try again.', 'TRANSFER_VELOCITY');
  if (Number(from.balance) - Number(from.held) < amount + cfg.fee) {
    throw AppError.unprocessable('Your ACHIEVER Wallet balance is not enough for this transfer.', 'INSUFFICIENT_FUNDS');
  }

  const t = await walletRepo.insertTransfer({
    reference: newPaymentReference('ACH-TRF'), sender_user_id: user.id, sender_wallet_id: from.id, recipient_wallet_id: to.id,
    amount, fee: cfg.fee, note: note || null, status: 'AWAITING_AUTHORIZATION', idempotency_key: idempotencyKey || null,
  });
  await auditService.record({ actorId: user.id, action: 'wallet.transfer.initiated', resourceType: 'wallet_transfer', resourceId: t.id, metadata: { amount } });
  return transferReview(t, recipient, user);
}

async function openTransfer(user, id) {
  const t = await walletRepo.findTransfer(id);
  if (!t || t.sender_user_id !== user.id) throw AppError.notFound('Transfer not found');
  if (t.status !== 'AWAITING_AUTHORIZATION' || t.authorized_at) throw AppError.conflict('This transfer has already been approved or cancelled', 'TRANSFER_NOT_AWAITING_APPROVAL');
  if (new Date(t.expires_at).getTime() < Date.now()) throw AppError.badRequest('This review has expired. Start again.', 'TRANSFER_EXPIRED');
  return t;
}

export async function authorizeTransfer(user, id, { method, pin, deviceKeyId }, req) {
  const t = await openTransfer(user, id);
  const options = await transferApprovalOptions(user, t, !(await walletRepo.hasSentTo(user.id, t.recipient_wallet_id)));
  if (!options.methods.includes(method)) throw AppError.forbidden(options.reason || 'Choose another approval method', 'TX_STEP_UP_REQUIRED');
  return transactionAuth.createChallenge(user, {
    target: transferTarget(t), method, pin, deviceKeyId, describe: `a ${naira(Number(t.amount) + Number(t.fee))} wallet transfer`,
  }, req);
}

/** Consume the approval, then the database moves the money (re-checking balance and limits under lock). */
export async function confirmTransfer(user, id, { challengeId, code, signature }, req) {
  const t = await openTransfer(user, id);
  const auth = await transactionAuth.consumeChallenge(user, { challengeId, code, signature }, transferTarget(t), req);
  const marked = await walletRepo.markTransferAuthorized(t.id, auth);
  if (!marked) throw AppError.conflict('This transfer has already been approved', 'TRANSFER_NOT_AWAITING_APPROVAL');
  await txRepo.insertEvent({ user_id: user.id, type: 'transaction_authorized', session_id: user.sessionId ?? null, ip_address: req?.ip || null, metadata: { transfer_id: t.id, method: auth.method } });
  let result;
  try {
    result = await walletRepo.executeTransfer(t.id);
  } catch (err) {
    if (err.status && err.status < 500) await walletRepo.failTransfer(t.id, err.message);
    throw err;
  }
  notificationService.kickDispatcher();
  await auditService.record({ actorId: user.id, action: 'wallet.transfer.authorized', resourceType: 'wallet_transfer', resourceId: t.id, metadata: { method: auth.method, outcome: result.outcome }, req });
  const done = await walletRepo.findTransfer(t.id);
  return {
    transferId: done.id, reference: done.reference, status: done.status, amount: Number(done.amount), fee: Number(done.fee),
    transactionId: done.transaction_id,
    message: done.status === 'PENDING_REVIEW'
      ? 'This transfer is being reviewed for your protection. The amount is held in your wallet until it is approved.'
      : 'Transfer successful',
  };
}

export async function cancelTransfer(user, id) {
  const t = await walletRepo.cancelTransfer(id, user.id);
  if (!t) throw AppError.conflict('This transfer can no longer be cancelled', 'TRANSFER_NOT_CANCELLABLE');
  return { cancelled: true };
}

// Payments from the wallet (OSUSU, collector savings) ------------------------------------------------
async function paymentTarget(user, { kind, contributionId, planId, amount }) {
  if (kind === 'osusu') {
    const c = await osusuRepo.findContribution(contributionId);
    if (!c || c.user_id !== user.id) throw AppError.notFound('Contribution not found');
    if (c.status === 'paid') throw AppError.conflict('This contribution is already paid', 'ALREADY_PAID');
    return { id: c.id, amount: Number(c.amount), describe: `${c.group?.name || 'OSUSU'} contribution`, hashParts: ['osusu', c.id, user.id, c.amount] };
  }
  const plan = await collectorRepo.findPlan(planId);
  if (!plan || plan.saver_id !== user.id) throw AppError.notFound('Savings plan not found');
  if (!Number.isSafeInteger(amount) || amount < 10_000) throw AppError.badRequest('The minimum deposit is ₦100', 'AMOUNT_TOO_LOW');
  return { id: plan.id, amount, describe: `${plan.plan_name} savings deposit`, hashParts: ['collector', plan.id, user.id, amount] };
}

export async function authorizePayment(user, input, req) {
  await assertWalletOpen();
  await riskService.assertNotRestricted(user.id);
  const p = await paymentTarget(user, input);
  const acct = await myAccount(user);
  if (Number(acct.balance) - Number(acct.held) < p.amount) {
    throw AppError.unprocessable('Your ACHIEVER Wallet balance is not enough for this payment.', 'INSUFFICIENT_FUNDS');
  }
  const options = await transactionAuth.approvalOptions(user, { amount: p.amount, purpose: 'wallet_payment' });
  if (!options.methods.includes(input.method)) throw AppError.forbidden(options.reason || 'Choose another approval method', 'TX_STEP_UP_REQUIRED');
  const challenge = await transactionAuth.createChallenge(user, {
    target: { purpose: 'wallet_payment', id: p.id, hash: transactionAuth.hashFor('wallet_payment', p.hashParts), amount: p.amount },
    method: input.method, pin: input.pin, deviceKeyId: input.deviceKeyId, describe: `a ${naira(p.amount)} ${p.describe}`,
  }, req);
  return { ...challenge, amount: p.amount, approval: options };
}

export async function confirmPayment(user, input, req) {
  const p = await paymentTarget(user, input);
  const auth = await transactionAuth.consumeChallenge(user, input,
    { purpose: 'wallet_payment', id: p.id, hash: transactionAuth.hashFor('wallet_payment', p.hashParts), amount: p.amount }, req);
  const result = input.kind === 'osusu'
    ? await walletRepo.payOsusuContribution(user.id, p.id)
    : await walletRepo.payCollectorSavings(user.id, p.id, p.amount);
  notificationService.kickDispatcher();
  await auditService.record({ actorId: user.id, action: `wallet.pay.${input.kind}`, resourceType: input.kind === 'osusu' ? 'osusu_contribution' : 'collector_saver', resourceId: p.id, metadata: { method: auth.method, amount: p.amount }, req });
  return { paid: true, amount: p.amount, walletTransactionId: result.wallet_transaction_id, transactionId: result.transaction_id };
}

// Automatic payments (mandates) -----------------------------------------------------------------------
function formatMandate(m) {
  return {
    id: m.id, destinationType: m.destination_type, groupId: m.destination_id, amount: Number(m.amount), frequency: m.frequency,
    startDate: m.start_date, endDate: m.end_date, maximumTotal: m.maximum_total == null ? null : Number(m.maximum_total),
    totalPaid: Number(m.total_paid), status: m.status, authorizedAt: m.authorized_at, createdAt: m.created_at, cancelledAt: m.cancelled_at,
    runs: (m.runs || []).map((r) => ({ status: r.status, amount: r.amount == null ? null : Number(r.amount), reason: r.reason, at: r.created_at })),
  };
}

const mandateTarget = (m) => ({
  purpose: 'wallet_mandate', id: m.id, amount: Number(m.amount),
  hash: transactionAuth.hashFor('wallet_mandate', [m.id, m.user_id, m.destination_id, m.amount, m.frequency, m.start_date, m.end_date, m.maximum_total]),
});

export async function listMandates(user) {
  const rows = await walletRepo.listMandates(user.id);
  const groups = await Promise.all(rows.map((m) => osusuRepo.findGroup(m.destination_id).catch(() => null)));
  return rows.map((m, i) => ({ ...formatMandate(m), groupName: groups[i]?.name ?? null }));
}

/** Review an automatic OSUSU contribution. Nothing is debited until it is approved. */
export async function createMandate(user, { groupId, endDate, maximumTotal }) {
  await assertWalletOpen();
  const [group, member] = await Promise.all([osusuRepo.findGroup(groupId), osusuRepo.findMembership(groupId, user.id)]);
  if (!group || !member || member.status !== 'active') throw AppError.forbidden('You can only set up automatic payments for groups you belong to', 'NOT_A_MEMBER');
  if (['completed', 'cancelled'].includes(group.status)) throw AppError.conflict('This group is no longer collecting contributions', 'GROUP_CLOSED');
  const max = await settingsService.getInt('wallet.max_auto_contribution_kobo', 50_000_000);
  if (Number(group.contribution_amount) > max) throw AppError.unprocessable('This contribution is above the automatic payment limit', 'AMOUNT_TOO_HIGH');
  const acct = await myAccount(user);
  const m = await walletRepo.insertMandate({
    user_id: user.id, source_wallet_id: acct.id, destination_type: 'osusu_group', destination_id: groupId,
    amount: Number(group.contribution_amount), frequency: 'per_cycle', start_date: new Date().toISOString().slice(0, 10),
    end_date: endDate || null, maximum_total: maximumTotal ?? null, status: 'PENDING_AUTHORIZATION',
  }).catch((err) => {
    if (err.code === 'DUPLICATE') throw AppError.conflict('You already have automatic payments for this group', 'MANDATE_EXISTS');
    throw err;
  });
  const approval = await transactionAuth.approvalOptions(user, { amount: Number(m.amount), purpose: 'wallet_mandate' });
  return { ...formatMandate(m), groupName: group.name, approval,
    terms: `ACHIEVER will pay ${naira(m.amount)} from your wallet for each ${group.name} contribution when it is due. You can pause or cancel at any time. If your balance is too low, the payment is not made and you are notified.` };
}

async function ownMandate(user, id) {
  const m = await walletRepo.findMandate(id);
  if (!m || m.user_id !== user.id) throw AppError.notFound('Automatic payment not found');
  return m;
}

export async function authorizeMandate(user, id, { method, pin, deviceKeyId }, req) {
  const m = await ownMandate(user, id);
  if (m.status !== 'PENDING_AUTHORIZATION') throw AppError.conflict('This automatic payment is already set up', 'MANDATE_NOT_PENDING');
  return transactionAuth.createChallenge(user, { target: mandateTarget(m), method, pin, deviceKeyId, describe: `automatic payments of ${naira(m.amount)}` }, req);
}

export async function confirmMandate(user, id, body, req) {
  const m = await ownMandate(user, id);
  if (m.status !== 'PENDING_AUTHORIZATION') throw AppError.conflict('This automatic payment is already set up', 'MANDATE_NOT_PENDING');
  const auth = await transactionAuth.consumeChallenge(user, body, mandateTarget(m), req);
  const updated = await walletRepo.updateMandate(m.id, user.id, { status: 'ACTIVE', authorized_at: new Date().toISOString(), auth_method: auth.method, auth_challenge_id: auth.challengeId }, ['PENDING_AUTHORIZATION']);
  if (!updated) throw AppError.conflict('This automatic payment is already set up', 'MANDATE_NOT_PENDING');
  await txRepo.insertEvent({ user_id: user.id, type: 'mandate_created', session_id: user.sessionId ?? null, ip_address: req?.ip || null, metadata: { mandate_id: m.id, amount: Number(m.amount) } });
  await auditService.record({ actorId: user.id, action: 'wallet.mandate.authorized', resourceType: 'wallet_mandate', resourceId: m.id, metadata: { method: auth.method }, req });
  await notificationService.notify(user.id, {
    type: 'wallet_mandate_active', category: 'payments', title: 'Automatic payments set up',
    body: `Your OSUSU contributions of ${naira(m.amount)} will be paid from your ACHIEVER Wallet when due. You can cancel any time.`,
    dedupeKey: `mandate_on:${m.id}`,
  });
  return formatMandate(updated);
}

export async function setMandateState(user, id, action, reason, req) {
  const m = await ownMandate(user, id);
  const moves = {
    pause: { from: ['ACTIVE'], patch: { status: 'PAUSED' } },
    resume: { from: ['PAUSED'], patch: { status: 'ACTIVE' } },
    cancel: { from: ['PENDING_AUTHORIZATION', 'ACTIVE', 'PAUSED'], patch: { status: 'CANCELLED', cancelled_at: new Date().toISOString(), cancel_reason: reason || 'Cancelled by member' } },
  }[action];
  if (!moves) throw AppError.badRequest('Unknown action');
  const updated = await walletRepo.updateMandate(m.id, user.id, moves.patch, moves.from);
  if (!updated) throw AppError.conflict(`This automatic payment cannot be ${action === 'cancel' ? 'cancelled' : `${action}d`} now`, 'MANDATE_STATE');
  if (action === 'cancel') {
    await txRepo.insertEvent({ user_id: user.id, type: 'mandate_cancelled', session_id: user.sessionId ?? null, ip_address: req?.ip || null, metadata: { mandate_id: m.id } });
  }
  await auditService.record({ actorId: user.id, action: `wallet.mandate.${action}`, resourceType: 'wallet_mandate', resourceId: m.id, req });
  return formatMandate(updated);
}

/** Job: pay due contributions for active mandates (never overdraws; limited retries). */
export async function runMandates() {
  const result = await walletRepo.runMandates();
  if (result?.paid || result?.insufficient) notificationService.kickDispatcher();
  return result;
}

// Top-up reversals reported by Paystack (refund / chargeback of a funded top-up) ----------------------
export async function handleTopupRefund(reference, reason) {
  const t = await walletRepo.findTopupByReference(reference);
  if (!t) return { handled: false };
  const result = await walletRepo.reverseTopup(t.id, reason || 'Refunded by the payment provider', 'REFUNDED');
  notificationService.kickDispatcher();
  return { handled: true, ...result };
}

// Admin -----------------------------------------------------------------------------------------------
const maskEmailShort = (e) => (e ? e.replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => `${a}${'*'.repeat(Math.min(6, b.length))}${c}`) : null);

export async function adminStats() {
  return walletRepo.stats();
}

export async function adminSearch(filters, { unmask = false } = {}) {
  const result = await walletRepo.searchAccounts({ ...filters, q: filters.q || filters.search });
  return {
    items: result.rows.map((a) => ({
      id: a.id, walletId: a.wallet_code, status: a.status, statusReason: a.status_reason,
      balance: Number(a.balance), held: Number(a.held), createdAt: a.created_at,
      owner: { name: a.owner?.full_name, email: unmask ? a.owner?.email : maskEmailShort(a.owner?.email) },
    })),
    meta: pageMeta(filters, result.total),
  };
}

export async function adminAccount(id) {
  const a = await walletRepo.findAccount(id);
  if (!a || a.kind !== 'user') throw AppError.notFound('Wallet not found');
  const txs = await walletRepo.listAccountTransactions(id, 50);
  return {
    id: a.id, walletId: a.wallet_code, status: a.status, statusReason: a.status_reason, balance: Number(a.balance), held: Number(a.held),
    transactions: txs.map((t) => ({ ...formatTx(t, a.user_id), userId: t.user_id })),
  };
}

export async function adminLedger(txId) {
  const t = await walletRepo.findTransaction(txId);
  if (!t) throw AppError.notFound('Transaction not found');
  const lines = await walletRepo.ledgerFor(txId);
  return { transaction: t, lines: lines.map((l) => ({ ...l, amount: Number(l.amount), balance_after: Number(l.balance_after) })) };
}

export async function adminSetStatus(actor, id, { status, reason }, req) {
  const a = await walletRepo.setAccountStatus(id, status, reason);
  if (!a) throw AppError.notFound('Wallet not found');
  await auditService.record({ actorId: actor.id, action: `admin.wallet.${status === 'active' ? 'unfreeze' : 'freeze'}`, resourceType: 'wallet', resourceId: id, metadata: { reason }, req });
  await notificationService.notify(a.user_id, {
    type: 'wallet_status', category: 'security', title: status === 'active' ? 'Wallet available again' : 'Wallet on hold',
    body: status === 'active' ? 'Your ACHIEVER Wallet can be used again.' : 'Your ACHIEVER Wallet has been placed on hold for review. Contact support for help.',
    dedupeKey: `wallet_status:${id}:${status}:${Date.now()}`,
  });
  return { id: a.id, status: a.status };
}

/** Step 1 of 2: request an adjustment. A different administrator must approve it. */
export async function adminRequestAdjustment(actor, id, { direction, amount, reason }, req) {
  const a = await walletRepo.findAccount(id);
  if (!a || a.kind !== 'user') throw AppError.notFound('Wallet not found');
  const row = await walletRepo.insertAdjustment({ wallet_id: id, direction, amount, reason, requested_by: actor.id });
  await auditService.record({ actorId: actor.id, action: 'admin.wallet.adjustment_requested', resourceType: 'wallet_adjustment', resourceId: row.id, metadata: { direction, amount, reason }, req });
  return row;
}

export async function adminAdjustments(status) {
  return walletRepo.listAdjustments(status);
}

export async function adminDecideAdjustment(actor, id, { approve, reason }) {
  return walletRepo.decideAdjustment(id, actor.id, approve, reason);
}

export async function adminTransfersForReview() {
  const rows = await walletRepo.listTransfersForReview();
  return rows.map((t) => ({ ...t, amount: Number(t.amount), fee: Number(t.fee), sender: { name: t.sender?.full_name, email: maskEmailShort(t.sender?.email) } }));
}

export async function adminReviewTransfer(actor, id, { approve, reason }) {
  const result = await walletRepo.reviewTransfer(id, actor.id, approve, reason);
  notificationService.kickDispatcher();
  return result;
}

export const __test__ = { formatTx, startOfLagosDay, transferHash, idFor: () => crypto.randomUUID() };
