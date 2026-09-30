import * as billRepo from '../../repositories/billRepository.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { call, isConfigured } from './client.js';

/**
 * VTpass service discovery, normalised into ACHIEVER categories and cached in
 * bill_services / bill_products. The frontend never sees raw VTpass replies.
 *
 *   GET /service-categories                -> which categories this account has
 *   GET /services?identifier=<category>    -> services (serviceID, min/max amount, …)
 *   GET /service-variations?serviceID=<id> -> plans / bouquets / PIN types
 */

// ACHIEVER category -> how to recognise the VTpass category identifier.
// Betting and recharge-card PINs are not in VTpass's documented catalogue; they
// light up only if VTpass returns such a category for this account.
export const CATEGORY_MATCHERS = {
  airtime: (id) => id === 'airtime',
  data: (id) => id === 'data',
  electricity: (id) => id === 'electricity-bill',
  tv: (id) => id === 'tv-subscription',
  education: (id) => id === 'education',
  betting: (id) => /bet/i.test(id),
  recharge_pin: (id) => /(^|-)(e-?pin|recharge-card|recharge-pin)s?($|-)/i.test(id),
};
export const CATEGORIES = Object.keys(CATEGORY_MATCHERS);

export const CATEGORY_LABELS = {
  airtime: 'Airtime', data: 'Data', electricity: 'Electricity', tv: 'Cable TV',
  education: 'Exam PINs', betting: 'Betting', recharge_pin: 'Recharge PIN',
};

const SERVICES_TTL_MS = 6 * 3600_000;
const PRODUCTS_TTL_MS = 60 * 60_000;

// Service behaviour that the VTpass catalogue does not describe. Everything
// not listed uses the category default.
// Services whose purchase needs fields ACHIEVER does not collect yet are hidden
// (never sent with the wrong fields): international airtime (country/operator),
// and Smile / Spectranet data (billed to an account ID, not a phone number).
export const UNSUPPORTED_SERVICES = new Set(['foreign-airtime', 'smile-direct', 'spectranet']);

const SERVICE_RULES = {
  showmax: { verify: false, billersCodeIsPhone: true },
  jamb: { verify: true, verifyLabel: 'Profile ID' },
  'waec-registration': { verify: false },
  waec: { verify: false },
};
const CATEGORY_RULES = {
  airtime: { verify: false, plans: false },
  data: { verify: false, plans: true },
  electricity: { verify: true, plans: false, meterType: true },
  tv: { verify: true, plans: true },
  education: { verify: false, plans: true, pins: true, quantity: true },
  betting: { verify: true, plans: false },
  recharge_pin: { verify: false, plans: true, pins: true, quantity: true },
};

export function serviceRules(category, serviceId) {
  return { ...(CATEGORY_RULES[category] || {}), ...(SERVICE_RULES[serviceId] || {}) };
}

