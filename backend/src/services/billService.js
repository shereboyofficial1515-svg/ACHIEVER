import { env } from '../config/env.js';
import { getBillProvider } from '../integrations/bills/index.js';
import * as billRepo from '../repositories/billRepository.js';
import * as txRepo from '../repositories/transactionSecurityRepository.js';
import * as auditService from './auditService.js';
import * as kycService from './kycService.js';
import * as notificationService from './notificationService.js';
import * as paymentService from './paymentService.js';
import * as providerHealth from './providerHealthService.js';
import * as refundService from './refundService.js';
import * as settingsService from './settingsService.js';
import * as transactionAuth from './transactionAuthService.js';
import { CATEGORIES, CATEGORY_LABELS, serviceRules, validityOf } from './vtpass/catalog.js';
import { environment, isConfigured } from './vtpass/client.js';
import { describeProvider } from './vtpass/providers.js';
import { AppError } from '../utils/AppError.js';
import { newPaymentReference } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { pageMeta } from '../utils/pagination.js';
import { createSecretBox } from '../utils/secretBox.js';
import { localPhone, maskIdentifier, vtpassRequestId } from '../utils/vtpass.js';

/**
 * Bills & Services: one transaction engine for every category.
 *
 *   details -> quote (server prices, verifies meter/smartcard) -> review
 *   -> approve (transaction PIN + emailed code, or Android biometric)
 *   -> Paystack checkout -> payment verified by webhook/verify
 *   -> VTpass purchase (claimed once) -> status: webhook + requery
 *   -> receipt
 *
 * The provider's HTTP 200 never means success; only a confirmed "delivered"
 * does. Unknown outcomes are requeried, never re-purchased and never guessed.
 */
const secrets = createSecretBox(env.dataEncryptionKey, 'achiever-bill-secrets');
const QUOTE_MINUTES = 15;

export const MESSAGES = {
  unavailable: 'Bill payment is temporarily unavailable. Please try again shortly.',
  pending: 'Your transaction is being processed. We will update you when the provider confirms it.',
  failed: 'The transaction was not completed.',
};

const PUBLIC_STATUS = {
  awaiting_authorization: 'AWAITING_AUTHORIZATION', awaiting_payment: 'PENDING', paid: 'PENDING', processing: 'PROCESSING',
  delivered: 'SUCCESS', failed: 'FAILED', refund_pending: 'FAILED', reversed: 'REVERSED', refunded: 'REFUNDED', cancelled: 'CANCELLED',
};
export function publicStatus(b) {
  if (b.status === 'processing' && /UNREACHABLE|Unexpected/i.test(b.last_error || '')) return 'UNKNOWN';
  return PUBLIC_STATUS[b.status] || 'UNKNOWN';
}

// Availability -------------------------------------------------------------------------------------
async function billSettings() {
  const [enabled, maintenance, categories, fees, maxAmount] = await Promise.all([
    settingsService.getBool('bills.enabled', true),
    settingsService.getBool('bills.maintenance_mode', false),
    settingsService.get('bills.categories_enabled', {}),
    settingsService.get('bills.fee_kobo', {}),
    settingsService.getInt('bills.max_amount_kobo', 10_000_000),
  ]);
  return { enabled, maintenance, categories: categories || {}, fees: fees || {}, maxAmount };
}

/** Why a category cannot be used right now (null = available). */
async function categoryBlock(category, cfg, services) {
  const provider = getBillProvider(category);
  if (!provider || !isConfigured()) return 'NOT_CONFIGURED';
  if (!cfg.enabled || cfg.categories[category] === false) return 'DISABLED';
  if (cfg.maintenance || (await settingsService.maintenanceMode())) return 'MAINTENANCE';
  if (providerHealth.status('vtpass', true) === providerHealth.STATUS.UNAVAILABLE) return 'PROVIDER_UNAVAILABLE';
  const usable = services.filter((s) => s.category === category && s.available && s.enabled);
  if (!usable.length) {
    const offered = provider.catalog.offeredCategories();
    return offered && !offered.includes(category) ? 'NOT_OFFERED' : 'NO_SERVICES';
  }
  return null;
}

