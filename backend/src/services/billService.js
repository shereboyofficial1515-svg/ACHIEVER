import crypto from 'node:crypto';
import { getBillProvider } from '../integrations/bills/index.js';
import { vtpassRequestId } from '../integrations/bills/vtpassProvider.js';
import * as billRepo from '../repositories/billRepository.js';
import * as paymentService from './paymentService.js';
import * as refundService from './refundService.js';
import * as notificationService from './notificationService.js';
import { AppError } from '../utils/AppError.js';
import { newPaymentReference } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { pageMeta } from '../utils/pagination.js';

const MIN_AMOUNT = { airtime: 5000, data: 5000, electricity: 100000 }; // kobo

export function catalog() {
  const provider = getBillProvider();
  return { enabled: provider.enabled !== false, provider: provider.name, services: provider.catalog() };
}

function assertService(category, serviceId) {
  const services = getBillProvider().catalog()[category] || [];
  if (!services.some((s) => s.serviceId === serviceId)) throw AppError.badRequest('Unknown service for this category', 'UNKNOWN_SERVICE');
}

export async function variations(serviceId) {
  return getBillProvider().listVariations(serviceId);
}

export async function verifyCustomer({ serviceId, customerId, meterType }) {
  assertService('electricity', serviceId);
  return getBillProvider().verifyCustomer({ serviceId, customerId, meterType });
}

function requestId() {
  const suffix = crypto.randomBytes(6).toString('hex');
  return getBillProvider().name === 'vtpass' ? vtpassRequestId(suffix) : `ACH${Date.now()}${suffix}`;
}

/**
 * Create the bill order and start a Paystack checkout. Amounts for fixed-price
 * data plans are taken from the provider, never from the client.
 */
export async function create(user, input) {
  const provider = getBillProvider();
  if (provider.enabled === false) {
    throw AppError.unavailable('Bill payments are not yet available on this platform.', 'BILL_PROVIDER_NOT_CONFIGURED');
  }
  assertService(input.category, input.serviceId);

  let amount = input.amount;
  let variationCode = null;
  let customerName = null;
  let customerId = input.customerId;

  if (input.category === 'airtime') {
    customerId = input.phone;
  } else if (input.category === 'data') {
    const plans = await provider.listVariations(input.serviceId);
    const plan = plans.find((p) => p.code === input.variationCode);
    if (!plan) throw AppError.badRequest('Choose a valid data plan', 'INVALID_PLAN');
    variationCode = plan.code;
    amount = plan.amount;
    customerId = input.phone;
  } else if (input.category === 'electricity') {
    variationCode = input.meterType;
    const customer = await provider.verifyCustomer({ serviceId: input.serviceId, customerId, meterType: input.meterType });
    customerName = customer.name;
  }
  if (!Number.isSafeInteger(amount) || amount < MIN_AMOUNT[input.category]) {
    throw AppError.badRequest('Amount is below the minimum for this service', 'AMOUNT_TOO_LOW');
  }

  const bill = await billRepo.insert({
    reference: newPaymentReference('ACH-BILL'),
    user_id: user.id,
    category: input.category,
    service_id: input.serviceId,
    variation_code: variationCode,
    customer_identifier: customerId,
    customer_name: customerName,
    phone: input.phone,
    amount,
    provider: provider.name,
    provider_request_id: requestId(),
  });
  const checkout = await paymentService.initialize({
    user,
    purpose: 'bill_payment',
    targetId: bill.id,
    amount,
    metadata: { bill_payment_id: bill.id, category: input.category },
  });
  return { billPaymentId: bill.id, customerName, amount, ...checkout };
}

/**
 * Deliver a paid bill. The provider request id is our idempotency key, so a
 * retry after a timeout can never double-deliver.
 */
export async function fulfil(billId) {
  const bill = await billRepo.find(billId);
  if (!bill || !['paid', 'processing'].includes(bill.status)) return null;
  const provider = getBillProvider();
  let result;
  try {
    result = bill.status === 'paid'
      ? await provider.purchase({
          requestId: bill.provider_request_id,
          category: bill.category,
          serviceId: bill.service_id,
          variationCode: bill.variation_code,
          customerId: bill.customer_identifier,
          amount: Number(bill.amount),
          phone: bill.phone,
        })
      : await provider.requery(bill.provider_request_id);
  } catch (err) {
    logger.warn({ billId, err: err.message }, 'bill provider error');
    result = { outcome: 'processing', error: err.code || 'PROVIDER_ERROR' };
  }
  const backoff = Math.min(3600, 60 * 2 ** Math.min(bill.attempts, 6));
  const recorded = await billRepo.recordResult({
    p_bill_id: bill.id,
    p_outcome: result.outcome,
    p_provider_reference: result.providerReference ?? null,
    p_token: result.token ?? null,
    p_units: result.units ?? null,
    p_error: result.error ?? null,
    p_retry_in_seconds: backoff,
  });
  if (recorded?.refund_transaction_id) await refundService.processRefund(recorded.refund_transaction_id);
  notificationService.kickDispatcher();
  return recorded;
}

/** Job: requery bills whose outcome is still unknown, and dispatch any paid-but-unsent bills. */
export async function processPending() {
  const due = await billRepo.listDueForRequery();
  const stuck = await billRepo.listPaidNotDispatched(new Date(Date.now() - 2 * 60 * 1000).toISOString());
  for (const b of [...stuck, ...due]) await fulfil(b.id);
  await billRepo.cancelStaleAwaiting(new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  return due.length + stuck.length;
}

function format(b) {
  return {
    id: b.id,
    reference: b.reference,
    category: b.category,
    serviceId: b.service_id,
    variationCode: b.variation_code,
    customerIdentifier: b.customer_identifier,
    customerName: b.customer_name,
    phone: b.phone,
    amount: Number(b.amount),
    status: b.status,
    token: b.token,
    units: b.units,
    providerReference: b.provider_reference,
    paymentReference: b.payment_reference,
    createdAt: b.created_at,
    completedAt: b.completed_at,
    user: b.user ? { name: b.user.full_name, email: b.user.email } : undefined,
    attempts: b.attempts,
    lastError: b.last_error,
  };
}

export async function list(user, filters) {
  const result = await billRepo.list({ ...filters, userId: user.id });
  return { items: result.rows.map(format), meta: pageMeta(filters, result.total) };
}

export async function listAll(filters) {
  const result = await billRepo.list({ ...filters, withUser: true });
  return { items: result.rows.map(format), meta: pageMeta(filters, result.total) };
}

export async function get(user, id) {
  const bill = await billRepo.find(id);
  if (!bill || bill.user_id !== user.id) throw AppError.notFound('Bill payment not found');
  return format(bill);
}

export async function requery(user, id) {
  const bill = await billRepo.find(id);
  if (!bill || bill.user_id !== user.id) throw AppError.notFound('Bill payment not found');
  if (bill.status === 'processing') await fulfil(id);
  return format(await billRepo.find(id));
}
