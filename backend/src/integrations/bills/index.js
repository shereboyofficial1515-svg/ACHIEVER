import { env } from '../../config/env.js';
import { vtpassProvider } from '../../services/vtpass/index.js';
import { assertEnvironment } from '../../services/vtpass/client.js';

/**
 * Bill-payment provider registry.
 *
 * Paystack collects the customer's money; a licensed biller aggregator
 * (VTpass today) delivers the service. A provider implements:
 *
 *   name, enabled, sandbox
 *   catalog: { services(category), products(serviceId), refreshServices(), offeredCategories(), serviceRules() }
 *   verifyCustomer({ serviceId, customerId, meterType }) -> { name, maskedName, details }
 *   purchase(bill)      -> { outcome: delivered|failed|reversed|processing, code, providerReference,
 *                             providerTransactionId, token?, pins?, units?, error?, payload (redacted) }
 *   requery(requestId)  -> same shape
 *
 * Categories can be routed to different providers. Betting and recharge-card
 * PINs are routed to VTpass only when VTpass lists them for this account;
 * otherwise they are reported as unavailable (never simulated). To add a second
 * provider (e.g. an approved betting aggregator), implement the interface above
 * and map the category to it in ROUTES.
 */
const ROUTES = {
  airtime: 'vtpass', data: 'vtpass', electricity: 'vtpass', tv: 'vtpass', education: 'vtpass', betting: 'vtpass', recharge_pin: 'vtpass',
};
const PROVIDERS = { vtpass: vtpassProvider };

let checked = false;

export function getBillProvider(category = 'airtime') {
  const name = env.BILL_PROVIDER === 'disabled' ? null : ROUTES[category];
  const provider = name ? PROVIDERS[name] : null;
  if (provider && !checked) {
    checked = true;
    assertEnvironment();
  }
  return provider || null;
}
