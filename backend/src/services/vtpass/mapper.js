import { cleanToken } from '../../utils/vtpass.js';

/**
 * Turns a VTpass purchase / requery / webhook body into ACHIEVER's outcome.
 *
 *   delivered   the provider confirmed delivery (code 000 + status "delivered")
 *   failed      the provider says it was not done; the customer is refunded
 *   reversed    the provider bounced a transaction (code 040 / status "reversed")
 *   processing  pending, initiated, still processing, or UNKNOWN (network
 *               error, timeout, unexpected reply) — requeried later, never
 *               assumed successful and never assumed failed
 *
 * An HTTP 200 alone never means success.
 */
const PROCESSING_CODES = new Set(['099', '001', '044', '019', '089', '083', '014']);
// Refused before processing: the customer was not served and VTpass did not charge.
const FAILED_CODES = new Set([
  '016', '010', '011', '012', '013', '015', '017', '018', '021', '022', '023', '024', '025', '026', '027', '028',
  '030', '031', '032', '034', '035', '085', '087', '091',
]);

function extractPins(json) {
  const cards = json.cards || json.content?.cards || json.Cards;
  if (Array.isArray(cards) && cards.length) {
    return cards.slice(0, 20).map((c) => ({ serial: c.Serial ?? c.serial ?? null, pin: String(c.Pin ?? c.pin ?? '') })).filter((c) => c.pin);
  }
  return null;
}

export function mapProviderResult({ json, networkError = false, httpStatus = 0 } = {}) {
  if (networkError || !json || typeof json !== 'object') {
    return { outcome: 'processing', unknown: true, error: 'PROVIDER_UNREACHABLE', code: null, retryable: true, httpStatus };
  }
  const code = json.code != null ? String(json.code) : null;
  const tx = json.content?.transactions ?? {};
  const status = String(tx.status || '').toLowerCase();
  const providerTransactionId = tx.transactionId ? String(tx.transactionId) : json.transactionId ? String(json.transactionId) : null;
  const providerReference = providerTransactionId || (json.requestId ? String(json.requestId) : null);
  const base = { code, status: status || null, providerReference, providerTransactionId, httpStatus };

  if (code === '040' || status === 'reversed') {
    return { ...base, outcome: 'reversed', error: json.response_description || 'Reversed by provider' };
  }
  if (code === '000' && status === 'delivered') {
    const pins = extractPins(json);
    const token = cleanToken(json.token || json.mainToken || (pins ? null : json.purchased_code));
    return {
      ...base,
      outcome: 'delivered',
      token,
      pins,
      units: json.units || json.mainTokenUnits || null,
    };
  }
  if (status === 'failed' || FAILED_CODES.has(code)) {
    return { ...base, outcome: 'failed', error: json.response_description || `Provider code ${code}`, retryable: false };
  }
  if (code === '000' || PROCESSING_CODES.has(code) || ['pending', 'initiated'].includes(status)) {
    return { ...base, outcome: 'processing', retryable: true };
  }
  // Anything unexpected is UNKNOWN: requery, never guess.
  return { ...base, outcome: 'processing', unknown: true, error: `Unexpected provider reply ${code ?? httpStatus}`, retryable: true };
}
