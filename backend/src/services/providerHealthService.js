import * as adminRepo from '../repositories/adminRepository.js';
import { withTimeout } from '../utils/timeout.js';

/**
 * Health of an external provider (VTpass, FCM), kept in memory and mirrored to
 * provider_health so the Admin Platform can show it. Never stores credentials
 * or request/response bodies.
 *
 *   OPERATIONAL    recent calls succeed
 *   DEGRADED       at least one recent failure
 *   UNAVAILABLE    circuit open after repeated failures (new purchases paused)
 *   NOT_CONFIGURED credentials not set
 */
export const STATUS = { OPERATIONAL: 'operational', DEGRADED: 'degraded', UNAVAILABLE: 'unavailable', NOT_CONFIGURED: 'not_configured' };

const OPEN_AFTER = 5;          // consecutive failures
const OPEN_FOR_MS = 2 * 60_000;

const trackers = new Map();

function tracker(provider) {
  if (!trackers.has(provider)) {
    trackers.set(provider, {
      loaded: false, consecutiveFailures: 0, totalSuccesses: 0, totalFailures: 0,
      lastSuccessAt: null, lastFailureAt: null, lastErrorCode: null, lastLatencyMs: null, circuitOpenUntil: 0,
      lastTransactionAt: null, lastWebhookAt: null, lastRequeryAt: null,
    });
  }
  return trackers.get(provider);
}

async function load(provider) {
  const h = tracker(provider);
  if (h.loaded) return h;
  h.loaded = true;
  try {
    const row = await withTimeout(adminRepo.getProviderHealth(provider), 1_500, 'provider health');
    if (row) {
      Object.assign(h, {
        consecutiveFailures: row.consecutive_failures ?? 0,
        totalSuccesses: Number(row.total_successes ?? 0),
        totalFailures: Number(row.total_failures ?? 0),
        lastSuccessAt: row.last_success_at, lastFailureAt: row.last_failure_at, lastErrorCode: row.last_error_code,
        lastLatencyMs: row.last_latency_ms,
        circuitOpenUntil: row.circuit_open_until ? new Date(row.circuit_open_until).getTime() : 0,
        lastTransactionAt: row.last_transaction_at, lastWebhookAt: row.last_webhook_at, lastRequeryAt: row.last_requery_at,
      });
    }
  } catch {
    /* informative only */
  }
  return h;
}

export function status(provider, configured, now = Date.now()) {
  if (!configured) return STATUS.NOT_CONFIGURED;
  const h = tracker(provider);
  if (h.circuitOpenUntil > now) return STATUS.UNAVAILABLE;
  if (h.consecutiveFailures > 0) return STATUS.DEGRADED;
  return STATUS.OPERATIONAL;
}

function persist(provider, configured) {
  const h = tracker(provider);
  adminRepo.saveProviderHealth(provider, {
    status: status(provider, configured),
    last_success_at: h.lastSuccessAt, last_failure_at: h.lastFailureAt, last_error_code: h.lastErrorCode,
    consecutive_failures: h.consecutiveFailures, total_successes: h.totalSuccesses, total_failures: h.totalFailures,
    last_latency_ms: h.lastLatencyMs,
    circuit_open_until: h.circuitOpenUntil ? new Date(h.circuitOpenUntil).toISOString() : null,
    last_transaction_at: h.lastTransactionAt, last_webhook_at: h.lastWebhookAt, last_requery_at: h.lastRequeryAt,
  }).catch(() => {});
}

/** Record the result of one provider call. `kind`: purchase | requery | webhook | catalog | verify | send. */
export async function record(provider, { ok, latencyMs = null, errorCode = null, kind = null, configured = true }) {
  const h = await load(provider);
  const now = new Date().toISOString();
  if (ok) {
    h.consecutiveFailures = 0;
    h.totalSuccesses += 1;
    h.lastSuccessAt = now;
    h.circuitOpenUntil = 0;
  } else {
    h.consecutiveFailures += 1;
    h.totalFailures += 1;
    h.lastFailureAt = now;
    h.lastErrorCode = errorCode ? String(errorCode).slice(0, 120) : 'ERROR';
    if (h.consecutiveFailures >= OPEN_AFTER) h.circuitOpenUntil = Date.now() + OPEN_FOR_MS;
  }
  if (latencyMs != null) h.lastLatencyMs = Math.round(latencyMs);
  if (kind === 'purchase' && ok) h.lastTransactionAt = now;
  if (kind === 'requery') h.lastRequeryAt = now;
  persist(provider, configured);
}

export async function markWebhook(provider, configured = true) {
  const h = await load(provider);
  h.lastWebhookAt = new Date().toISOString();
  persist(provider, configured);
}

export async function snapshot(provider, configured) {
  const h = await load(provider);
  return {
    provider,
    status: status(provider, configured),
    lastSuccessAt: h.lastSuccessAt,
    lastFailureAt: h.lastFailureAt,
    lastErrorCode: h.lastErrorCode,
    consecutiveFailures: h.consecutiveFailures,
    totalSuccesses: h.totalSuccesses,
    totalFailures: h.totalFailures,
    lastLatencyMs: h.lastLatencyMs,
    lastTransactionAt: h.lastTransactionAt,
    lastWebhookAt: h.lastWebhookAt,
    lastRequeryAt: h.lastRequeryAt,
  };
}

export function __reset() {
  trackers.clear();
}
