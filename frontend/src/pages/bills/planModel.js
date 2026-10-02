/**
 * Normalises VTpass plans/packages for display. Everything shown is derived
 * from what VTpass returned (name, amount, validity) — nothing is invented.
 *
 *   "Glo Data (SME) N320 - 1GB 30 days" -> { volume: "1 GB", validity: "30 days", type: "SME", period: "Monthly", price: 32000 }
 */
const VOLUME = /(\d+(?:\.\d+)?)\s?(TB|GB|MB)\b/i;
const VALIDITY = /(\d+)\s*(day|days|hrs?|hours?|week|weeks|month|months|mnths?)\b/i;
const PRICE = /(?:₦|\bN|NGN\s?)\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*\s*naira\b/gi;
const BRANDS = /\b(mtn|airtel|glo|globacom|9mobile|etisalat|data|plan|bundle|\(sme\)|sme)\b/gi;
const SPECIAL = /\b(xtra|xtradata|xtratalk|special|social|night|weekend|router|mega|hynet\w*|binge|youtube|whatsapp|instagram|tiktok|bonus|gifting|corporate|awoof)\b/i;

function normaliseValidity(raw) {
  const m = String(raw || '').match(VALIDITY);
  if (!m) return { text: raw || null, days: null };
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('h')) return { text: n === 24 ? '1 day' : `${n} hours`, days: n / 24 };
  if (unit.startsWith('w')) return { text: `${n} week${n === 1 ? '' : 's'}`, days: n * 7 };
  if (unit.startsWith('m')) return { text: `${n} month${n === 1 ? '' : 's'}`, days: n * 30 };
  return { text: `${n} day${n === 1 ? '' : 's'}`, days: n };
}

function periodOf(days) {
  if (days == null) return null;
  if (days <= 1) return 'Daily';
  if (days <= 7) return 'Weekly';
  if (days <= 31) return 'Monthly';
  return null; // longer plans get no period chip (VTpass does not label them)
}

export function normalisePlan(p, { providerName = '', category = 'data' } = {}) {
  const name = String(p.name || '').trim();
  const vol = category === 'data' ? name.match(VOLUME) : null;
  const validity = normaliseValidity(p.validity || name);
  const type = category !== 'data' ? null : /\bsme\b/i.test(name) ? 'SME' : SPECIAL.test(name) ? 'Special' : 'Regular';
  let title;
  if (vol) {
    title = `${vol[1]} ${vol[2].toUpperCase()}`;
  } else {
    // Packages (TV, exam PINs) and unusual data plans: the provider's own name, minus the price.
    title = name.replace(PRICE, '').replace(/\s*[-–]\s*$/, '').replace(/\s{2,}/g, ' ').trim() || name;
  }
  // A short secondary line from the leftover words of the VTpass name (no repetition of volume/validity/price).
  const rest = vol
    ? name.replace(PRICE, '').replace(VOLUME, '').replace(VALIDITY, '').replace(BRANDS, '').replace(/[-–()]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
    : '';
  const kind = category === 'data' ? `${providerName ? `${providerName} ` : ''}${type === 'Regular' ? '' : `${type} `}Data`.trim() : null;
  return {
    code: p.code,
    price: Number(p.amount),
    title,
    validity: validity.text,
    period: periodOf(validity.days),
    type,
    kind,
    note: rest && rest.length > 2 && rest.length < 40 ? rest : null,
    original: name,
  };
}

/** Filter chips actually present in the returned plans (never invented). */
export function planFilters(plans) {
  const set = new Set();
  for (const p of plans) {
    if (p.type) set.add(p.type);
    if (p.period) set.add(p.period);
  }
  const order = ['SME', 'Regular', 'Daily', 'Weekly', 'Monthly', 'Special'];
  return order.filter((k) => set.has(k));
}

export function matchesFilter(plan, filter) {
  return !filter || plan.type === filter || plan.period === filter;
}

// Nigerian mobile prefixes (NCC numbering plan). Numbers can be ported, so this is a hint only.
const PREFIXES = {
  mtn: ['0703', '0704', '0706', '0803', '0806', '0810', '0813', '0814', '0816', '0903', '0906', '0913', '0916', '07025', '07026'],
  airtel: ['0701', '0708', '0802', '0808', '0812', '0901', '0902', '0904', '0907', '0911', '0912'],
  glo: ['0705', '0805', '0807', '0811', '0815', '0905', '0915'],
  '9mobile': ['0809', '0817', '0818', '0908', '0909'],
};
const NETWORK_NAMES = { mtn: 'MTN', airtel: 'Airtel', glo: 'Glo', '9mobile': '9mobile' };

export function normalisePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('234') && digits.length === 13) return `0${digits.slice(3)}`;
  if (digits.length === 10 && /^[789]/.test(digits)) return `0${digits}`;
  return digits;
}

export function isValidPhone(raw) {
  return /^0[789][01]\d{8}$/.test(normalisePhone(raw));
}

/** { code, name } of the network the number was issued on, or null. */
export function detectNetwork(raw) {
  const n = normalisePhone(raw);
  if (n.length < 4) return null;
  for (const [code, list] of Object.entries(PREFIXES)) {
    if (list.some((p) => n.startsWith(p))) return { code, name: NETWORK_NAMES[code] };
  }
  return null;
}

/** "07010288040" -> "0701 028 8040" */
export function formatPhone(raw) {
  const n = normalisePhone(raw);
  if (n.length !== 11) return raw;
  return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
}

export function maskPhone(raw) {
  const n = normalisePhone(raw);
  return n.length === 11 ? `${n.slice(0, 4)} **** ${n.slice(7)}` : raw;
}