const kobo = (naira) => {
  const n = Number(naira);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

let refreshing = null;
let lastRefresh = 0;
let lastCategories = null;

/** Pull categories and services from VTpass into the cache. */
export async function refreshServices({ force = false } = {}) {
  if (!isConfigured()) return { refreshed: false, reason: 'NOT_CONFIGURED' };
  if (!force && Date.now() - lastRefresh < SERVICES_TTL_MS) return { refreshed: false, reason: 'FRESH' };
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const cats = await call('GET', '/service-categories', null, { kind: 'catalog' });
    const list = Array.isArray(cats.json?.content) ? cats.json.content : null;
    if (!list) throw AppError.unavailable('Bill payment is temporarily unavailable. Please try again shortly.', 'BILL_PROVIDER_UNAVAILABLE');
    const found = {};
    for (const c of list) {
      const id = String(c.identifier || '');
      const category = CATEGORIES.find((k) => CATEGORY_MATCHERS[k](id));
      if (category && !found[category]) found[category] = id;
    }
    for (const [category, identifier] of Object.entries(found)) {
      const res = await call('GET', `/services?identifier=${encodeURIComponent(identifier)}`, null, { kind: 'catalog' });
      const services = Array.isArray(res.json?.content) ? res.json.content : null;
      if (!services) continue;
      const rows = services
        .filter((s) => /^[a-z0-9-]{2,60}$/.test(String(s.serviceID || '')) && !UNSUPPORTED_SERVICES.has(String(s.serviceID)))
        .map((s) => ({
          service_id: String(s.serviceID), provider: 'vtpass', category, name: String(s.name || s.serviceID).slice(0, 120),
          min_amount: kobo(s.minimium_amount ?? s.minimum_amount), max_amount: kobo(s.maximum_amount),
          product_type: s.product_type ? String(s.product_type).slice(0, 30) : null,
          image_url: typeof s.image === 'string' && /^https:\/\//.test(s.image) ? s.image.slice(0, 300) : null,
          available: true, refreshed_at: new Date().toISOString(),
        }));
      await billRepo.upsertServices(rows);
      await billRepo.markServicesUnavailable(category, rows.map((r) => r.service_id));
    }
    // Categories VTpass no longer lists are switched off (never deleted).
    for (const category of CATEGORIES.filter((c) => !found[c])) await billRepo.markServicesUnavailable(category, []);
    lastCategories = found;
    lastRefresh = Date.now();
    return { refreshed: true, categories: Object.keys(found) };
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** Categories VTpass offers this account (null until the first refresh). */
export function offeredCategories() {
  return lastCategories ? Object.keys(lastCategories) : null;
}

export async function services(category) {
  if (isConfigured()) {
    try {
      await refreshServices();
    } catch (err) {
      logger.warn({ code: err.code }, 'vtpass catalogue refresh failed; using cache');
    }
  }
  return billRepo.listServices(category);
}

/** Plans / bouquets / PIN types for a service (cached for an hour). */
export async function products(serviceId, { force = false } = {}) {
  const cached = await billRepo.listProducts(serviceId);
  const fresh = cached.length && cached.every((p) => Date.now() - new Date(p.refreshed_at).getTime() < PRODUCTS_TTL_MS);
  if (fresh && !force) return cached;
  if (!isConfigured()) return cached;
  const res = await call('GET', `/service-variations?serviceID=${encodeURIComponent(serviceId)}`, null, { kind: 'catalog' });
  const content = res.json?.content;
  // VTpass has returned both "variations" and the misspelt "varations".
  const list = content?.variations || content?.varations;
  if (!Array.isArray(list)) {
    if (cached.length) return cached;
    throw AppError.unavailable('Could not load plans right now. Please try again shortly.', 'BILL_PROVIDER_UNAVAILABLE');
  }
  // VTpass lists can repeat a variation code (seen for MTN, Glo and 9mobile data): keep the first.
  const seen = new Set();
  const rows = list
    .filter((v) => v.variation_code && Number.isFinite(Number(v.variation_amount)))
    .filter((v) => !seen.has(String(v.variation_code)) && seen.add(String(v.variation_code)))
    .map((v) => ({
      service_id: serviceId,
      variation_code: String(v.variation_code).slice(0, 120),
      name: String(v.name || v.variation_code).slice(0, 200),
      amount: Math.round(Number(v.variation_amount) * 100),
      fixed_price: String(v.fixedPrice).toLowerCase() === 'yes',
      available: true,
      refreshed_at: new Date().toISOString(),
    }));
  try {
    await billRepo.replaceProducts(serviceId, rows);
    return await billRepo.listProducts(serviceId);
  } catch (err) {
    // The cache is an optimisation: members still get the current plans if it cannot be written.
    logger.warn({ serviceId, err: err.message }, 'plan cache not updated');
    return rows.sort((a, b) => a.amount - b.amount);
  }
}

/** "MTN N1000 1.5GB - 30 days" -> "30 days" (best effort; VTpass has no separate validity field). */
export function validityOf(name) {
  const m = String(name).match(/(\d+\s*(?:hrs?|hours?|days?|weeks?|months?|mnths?))/i) || String(name).match(/\b(daily|weekly|monthly|yearly)\b/i);
  return m ? m[1].replace(/mnths?/i, 'months') : null;
}

export function __resetCache() {
  lastRefresh = 0;
  lastCategories = null;
}
