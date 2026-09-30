import { AppError } from '../../utils/AppError.js';
import { localPhone, maskName, redactProviderPayload } from '../../utils/vtpass.js';
import { call, isConfigured, isSandbox, PROVIDER } from './client.js';
import * as catalog from './catalog.js';
import { mapProviderResult } from './mapper.js';

/**
 * VTpass bill-payment adapter. Implements the provider interface used by
 * billService (see integrations/bills/index.js).
 */
const naira = (kobo) => Math.round(Number(kobo)) / 100;

function verifiedDetails(c) {
  const renewal = Number(c.Renewal_Amount ?? c.renewal_amount);
  const minimum = Number(c.Min_Purchase_Amount ?? c.Minimum_Amount);
  return {
    status: c.Status ? String(c.Status).slice(0, 40) : null,
    dueDate: c.Due_Date ? String(c.Due_Date).slice(0, 40) : null,
    currentBouquet: c.Current_Bouquet ? String(c.Current_Bouquet).slice(0, 120) : null,
    renewalAmount: Number.isFinite(renewal) && renewal > 0 ? Math.round(renewal * 100) : null,
    meterType: c.Meter_Type ? String(c.Meter_Type).slice(0, 30) : null,
    minimumAmount: Number.isFinite(minimum) && minimum > 0 ? Math.round(minimum * 100) : null,
    canVend: c.Can_Vend == null ? null : String(c.Can_Vend).toLowerCase() !== 'no',
  };
}

export const vtpassProvider = {
  name: PROVIDER,
  get enabled() { return isConfigured(); },
  get sandbox() { return isSandbox(); },
  catalog,

  /**
   * Customer verification (meter, smartcard, betting account, JAMB profile).
   * Returns the full name for the review screen only; stored/receipt copies are masked.
   */
  async verifyCustomer({ serviceId, customerId, meterType }) {
    const body = { billersCode: String(customerId), serviceID: serviceId };
    if (meterType) body.type = meterType;
    const res = await call('POST', '/merchant-verify', body, { kind: 'verify' });
    if (res.networkError) throw AppError.unavailable('Bill payment is temporarily unavailable. Please try again shortly.', 'BILL_PROVIDER_UNAVAILABLE');
    const c = res.json?.content ?? {};
    const name = c.Customer_Name || c.customerName || c.name;
    if (!['000', '020'].includes(String(res.json?.code)) || c.error || c.WrongBillersCode || !name) {
      throw AppError.unprocessable('We could not verify that number. Check it and try again.', 'CUSTOMER_NOT_VERIFIED');
    }
    return {
      name: String(name).trim().slice(0, 120),
      maskedName: maskName(name),
      details: verifiedDetails(c),
      raw: redactProviderPayload(res.json),
    };
  },

  async purchase(bill) {
    const phone = localPhone(bill.phone);
    const body = { request_id: bill.provider_request_id, serviceID: bill.service_id, phone };
    switch (bill.category) {
      case 'airtime':
        body.amount = naira(bill.amount);
        break;
      case 'data':
        body.billersCode = phone;
        body.variation_code = bill.variation_code;
        body.amount = naira(bill.amount);
        break;
      case 'electricity':
        body.billersCode = bill.customer_identifier;
        body.variation_code = bill.variation_code; // prepaid | postpaid
        body.amount = naira(bill.amount);
        break;
      case 'tv':
        body.billersCode = catalog.serviceRules('tv', bill.service_id).billersCodeIsPhone ? phone : bill.customer_identifier;
        body.variation_code = bill.variation_code;
        body.amount = naira(bill.amount);
        body.subscription_type = bill.subscription_type || 'change';
        if (bill.quantity > 1) body.quantity = bill.quantity;
        break;
      case 'education':
      case 'recharge_pin':
        body.variation_code = bill.variation_code;
        body.quantity = bill.quantity || 1;
        body.amount = naira(bill.amount);
        if (catalog.serviceRules(bill.category, bill.service_id).verify) body.billersCode = bill.customer_identifier;
        break;
      case 'betting':
        body.billersCode = bill.customer_identifier;
        body.amount = naira(bill.amount);
        if (bill.variation_code) body.variation_code = bill.variation_code;
        break;
      default:
        throw AppError.badRequest('This service is not supported', 'UNSUPPORTED_SERVICE');
    }
    const res = await call('POST', '/pay', body, { kind: 'purchase' });
    return { ...mapProviderResult(res), payload: redactProviderPayload(res.json) };
  },

  async requery(requestId) {
    const res = await call('POST', '/requery', { request_id: requestId }, { kind: 'requery' });
    return { ...mapProviderResult(res), payload: redactProviderPayload(res.json) };
  },
};
