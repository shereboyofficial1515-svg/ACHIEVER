import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

/**
 * VTpass adapter (https://www.vtpass.com/documentation/).
 * Verify service IDs and response codes against the current VTpass
 * documentation for your account before going live; use the sandbox first.
 */
const SERVICES = {
  airtime: [
    { serviceId: 'mtn', name: 'MTN' },
    { serviceId: 'glo', name: 'Glo' },
    { serviceId: 'airtel', name: 'Airtel' },
    { serviceId: 'etisalat', name: '9mobile' },
  ],
  data: [
    { serviceId: 'mtn-data', name: 'MTN Data' },
    { serviceId: 'glo-data', name: 'Glo Data' },
    { serviceId: 'airtel-data', name: 'Airtel Data' },
    { serviceId: 'etisalat-data', name: '9mobile Data' },
  ],
  electricity: [
    { serviceId: 'ikeja-electric', name: 'Ikeja Electric (IKEDC)' },
    { serviceId: 'eko-electric', name: 'Eko Electric (EKEDC)' },
    { serviceId: 'abuja-electric', name: 'Abuja Electric (AEDC)' },
    { serviceId: 'ibadan-electric', name: 'Ibadan Electric (IBEDC)' },
    { serviceId: 'enugu-electric', name: 'Enugu Electric (EEDC)' },
    { serviceId: 'portharcourt-electric', name: 'Port Harcourt Electric (PHED)' },
    { serviceId: 'kano-electric', name: 'Kano Electric (KEDCO)' },
    { serviceId: 'kaduna-electric', name: 'Kaduna Electric (KAEDCO)' },
    { serviceId: 'jos-electric', name: 'Jos Electric (JED)' },
    { serviceId: 'benin-electric', name: 'Benin Electric (BEDC)' },
    { serviceId: 'aba-electric', name: 'Aba Power' },
    { serviceId: 'yola-electric', name: 'Yola Electric (YEDC)' },
  ],
};

const ALL_SERVICE_IDS = new Set(Object.values(SERVICES).flat().map((s) => s.serviceId));

async function call(method, path, body) {
  const headers =
    method === 'GET'
      ? { 'api-key': env.VTPASS_API_KEY, 'public-key': env.VTPASS_PUBLIC_KEY }
      : { 'api-key': env.VTPASS_API_KEY, 'secret-key': env.VTPASS_SECRET_KEY, 'Content-Type': 'application/json' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${env.VTPASS_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    return { httpStatus: res.status, json };
  } catch (err) {
    // Network failure: outcome of a purchase is UNKNOWN, never assume failure.
    logger.warn({ path, err: err.message }, 'vtpass unreachable');
    return { httpStatus: 0, json: null, networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

function mapPurchase({ json, networkError }) {
  if (networkError || !json) return { outcome: 'processing', error: 'PROVIDER_UNREACHABLE', retryable: true };
  const tx = json.content?.transactions ?? {};
  const status = String(tx.status || '').toLowerCase();
  const providerReference = tx.transactionId ? String(tx.transactionId) : json.requestId;
  const token = json.purchased_code || json.token || json.mainToken || null;
  const units = json.units || json.mainTokenUnits || null;

  if (json.code === '000' && status === 'delivered') {
    return { outcome: 'delivered', providerReference, token: token ? String(token).replace(/^Token\s*:\s*/i, '') : null, units };
  }
  if (json.code === '016' || status === 'failed' || status === 'reversed') {
    return { outcome: 'failed', providerReference, error: json.response_description || 'Transaction failed' };
  }
  if (json.code === '000' || json.code === '099' || ['pending', 'initiated'].includes(status)) {
    return { outcome: 'processing', providerReference, retryable: true };
  }
  // Request rejected before processing (invalid arguments, product unavailable, etc.)
  return { outcome: 'failed', providerReference, error: json.response_description || `Provider code ${json.code}` };
}

/** VTpass requires request IDs to start with the Lagos-time stamp YYYYMMDDHHmm. */
export function vtpassRequestId(suffix) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${suffix}`;
}

export function createVtpassProvider() {
  if (!env.VTPASS_API_KEY || !env.VTPASS_SECRET_KEY || !env.VTPASS_PUBLIC_KEY) {
    throw new Error('BILL_PROVIDER=vtpass requires VTPASS_API_KEY, VTPASS_PUBLIC_KEY and VTPASS_SECRET_KEY');
  }
  return {
    name: 'vtpass',
    enabled: true,
    catalog: () => SERVICES,

    async listVariations(serviceId) {
      if (!ALL_SERVICE_IDS.has(serviceId)) throw AppError.badRequest('Unknown service');
      const { json, networkError } = await call('GET', `/service-variations?serviceID=${encodeURIComponent(serviceId)}`);
      if (networkError || !json?.content) throw AppError.unavailable('Could not load plans. Please try again.', 'BILL_PROVIDER_UNAVAILABLE');
      const list = json.content.variations || json.content.varations || [];
      return list.map((v) => ({
        code: v.variation_code,
        name: v.name,
        amount: Math.round(Number(v.variation_amount) * 100),
        fixedPrice: v.fixedPrice === 'Yes',
      }));
    },

    async verifyCustomer({ serviceId, customerId, meterType }) {
      const { json, networkError } = await call('POST', '/merchant-verify', {
        billersCode: customerId,
        serviceID: serviceId,
        type: meterType,
      });
      if (networkError) throw AppError.unavailable('Could not verify the customer right now.', 'BILL_PROVIDER_UNAVAILABLE');
      const c = json?.content ?? {};
      if (json?.code !== '000' || c.error || c.WrongBillersCode || !c.Customer_Name) {
        throw AppError.unprocessable('We could not verify that meter/customer number.', 'CUSTOMER_NOT_VERIFIED');
      }
      return { name: c.Customer_Name, address: c.Address || null };
    },

    async purchase({ requestId, category, serviceId, variationCode, customerId, amount, phone }) {
      const body = {
        request_id: requestId,
        serviceID: serviceId,
        amount: Math.round(amount / 100),
        phone: phone.replace(/^\+234/, '0'),
      };
      if (category === 'data') {
        body.billersCode = customerId;
        body.variation_code = variationCode;
      } else if (category === 'electricity') {
        body.billersCode = customerId;
        body.variation_code = variationCode; // 'prepaid' | 'postpaid'
      }
      return mapPurchase(await call('POST', '/pay', body));
    },

    async requery(requestId) {
      return mapPurchase(await call('POST', '/requery', { request_id: requestId }));
    },
  };
}

export const __test__ = { mapPurchase };