export async function overview() {
  const cfg = await billSettings();
  const provider = getBillProvider('airtime');
  const all = provider && isConfigured() ? await provider.catalog.services().catch(() => []) : [];
  const categories = [];
  for (const key of CATEGORIES) {
    const block = await categoryBlock(key, cfg, all);
    categories.push({ key, label: CATEGORY_LABELS[key], available: !block, reason: block, fee: Number(cfg.fees[key] || 0) });
  }
  return {
    configured: Boolean(provider && isConfigured()),
    environment: provider && isConfigured() ? environment() : null,
    testMode: Boolean(provider && isConfigured() && environment() === 'sandbox'),
    sandbox: Boolean(provider && isConfigured() && environment() === 'sandbox'),
    status: providerHealth.status('vtpass', Boolean(provider && isConfigured())),
    categories,
  };
}

/** ACHIEVER provider model (the apps map providerCode/logoUrl to branding; never raw VTpass data). */
function formatService(s) {
  const rules = serviceRules(s.category, s.service_id);
  const p = describeProvider(s.service_id, s.name);
  return {
    id: s.service_id, serviceId: s.service_id, category: s.category, categoryLabel: CATEGORY_LABELS[s.category],
    providerCode: p.providerCode, providerName: p.providerName, shortName: p.shortName, description: p.description,
    name: p.providerName, logoKey: p.providerCode,
    logoUrl: s.image_url ? `/api/bills-assets/logos/${encodeURIComponent(s.service_id)}` : null,
    serviceType: rules.plans ? 'plans' : rules.verify ? 'account' : 'amount',
    enabled: Boolean(s.enabled), supported: Boolean(s.available),
    maintenance: Boolean(s.maintenance), maintenanceMessage: s.maintenance ? (s.maintenance_message || 'This provider is under maintenance. Please try again later.') : null,
    minAmount: s.min_amount != null ? Number(s.min_amount) : null, maxAmount: s.max_amount != null ? Number(s.max_amount) : null,
    needsVerification: Boolean(rules.verify), hasPlans: Boolean(rules.plans), meterType: Boolean(rules.meterType),
    quantity: Boolean(rules.quantity), returnsPins: Boolean(rules.pins), verifyLabel: rules.verifyLabel || null,
    phoneAsAccount: Boolean(rules.billersCodeIsPhone),
  };
}

async function assertCategoryOpen(category) {
  if (!CATEGORIES.includes(category)) throw AppError.badRequest('Unknown category', 'UNKNOWN_CATEGORY');
  const cfg = await billSettings();
  const provider = getBillProvider(category);
  const all = provider && isConfigured() ? await provider.catalog.services(category).catch(() => []) : [];
  const block = await categoryBlock(category, cfg, all);
  if (block === 'NOT_OFFERED' || block === 'NO_SERVICES') {
    throw AppError.unavailable(`${CATEGORY_LABELS[category]} is currently unavailable.`, 'BILL_SERVICE_UNAVAILABLE');
  }
  if (block) throw AppError.unavailable(MESSAGES.unavailable, `BILL_${block}`);
  return { cfg, provider, services: all };
}

export async function listServices(category) {
  if (!category) return catalogByCategory();
  const { services } = await assertCategoryOpen(category);
  return services.filter((s) => s.category === category && s.available && s.enabled).map(formatService);
}

/** GET /api/bills/services (no category) — enabled providers grouped by category; unavailable categories flagged. */
export async function catalogByCategory() {
  const cfg = await billSettings();
  const provider = getBillProvider('airtime');
  const all = provider && isConfigured() ? await provider.catalog.services().catch(() => []) : [];
  const out = [];
  for (const key of CATEGORIES) {
    const block = await categoryBlock(key, cfg, all);
    out.push({
      category: key, label: CATEGORY_LABELS[key], available: !block, reason: block,
      providers: block ? [] : all.filter((s) => s.category === key && s.available && s.enabled).map(formatService),
    });
  }
  return out;
}

/** Safe configuration status for the apps: environment only, never credentials. */
export async function status() {
  const configured = isConfigured();
  return {
    environment: configured ? environment() : null,
    testMode: configured ? environment() === 'sandbox' : false,
    configured,
    status: providerHealth.status('vtpass', configured),
  };
}

