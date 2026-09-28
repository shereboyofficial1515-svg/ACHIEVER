const nairaFormatter = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 });
const compactFormatter = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', notation: 'compact', maximumFractionDigits: 1 });

/** Amounts arrive from the API in kobo (integer). */
export function naira(kobo) {
  if (kobo === null || kobo === undefined || Number.isNaN(Number(kobo))) return '—';
  return nairaFormatter.format(Number(kobo) / 100);
}

export function nairaCompact(kobo) {
  return compactFormatter.format(Number(kobo || 0) / 100);
}

/**
 * Parse a naira amount typed by the user ("20,000.50") into integer kobo
 * without floating-point error. Returns null when invalid.
 */
export function parseNairaToKobo(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[₦,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const kobo = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(kobo) ? kobo : null;
}

export function koboToNairaInput(kobo) {
  if (!kobo && kobo !== 0) return '';
  const n = Number(kobo);
  return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2);
}

const TZ = 'Africa/Lagos';

export function formatDate(value, opts = { dateStyle: 'medium' }) {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat('en-NG', { timeZone: TZ, ...opts }).format(d);
}

export function formatDateTime(value) {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatTime(value) {
  return formatDate(value, { timeStyle: 'short' });
}

export function relativeTime(value) {
  if (!value) return '';
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(value);
}

export function todayLagos() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const today = new Date(`${todayLagos()}T00:00:00Z`);
  const target = new Date(`${isoDate}T00:00:00Z`);
  return Math.round((target - today) / 86400000);
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}

export function titleCase(s = '') {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const FREQUENCY_LABEL = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', flexible: 'Flexible' };

export function commissionLabel(type, value) {
  if (type === 'percentage') return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}% of savings`;
  return `${naira(value)} flat`;
}

export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function duration(seconds = 0) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
