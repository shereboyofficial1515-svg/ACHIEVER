import { env } from '../../config/env.js';
import { disabledProvider } from './disabledProvider.js';
import { createVtpassProvider } from './vtpassProvider.js';

/**
 * Bill-payment provider abstraction.
 *
 * Paystack collects the customer's money; a separate licensed VTU/biller
 * aggregator delivers airtime, data and electricity. Every provider must
 * implement:
 *
 *   name: string
 *   catalog(): { airtime: Service[], data: Service[], electricity: Service[] }
 *   listVariations(serviceId): Promise<{ code, name, amount (kobo), fixedPrice }[]>
 *   verifyCustomer({ serviceId, customerId, meterType }): Promise<{ name, address? }>
 *   purchase({ requestId, category, serviceId, variationCode, customerId, amount (kobo), phone })
 *     : Promise<PurchaseResult>
 *   requery(requestId): Promise<PurchaseResult>
 *
 *   PurchaseResult = { outcome: 'delivered'|'processing'|'failed', providerReference?,
 *                      token?, units?, error?, retryable? }
 *
 * `requestId` is our idempotency key: re-sending the same id must never
 * double-deliver. Swap providers by adding an adapter and setting BILL_PROVIDER.
 */
let provider;

export function getBillProvider() {
  if (!provider) {
    provider = env.BILL_PROVIDER === 'vtpass' ? createVtpassProvider() : disabledProvider;
  }
  return provider;
}