async function openService(category, serviceId) {
  const ctx = await assertCategoryOpen(category);
  const service = ctx.services.find((s) => s.service_id === serviceId && s.category === category);
  if (!service || !service.available || !service.enabled) throw AppError.unavailable('This provider is currently unavailable.', 'BILL_SERVICE_UNAVAILABLE');
  if (service.maintenance) throw AppError.unavailable(service.maintenance_message || 'This provider is under maintenance. Please try again later.', 'BILL_PROVIDER_MAINTENANCE');
  return { ...ctx, service, rules: serviceRules(category, serviceId) };
}

export async function listProducts(category, serviceId) {
  const { provider, rules } = await openService(category, serviceId);
  if (!rules.plans) return [];
  const rows = await provider.catalog.products(serviceId);
  return rows.map((p) => ({ code: p.variation_code, name: p.name, amount: Number(p.amount), fixedPrice: p.fixed_price, validity: validityOf(p.name) }));
}

export async function verifyCustomer({ category, serviceId, customerId, meterType }) {
  const { provider, rules } = await openService(category, serviceId);
  if (!rules.verify) throw AppError.badRequest('This service does not need verification', 'NO_VERIFICATION');
  const v = await provider.verifyCustomer({ serviceId, customerId, meterType: rules.meterType ? meterType : undefined });
  return { name: v.name, maskedName: v.maskedName, details: v.details };
}

