// Strips ASCII control characters (except tab/newline) and normalises whitespace.
// Output is stored as plain text; React escapes it on render and email
// templates escape it with escapeHtml().
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(value) {
  if (typeof value !== 'string') return value;
  return value.replace(CONTROL, '').trim();
}

export function cleanSingleLine(value) {
  if (typeof value !== 'string') return value;
  return cleanText(value).replace(/\s+/g, ' ');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Normalise Nigerian phone numbers to E.164 (+234XXXXXXXXXX). */
export function normalizeNigerianPhone(input) {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[^\d+]/g, '');
  if (/^\+234[789][01]\d{8}$/.test(digits)) return digits;
  if (/^234[789][01]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^0[789][01]\d{8}$/.test(digits)) return `+234${digits.slice(1)}`;
  return null;
}

export function maskPhone(phone) {
  if (!phone) return null;
  return `${phone.slice(0, 7)}****${phone.slice(-3)}`;
}

export function maskEmail(email) {
  if (!email) return null;
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

export function safeFileName(name) {
  const base = String(name || 'file').split(/[\\/]/).pop();
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
}
