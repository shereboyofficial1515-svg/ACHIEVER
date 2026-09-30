import crypto from 'node:crypto';

/**
 * VTpass helpers that do not talk to the network.
 */

/**
 * VTpass request IDs must start with the current Africa/Lagos date and time as
 * YYYYMMDDHHmm (12 digits), followed by any alphanumeric suffix. The suffix is
 * random, and the value is also unique in the database (bill_payments), so the
 * same financial request can never be submitted twice by mistake.
 */
export function vtpassRequestId(suffix = crypto.randomBytes(8).toString('hex'), now = new Date()) {
  if (!/^[A-Za-z0-9]+$/.test(suffix)) throw new Error('Request ID suffix must be alphanumeric');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  // Intl can render midnight as "24" in some engines.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}${get('month')}${get('day')}${hour}${get('minute')}${suffix}`;
}

/** Nigerian phone as VTpass expects it (11 digits, leading 0). */
export function localPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('234') && digits.length === 13) return `0${digits.slice(3)}`;
  if (digits.length === 10) return `0${digits}`;
  return digits;
}

/** Show only the last few characters of a customer number (meter, smartcard, phone). */
export function maskIdentifier(value, visible = 4) {
  const s = String(value ?? '');
  if (s.length <= visible) return s;
  return `${'•'.repeat(Math.min(6, s.length - visible))}${s.slice(-visible)}`;
}

/** "John Adewale Okafor" -> "John O." (verified names are shown in part only). */
export function maskName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const first = words[0][0].toUpperCase() + words[0].slice(1).toLowerCase();
  return words.length > 1 ? `${first} ${words[words.length - 1][0].toUpperCase()}.` : first;
}

const SECRET_KEYS = /^(purchased_code|token|mainToken|Token|cards|Pin|pin|pins|Serial|serial|tokenAmount|exchangeReference|Customer_Address|Address|address|api-key|secret-key|public-key)$/;

/**
 * Remove tokens, PINs, addresses and keys from a provider response before it is
 * stored or logged. Only the structure and status information remain.
 */
export function redactProviderPayload(value, depth = 0) {
  if (depth > 6 || value == null) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactProviderPayload(v, depth + 1));
  if (typeof value !== 'object') return typeof value === 'string' && value.length > 300 ? `${value.slice(0, 300)}…` : value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redactProviderPayload(v, depth + 1);
  }
  return out;
}

/** "Token : 1234-5678-..." -> "1234-5678-..." */
export function cleanToken(value) {
  if (value == null || value === '') return null;
  return String(value).replace(/^\s*(token|pin)\s*:\s*/i, '').trim() || null;
}
