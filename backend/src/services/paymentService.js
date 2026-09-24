import { env } from '../config/env.js';
import { paystack } from '../integrations/paystack/paystackClient.js';
import * as paymentRepo from '../repositories/paymentRepository.js';
import * as settingsService from './settingsService.js';
import * as notificationService from './notificationService.js';
import * as refundService from './refundService.js';
import * as auditService from './auditService.js';
import * as kycService from './kycService.js';
import * as riskService from './riskService.js';
import { AppError } from '../utils/AppError.js';
import { newPaymentReference, paystackSignature, safeEqual } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

const REUSE_WINDOW_MS = 30 * 60 * 1000;
const ABANDON_AFTER_MS = 60 * 60 * 1000;

// Lazily imported to avoid a circular dependency (bill -> payment -> bill).
let billServicePromise;
const billService = () => (billServicePromise ??= import('./billService.js'));
let payoutServicePromise;
const payoutService = () => (payoutServicePromise ??= import('./payoutService.js'));

/**
 * STEP 1 — Payment initiation. Creates our own attempt record first, then asks
 * Paystack for a checkout URL. Nothing is marked paid here.
 */
export async function initialize({ user, purpose, targetId, amount, metadata = {} }) {
  await settingsService.assertPaymentsOpen();
  if (!Number.isSafeInteger(amount) || amount <= 0) throw AppError.badRequest('Invalid amount');
  await riskService.assertNotRestricted(user.id);
  // Savings contributions need the configured KYC level; bill payments do not.
  if (purpose === 'osusu_contribution' || purpose === 'collector_savings') await kycService.requireLevel(user.id, 'contribute');

  const since = new Date(Date.now() - REUSE_WINDOW_MS).toISOString();
  const existing = await paymentRepo.findOpenAttempt({ userId: user.id, purpose, targetId, amount, since });
  if (existing) {
    return { reference: existing.reference, authorizationUrl: existing.authorization_url, reused: true };
  }

  const reference = newPaymentReference();
  const attempt = await paymentRepo.insertAttempt({
    reference,
    user_id: user.id,
    purpose,
    target_id: targetId,
    amount,
    currency: 'NGN',
    metadata,
    session_id: user.sessionId ?? null,
  });

  try {
    const data = await paystack.initializeTransaction({
      email: user.email,
      amount,
      reference,
      callbackUrl: `${env.CLIENT_URL}/app/payments/callback`,
      channels: env.PAYSTACK_CHANNELS.split(',').map((c) => c.trim()).filter(Boolean),
      // Metadata is informational only; the server never trusts it back.
      metadata: { purpose, target_id: targetId, user_id: user.id, attempt_id: attempt.id },
    });
    await paymentRepo.updateAttempt(attempt.id, { access_code: data.access_code, authorization_url: data.authorization_url });
    return { reference, authorizationUrl: data.authorization_url, reused: false };
  } catch (err) {
    await paymentRepo.updateAttempt(attempt.id, { status: 'failed', gateway_response: 'initialization_failed' });
    throw err;
  }
}

/**
 * STEP 2 — Payment confirmation. Always re-verifies with Paystack's API; the
 * browser redirect and webhook payloads are treated only as hints.
 */
export async function verifyAndConfirm(reference, source) {
  const attempt = await paymentRepo.findAttemptByReference(reference);
  if (!attempt) return { outcome: 'unknown_reference' };
  if (attempt.status !== 'initialized' && attempt.status !== 'abandoned' && attempt.status !== 'failed') {
    return { outcome: 'already_processed', status: attempt.status };
  }

  const data = await paystack.verifyTransaction(reference);
  const status = String(data.status || '').toLowerCase();

  if (status === 'success') {
    // STEP 3 — Ledger recording happens atomically inside confirm_payment().
    const result = await paymentRepo.confirmPayment({
      p_reference: reference,
      p_amount: Number(data.amount),
      p_currency: data.currency || 'NGN',
      p_channel: data.channel || null,
      p_gateway_response: data.gateway_response || null,
      p_paid_at: data.paid_at || data.paidAt || new Date().toISOString(),
      p_source: source,
    });
    await afterConfirmation(result);
    return result;
  }
  if (status === 'failed' || status === 'reversed') {
    await paymentRepo.markPaymentFailed(reference, 'failed', data.gateway_response || status);
    notificationService.kickDispatcher();
    return { outcome: 'failed' };
  }
  if (status === 'abandoned' && Date.now() - new Date(attempt.created_at).getTime() > ABANDON_AFTER_MS) {
    await paymentRepo.markPaymentFailed(reference, 'abandoned', 'abandoned');
    return { outcome: 'abandoned' };
  }
  return { outcome: 'pending' };
}

async function afterConfirmation(result) {
  notificationService.kickDispatcher();
  if (result.refund_transaction_id && result.outcome !== 'already_processed') {
    refundService.processRefund(result.refund_transaction_id).catch((err) => logger.error({ err: err.message }, 'refund failed to start'));
  }
  if (result.outcome === 'applied' && result.purpose === 'bill_payment') {
    const { fulfil } = await billService();
    // Delivery can take a while; run it outside the request.
    setImmediate(() => fulfil(result.bill_payment_id).catch((err) => logger.error({ err: err.message }, 'bill fulfilment error')));
  }
}