// Quote (review) -----------------------------------------------------------------------------------
function describe(b) {
  const money = `₦${(Number(b.total_amount ?? b.amount + b.fee) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
  return `a ${money} ${b.service_name || CATEGORY_LABELS[b.category]} purchase`;
}

/**
 * Server-side pricing and verification. Returns the review; nothing is paid
 * and nothing is bought until the purchase is approved and paid.
 */
export async function quote(user, input, idempotencyKey = null) {
  const { cfg, provider, service, rules } = await openService(input.category, input.serviceId);
  await kycService.requireLevel(user.id, 'bill_payment');
  if (idempotencyKey) {
    const existing = await billRepo.findByIdempotencyKey(user.id, idempotencyKey);
    if (existing) return review(existing);
  }

  const phone = input.phone;
  let amount = input.amount ?? null;
  let variationCode = null;
  let customerId = null;
  let verified = {};
  let quantity = 1;
  let subscriptionType = null;
  let planName = null;

  const pickPlan = async () => {
    const plans = await provider.catalog.products(service.service_id);
    const plan = plans.find((p) => p.variation_code === input.variationCode);
    if (!plan) throw AppError.badRequest('Choose a valid plan', 'INVALID_PLAN');
    planName = plan.name;
    return plan;
  };
  const verifyNow = async (id, meterType) => {
    const v = await provider.verifyCustomer({ serviceId: service.service_id, customerId: id, meterType });
    verified = { name: v.maskedName, ...v.details };
    return v;
  };

  switch (input.category) {
    case 'airtime':
      customerId = localPhone(phone);
      break;
    case 'data': {
      const plan = await pickPlan();
      variationCode = plan.variation_code;
      amount = Number(plan.amount);
      customerId = localPhone(phone);
      break;
    }
    case 'electricity': {
      customerId = input.customerId;
      variationCode = input.meterType;
      const v = await verifyNow(customerId, input.meterType);
      if (v.details.canVend === false) throw AppError.unprocessable('This meter cannot be recharged right now. Contact your electricity provider.', 'METER_CANNOT_VEND');
      if (v.details.minimumAmount && amount < v.details.minimumAmount) {
        throw AppError.badRequest(`The minimum for this meter is ₦${(v.details.minimumAmount / 100).toLocaleString('en-NG')}`, 'AMOUNT_TOO_LOW');
      }
      verified.meterType = input.meterType;
      break;
    }
    case 'tv': {
      customerId = rules.billersCodeIsPhone ? localPhone(phone) : input.customerId;
      const v = rules.verify ? await verifyNow(customerId) : null;
      if (input.subscriptionType === 'renew') {
        if (!v?.details.renewalAmount) throw AppError.badRequest('Renewal is not available for this account. Choose a package.', 'RENEWAL_UNAVAILABLE');
        subscriptionType = 'renew';
        amount = v.details.renewalAmount;
        planName = v.details.currentBouquet ? `Renew ${v.details.currentBouquet}` : 'Renew current package';
      } else {
        const plan = await pickPlan();
        variationCode = plan.variation_code;
        amount = Number(plan.amount);
        subscriptionType = 'change';
      }
      break;
    }
    case 'education':
    case 'recharge_pin': {
      const plan = await pickPlan();
      variationCode = plan.variation_code;
      quantity = rules.quantity ? Math.min(Math.max(Number(input.quantity) || 1, 1), 10) : 1;
      amount = Number(plan.amount) * quantity;
      customerId = rules.verify ? input.customerId : localPhone(phone);
      if (rules.verify) await verifyNow(customerId);
      break;
    }
    case 'betting':
      customerId = input.customerId;
      await verifyNow(customerId);
      break;
    default:
      throw AppError.badRequest('Unknown category', 'UNKNOWN_CATEGORY');
  }

  const min = Math.max(5000, Number(service.min_amount || 0));
  const max = Math.min(cfg.maxAmount, Number(service.max_amount || Infinity));
  if (!Number.isSafeInteger(amount) || amount < min) throw AppError.badRequest(`The minimum amount is ₦${(min / 100).toLocaleString('en-NG')}`, 'AMOUNT_TOO_LOW');
  if (amount > max) throw AppError.badRequest(`The maximum amount is ₦${(max / 100).toLocaleString('en-NG')}`, 'AMOUNT_TOO_HIGH');
  const fee = Math.max(0, Number(cfg.fees[input.category] || 0));

  const bill = await billRepo.insert({
    reference: newPaymentReference('ACH-BILL'),
    user_id: user.id,
    category: input.category,
    service_id: service.service_id,
    service_name: planName ? `${service.name} — ${planName}`.slice(0, 120) : service.name.slice(0, 120),
    variation_code: variationCode,
    customer_identifier: String(customerId),
    customer_name: verified.name || null,
    verified_customer: verified,
    phone: phone,
    amount,
    fee,
    quantity,
    subscription_type: subscriptionType,
    provider: provider.name,
    provider_request_id: vtpassRequestId(),
    status: 'awaiting_authorization',
    quote_expires_at: new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString(),
    idempotency_key: idempotencyKey,
  });
  await auditService.record({ actorId: user.id, action: 'bill.initiated', resourceType: 'bill_payment', resourceId: bill.id, metadata: { category: bill.category, service_id: bill.service_id, total: Number(bill.total_amount) } });
  return review(bill);
}

function review(b) {
  return {
    billId: b.id,
    reference: b.reference,
    status: publicStatus(b),
    category: b.category,
    categoryLabel: CATEGORY_LABELS[b.category],
    service: b.service_name,
    recipient: b.category === 'airtime' || b.category === 'data' ? b.customer_identifier : maskIdentifier(b.customer_identifier),
    customerName: b.verified_customer?.name || null,
    customerDetails: b.verified_customer || {},
    phone: b.phone,
    quantity: b.quantity,
    subscriptionType: b.subscription_type,
    amount: Number(b.amount),
    fee: Number(b.fee),
    total: Number(b.total_amount),
    expiresAt: b.quote_expires_at,
  };
}

async function ownedBill(user, id) {
  const bill = await billRepo.find(id);
  if (!bill || bill.user_id !== user.id) throw AppError.notFound('Transaction not found');
  return bill;
}

async function openQuote(user, id) {
  const bill = await ownedBill(user, id);
  if (bill.status !== 'awaiting_authorization') throw AppError.conflict('This purchase has already been approved or cancelled', 'BILL_NOT_AWAITING_APPROVAL');
  if (new Date(bill.quote_expires_at).getTime() < Date.now()) throw AppError.badRequest('This review has expired. Start again.', 'QUOTE_EXPIRED');
  return bill;
}

// Approval ---------------------------------------------------------------------------------------------
export async function startAuthorization(user, id, { method, pin, deviceKeyId }, req) {
  const bill = await openQuote(user, id);
  return transactionAuth.createChallenge(user, { bill, method, pin, deviceKeyId, describe: describe(bill) }, req);
}

/**
 * Consume the approval, then open the Paystack checkout. The purchase itself
 * happens only after Paystack confirms the payment.
 */
export async function confirm(user, id, { challengeId, code, signature }, req) {
  const bill = await openQuote(user, id);
  await assertCategoryOpen(bill.category);   // provider may have gone down since the review
  const auth = await transactionAuth.consumeChallenge(user, { challengeId, code, signature }, bill, req);
  const updated = await billRepo.update(bill.id, {
    status: 'awaiting_payment', authorized_at: new Date().toISOString(), auth_method: auth.method, auth_challenge_id: auth.challengeId,
  }, { fromStatus: 'awaiting_authorization' });
  if (!updated) throw AppError.conflict('This purchase has already been approved', 'BILL_NOT_AWAITING_APPROVAL');
  await txRepo.insertEvent({ user_id: user.id, type: 'transaction_authorized', session_id: user.sessionId ?? null, ip_address: req?.ip || null, metadata: { bill_id: bill.id, method: auth.method } });
  await auditService.record({ actorId: user.id, action: 'bill.authorized', resourceType: 'bill_payment', resourceId: bill.id, metadata: { method: auth.method }, req });
  return checkout(user, updated);
}

async function checkout(user, bill) {
  const pay = await paymentService.initialize({
    user, purpose: 'bill_payment', targetId: bill.id, amount: Number(bill.total_amount),
    metadata: { bill_payment_id: bill.id, category: bill.category },
  });
  return { billId: bill.id, reference: bill.reference, ...pay };
}

/** Resume payment for an approved bill (e.g. the checkout page was closed). */
export async function resumeCheckout(user, id) {
  const bill = await ownedBill(user, id);
  if (bill.status !== 'awaiting_payment') throw AppError.conflict('This purchase is not waiting for payment', 'BILL_NOT_AWAITING_PAYMENT');
  return checkout(user, bill);
}

export async function cancel(user, id) {
  const bill = await ownedBill(user, id);
  if (!['awaiting_authorization', 'awaiting_payment'].includes(bill.status)) throw AppError.conflict('This purchase can no longer be cancelled', 'BILL_NOT_CANCELLABLE');
  await billRepo.update(bill.id, { status: 'cancelled' }, { fromStatus: bill.status });
  return { cancelled: true };
}

// Fulfilment -----------------------------------------------------------------------------------------
function seal(result) {
  if (!result.token && !result.pins?.length) return null;
  return secrets.seal(JSON.stringify({ token: result.token || null, pins: result.pins || null }));
}

async function logResponse(bill, kind, result) {
  await billRepo.logProviderResponse({
    bill_id: bill.id, kind, http_status: result.httpStatus ?? null, code: result.code ?? null,
    status: result.status ?? result.outcome ?? null, payload: result.payload ?? {},
  }).catch((err) => logger.warn({ err: err.message }, 'provider response not logged'));
}

const backoffSeconds = (attempts) => Math.min(3600, 30 * 2 ** Math.min(attempts, 7));

async function applyResult(bill, result, source) {
  if (result.outcome === 'reversed') {
    const r = await billRepo.recordReversal({ p_bill_id: bill.id, p_reason: result.error || 'Reversed by provider', p_source: source, p_provider_code: result.code ?? null });
    if (r?.refund_transaction_id) await refundService.processRefund(r.refund_transaction_id);
    return r;
  }
  const recorded = await billRepo.recordResult({
    p_bill_id: bill.id,
    p_outcome: result.outcome,
    p_provider_reference: result.providerReference ?? null,
    p_secure_payload: result.outcome === 'delivered' ? seal(result) : null,
    p_units: result.units ? String(result.units).slice(0, 60) : null,
    p_error: result.error ? String(result.error).slice(0, 300) : null,
    p_retry_in_seconds: backoffSeconds(bill.attempts),
    p_source: source,
    p_provider_transaction_id: result.providerTransactionId ?? null,
    p_provider_code: result.code ?? null,
  });
  if (recorded?.refund_transaction_id) await refundService.processRefund(recorded.refund_transaction_id);
  return recorded;
}

/**
 * Deliver a paid bill, or requery one whose outcome is not yet known. The
 * purchase is claimed atomically (paid -> processing) so it is sent to VTpass
 * at most once; afterwards only requery is used.
 */
export async function fulfil(billId, source = 'api') {
  let bill = await billRepo.find(billId);
  if (!bill || !['paid', 'processing'].includes(bill.status)) return null;
  const provider = getBillProvider(bill.category);
  if (!provider || !isConfigured()) return null;

  let result;
  let kind;
  if (bill.status === 'paid') {
    const claimed = await billRepo.update(bill.id, { next_retry_at: new Date(Date.now() + 120_000).toISOString(), status: 'processing' }, { fromStatus: 'paid' });
    if (!claimed) return null;          // another worker has it
    bill = claimed;
    kind = 'purchase';
    try {
      result = await provider.purchase(bill);
    } catch (err) {
      logger.warn({ billId, code: err.code }, 'bill purchase error');
      result = { outcome: 'processing', unknown: true, error: 'PROVIDER_ERROR' };
    }
  } else {
    kind = 'requery';
    try {
      result = await provider.requery(bill.provider_request_id);
    } catch {
      result = { outcome: 'processing', unknown: true, error: 'PROVIDER_ERROR' };
    }
  }
  await logResponse(bill, kind, result);
  const recorded = await applyResult(bill, result, source === 'api' ? kind : source);
  notificationService.kickDispatcher();
  return recorded;
}

/**
 * VTpass "transaction-update" callback. The body is NOT trusted (VTpass does
 * not sign callbacks): it only tells us which request to requery with our own
 * authenticated call.
 */
export async function handleWebhook(body) {
  providerHealth.markWebhook('vtpass', isConfigured()).catch(() => {});
  if (body?.type !== 'transaction-update') return { handled: false };
  const requestId = String(body?.data?.requestId || body?.requestId || '');
  if (!/^\d{12}[A-Za-z0-9]{0,60}$/.test(requestId)) return { handled: false };
  const bill = await billRepo.findByRequestId(requestId);
  if (!bill) return { handled: false };
  await logResponse(bill, 'webhook', { code: body?.data?.code ?? null, status: body?.data?.content?.transactions?.status ?? null, payload: { type: body.type, requestId } });
  if (['paid', 'processing'].includes(bill.status)) {
    await fulfil(bill.id, 'webhook');
  } else if (bill.status === 'delivered') {
    // A reversal after delivery: confirm with VTpass before acting.
    const provider = getBillProvider(bill.category);
    const r = await provider.requery(bill.provider_request_id);
    await logResponse(bill, 'requery', r);
    if (r.outcome === 'reversed') await applyResult(bill, r, 'webhook');
  }
  return { handled: true };
}

/** Job: dispatch paid bills, requery unknown ones, expire stale reviews, flag exhausted ones. */
export async function processPending() {
  const stuck = await billRepo.listPaidNotDispatched(new Date(Date.now() - 60_000).toISOString());
  const due = await billRepo.listDueForRequery();
  for (const b of [...stuck, ...due]) await fulfil(b.id, 'job');
  await billRepo.cancelStaleAwaiting(new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  await billRepo.cancelExpiredQuotes(new Date().toISOString());
  for (const b of await billRepo.listStuckProcessing()) {
    await billRepo.insertReconciliation({ bill_id: b.id, local_status: b.status, provider_status: null, outcome: 'unresolved', note: 'Automatic requeries exhausted; manual reconciliation needed' });
    await billRepo.update(b.id, { next_retry_at: new Date(Date.now() + 24 * 3600_000).toISOString() });
  }
  return stuck.length + due.length;
}

/** Compare our record with VTpass for one bill; never silently rewrites a final record. */
export async function reconcile(billId, actor = null) {
  const bill = await billRepo.find(billId);
  if (!bill) throw AppError.notFound('Transaction not found');
  const provider = getBillProvider(bill.category);
  if (!provider || !isConfigured()) throw AppError.unavailable(MESSAGES.unavailable, 'BILL_NOT_CONFIGURED');
  if (!bill.payment_reference) throw AppError.conflict('This transaction was never paid, so there is nothing to reconcile', 'BILL_NOT_PAID');
  const r = await provider.requery(bill.provider_request_id);
  await logResponse(bill, 'requery', r);
  let outcome = 'matched';
  let note = null;
  if (['paid', 'processing'].includes(bill.status) && r.outcome !== 'processing') {
    await applyResult(bill, r, 'admin');
    outcome = 'updated';
  } else if (bill.status === 'delivered' && r.outcome === 'reversed') {
    await applyResult(bill, r, 'admin');
    outcome = 'updated';
  } else if (bill.status === 'delivered' && r.outcome === 'failed') {
    outcome = 'mismatch'; note = 'We recorded delivery but the provider reports failure';
  } else if (['refund_pending', 'refunded'].includes(bill.status) && r.outcome === 'delivered') {
    outcome = 'mismatch'; note = 'We refunded but the provider reports delivery';
  } else if (bill.status === 'processing') {
    outcome = 'unresolved'; note = 'Provider still processing';
  }
  await billRepo.insertReconciliation({ bill_id: bill.id, local_status: bill.status, provider_status: r.outcome, outcome, note });
  if (actor) await auditService.record({ actorId: actor.id, action: 'admin.bill.reconcile', resourceType: 'bill_payment', resourceId: bill.id, metadata: { outcome } });
  return { outcome, note, status: publicStatus(await billRepo.find(bill.id)) };
}

// Reading ---------------------------------------------------------------------------------------------
function format(b, { admin = false } = {}) {
  return {
    id: b.id,
    reference: b.reference,
    category: b.category,
    categoryLabel: CATEGORY_LABELS[b.category] || b.category,
    service: b.service_name,
    serviceId: b.service_id,
    recipient: admin || b.category === 'airtime' || b.category === 'data' ? b.customer_identifier : maskIdentifier(b.customer_identifier),
    customerName: b.verified_customer?.name || null,
    quantity: b.quantity,
    amount: Number(b.amount),
    fee: Number(b.fee),
    total: Number(b.total_amount),
    status: publicStatus(b),
    internalStatus: admin ? b.status : undefined,
    message: b.status === 'processing' ? MESSAGES.pending : ['refund_pending', 'failed'].includes(b.status) ? MESSAGES.failed : null,
    hasSecrets: Boolean(b.secure_payload),
    units: b.units,
    providerReference: b.provider_reference,
    providerTransactionId: admin ? b.provider_transaction_id : undefined,
    requestId: admin ? b.provider_request_id : undefined,
    paymentReference: b.payment_reference,
    authMethod: b.auth_method,
    createdAt: b.created_at,
    completedAt: b.completed_at,
    reversedAt: b.reversed_at,
    user: admin && b.user ? { name: b.user.full_name, email: b.user.email } : undefined,
    attempts: admin ? b.attempts : undefined,
    lastError: admin ? b.last_error : undefined,
    lastProviderCode: admin ? b.last_provider_code : undefined,
  };
}

export async function list(user, filters) {
  const result = await billRepo.list({ ...filters, userId: user.id });
  return { items: result.rows.map((b) => format(b)), meta: pageMeta(filters, result.total) };
}

export async function get(user, id) {
  const bill = await ownedBill(user, id);
  const events = await billRepo.events(bill.id);
  return {
    ...format(bill),
    history: events.map((e) => ({ status: PUBLIC_STATUS[e.to_status] || e.to_status, at: e.created_at })),
    canResumePayment: bill.status === 'awaiting_payment',
  };
}

/** Electricity token / exam PINs: shown only to the owner, on request, and audited. */
export async function revealSecrets(user, id, req) {
  const bill = await ownedBill(user, id);
  if (!bill.secure_payload || bill.status !== 'delivered') throw AppError.notFound('There is no token or PIN for this transaction');
  const data = JSON.parse(secrets.open(bill.secure_payload));
  await auditService.record({ actorId: user.id, action: 'bill.secret_viewed', resourceType: 'bill_payment', resourceId: bill.id, req });
  return { token: data.token, pins: data.pins, units: bill.units };
}

export async function receipt(user, id) {
  const bill = await ownedBill(user, id);
  if (bill.status === 'awaiting_authorization' || bill.status === 'cancelled') throw AppError.notFound('No receipt for this transaction');
  return {
    issuer: 'ACHIEVER',
    reference: bill.reference,
    date: bill.completed_at || bill.created_at,
    service: bill.service_name,
    category: CATEGORY_LABELS[bill.category],
    provider: bill.service_name?.split(' — ')[0] || bill.service_id,
    recipient: maskIdentifier(bill.customer_identifier),
    amount: Number(bill.amount),
    fee: Number(bill.fee),
    total: Number(bill.total_amount),
    status: publicStatus(bill),
    providerReference: bill.provider_reference,
    paymentReference: bill.payment_reference,
  };
}

export async function requery(user, id) {
  const bill = await ownedBill(user, id);
  if (bill.status === 'processing' && (!bill.next_retry_at || new Date(bill.next_retry_at).getTime() <= Date.now() + 90_000)) {
    await fulfil(bill.id, 'requery');
  }
  return get(user, id);
}

// Admin ------------------------------------------------------------------------------------------------
export async function listAll(filters) {
  const result = await billRepo.list({ ...filters, withUser: true });
  return { items: result.rows.map((b) => format(b, { admin: true })), meta: pageMeta(filters, result.total) };
}

export async function adminDetail(id) {
  const bill = await billRepo.find(id);
  if (!bill) throw AppError.notFound('Transaction not found');
  const [events, responses] = await Promise.all([billRepo.events(bill.id), billRepo.providerResponses(bill.id)]);
  return { ...format(bill, { admin: true }), history: events, providerResponses: responses };
}

export async function providerStatus() {
  const configured = isConfigured();
  return {
    ...(await providerHealth.snapshot('vtpass', configured)),
    configured,
    environment: environment(),
    sandbox: environment() === 'sandbox',
    webhookConfigured: Boolean(env.VTPASS_WEBHOOK_TOKEN),
  };
}

export async function adminServices() {
  const provider = getBillProvider('airtime');
  const rows = provider && isConfigured() ? await provider.catalog.services().catch(() => []) : await billRepo.listServices();
  const stats = new Map(((await billRepo.serviceStats().catch(() => [])) || []).map((r) => [r.service_id, r]));
  const health = providerHealth.status('vtpass', isConfigured());
  return rows.map((s) => {
    const st = stats.get(s.service_id) || {};
    return {
      ...formatService(s), available: s.available, enabled: s.enabled, disabledReason: s.disabled_reason, refreshedAt: s.refreshed_at,
      environment: environment(), health: !s.enabled ? 'disabled' : s.maintenance ? 'maintenance' : !s.available ? 'unavailable' : health,
      lastSuccessAt: st.last_success_at || null, lastFailureAt: st.last_failure_at || null,
      successes24h: Number(st.successes_24h || 0), failures24h: Number(st.failures_24h || 0), pendingNow: Number(st.pending_now || 0),
      lastResponse: st.last_response_at ? { code: st.last_response_code, status: st.last_response_status, at: st.last_response_at } : null,
      changedAt: s.changed_at || null,
    };
  });
}

export async function refreshCatalog(actor) {
  const provider = getBillProvider('airtime');
  if (!provider || !isConfigured()) throw AppError.unavailable('VTpass is not configured', 'BILL_NOT_CONFIGURED');
  const r = await provider.catalog.refreshServices({ force: true });
  await auditService.record({ actorId: actor.id, action: 'admin.bills.catalog_refresh', resourceType: 'bill_services', metadata: r });
  return r;
}

/** Admin: switch a provider on/off or into maintenance. Reason required; audited with before/after. */
export async function setServiceControl(actor, serviceId, { enabled, maintenance, maintenanceMessage, reason }, req) {
  const patch = {};
  if (enabled !== undefined) Object.assign(patch, { enabled, disabled_reason: enabled ? null : reason });
  if (maintenance !== undefined) Object.assign(patch, { maintenance, maintenance_message: maintenance ? (maintenanceMessage || null) : null });
  if (!Object.keys(patch).length) throw AppError.badRequest('Nothing to change');
  const before = await billRepo.findService(serviceId);
  if (!before) throw AppError.notFound('Service not found');
  const row = await billRepo.updateService(serviceId, patch);
  const action = maintenance !== undefined ? (maintenance ? 'admin.bills.provider_maintenance_on' : 'admin.bills.provider_maintenance_off')
    : enabled ? 'admin.bills.service_enabled' : 'admin.bills.service_disabled';
  await auditService.record({
    actorId: actor.id, action, resourceType: 'bill_service', resourceId: serviceId, reason, req,
    previousState: { enabled: before.enabled, maintenance: before.maintenance }, newState: { enabled: row.enabled, maintenance: row.maintenance },
  });
  return formatService(row);
}

export async function listReconciliation(filters) {
  const r = await billRepo.listReconciliation({ open: filters.open !== 'false', ...filters });
  return { items: r.rows, meta: pageMeta(filters, r.total) };
}

export async function resolveReconciliation(actor, id, note, req) {
  const row = await billRepo.resolveReconciliation(id, { resolved_by: actor.id, resolved_at: new Date().toISOString(), resolution_note: note });
  if (!row) throw AppError.notFound('Open reconciliation item not found');
  await auditService.record({ actorId: actor.id, action: 'admin.bills.reconciliation_resolved', resourceType: 'bill_reconciliation', resourceId: String(id), reason: note, req });
  return row;
}

export const __test__ = { backoffSeconds, format, review };