/** Callback page polling: verify on demand if still open, then report state. */
export async function statusForUser(user, reference) {
  let attempt = await paymentRepo.findAttemptByReference(reference);
  if (!attempt || attempt.user_id !== user.id) throw AppError.notFound('Payment not found');
  if (attempt.status === 'initialized') {
    try {
      await verifyAndConfirm(reference, 'callback');
    } catch (err) {
      logger.warn({ reference, err: err.message }, 'callback verification deferred');
    }
    attempt = await paymentRepo.findAttemptByReference(reference);
  }
  return {
    reference: attempt.reference,
    purpose: attempt.purpose,
    targetId: attempt.target_id,
    amount: Number(attempt.amount),
    status: attempt.status,
    transactionId: attempt.transaction_id,
    paidAt: attempt.paid_at,
    message: {
      initialized: 'Processing payment...',
      success: 'Payment successful',
      failed: 'Payment failed. Please try again.',
      abandoned: 'Payment was not completed.',
      amount_mismatch: 'Payment amount did not match and will be refunded.',
      duplicate: 'This item was already paid. Your payment will be refunded.',
    }[attempt.status],
  };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
export function verifySignature(rawBody, signature) {
  if (!signature || typeof signature !== 'string' || !Buffer.isBuffer(rawBody) || rawBody.length === 0) return false;
  return safeEqual(paystackSignature(rawBody), signature);
}

export async function handleWebhook(rawBody, signature, req) {
  if (!verifySignature(rawBody, signature)) {
    await auditService.record({ action: 'paystack.webhook', resourceType: 'webhook', result: 'denied', metadata: { reason: 'bad_signature' }, req });
    throw AppError.unauthorized('Invalid signature', 'INVALID_SIGNATURE');
  }
  const event = JSON.parse(rawBody.toString('utf8'));
  const data = event.data || {};
  const eventKey = `${event.event}:${data.id ?? data.reference ?? data.transfer_code}:${data.status ?? ''}`;
  const stored = await paymentRepo.recordWebhook({
    provider: 'paystack',
    event: event.event,
    event_key: eventKey,
    reference: data.reference ?? data.transaction_reference ?? null,
    signature_valid: true,
    payload: event,
  });
  if (!stored) return { duplicate: true }; // already received — idempotent no-op
  await processWebhook(stored.id, event);
  return { received: true };
}

export async function processWebhook(webhookId, event) {
  const data = event.data || {};
  try {
    switch (event.event) {
      case 'charge.success':
        await verifyAndConfirm(data.reference, 'webhook');
        break;
      case 'transfer.success':
      case 'transfer.failed':
      case 'transfer.reversed':
        await (await payoutService()).handleTransferEvent(event.event, data);
        break;
      case 'refund.processed':
      case 'refund.failed':
        await refundService.handleRefundEvent(event.event, data);
        break;
      default:
        await paymentRepo.updateWebhook(webhookId, { status: 'ignored', processed_at: new Date().toISOString() });
        return;
    }
    await paymentRepo.updateWebhook(webhookId, { status: 'processed', processed_at: new Date().toISOString() });
  } catch (err) {
    logger.error({ webhookId, event: event.event, err: err.message }, 'webhook processing failed');
    await paymentRepo.updateWebhook(webhookId, { status: 'failed', error: String(err.message).slice(0, 500), attempts: (event.__attempts ?? 0) + 1 });
  }
}

/** Job: retry failed webhook processing. */
export async function retryFailedWebhooks() {
  const rows = await paymentRepo.listRetryableWebhooks();
  for (const row of rows) {
    await processWebhook(row.id, { ...row.payload, __attempts: row.attempts });
  }
  return rows.length;
}

/** Job: reconcile checkouts whose webhook never arrived. */
export async function reconcilePending() {
  const now = Date.now();
  const rows = await paymentRepo.listStaleAttempts({
    olderThan: new Date(now - 10 * 60 * 1000).toISOString(),
    newerThan: new Date(now - 48 * 3600 * 1000).toISOString(),
  });
  for (const row of rows) {
    try {
      await verifyAndConfirm(row.reference, 'reconciliation');
    } catch (err) {
      logger.warn({ reference: row.reference, err: err.message }, 'reconciliation verify failed');
    }
  }
  await paymentRepo.abandonExpiredAttempts(new Date(now - 48 * 3600 * 1000).toISOString());
  return rows.length;
}

// ---------------------------------------------------------------------------
// Ledger reads
// ---------------------------------------------------------------------------
export function listTransactions(userId, filters) {
  return paymentRepo.listTransactions({ ...filters, userId });
}

export async function getTransaction(user, id, { staff = false } = {}) {
  const tx = await paymentRepo.findTransaction(id);
  if (!tx || (!staff && tx.user_id !== user.id)) throw AppError.notFound('Transaction not found');
  return tx;
}

let banksCache = { at: 0, banks: [] };
export async function listBanks() {
  if (Date.now() - banksCache.at < 12 * 3600 * 1000 && banksCache.banks.length) return banksCache.banks;
  const banks = await paystack.listBanks();
  banksCache = {
    at: Date.now(),
    banks: banks.filter((b) => b.active !== false && b.currency === 'NGN').map((b) => ({ name: b.name, code: b.code })),
  };
  return banksCache.banks;
}
