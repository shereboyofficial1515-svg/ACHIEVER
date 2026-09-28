import { env } from '../config/env.js';
import { sendSms as termiiSend } from '../integrations/termii/termiiClient.js';
import * as adminRepo from '../repositories/adminRepository.js';
import * as settingsService from './settingsService.js';
import { logger } from '../utils/logger.js';
import { withTimeout } from '../utils/timeout.js';

/**
 * All SMS goes through here. Termii stays the provider; this layer adds:
 *  - the platform switches (sms.verification_enabled, sms.notifications_enabled)
 *  - provider health (persisted for the admin platform)
 *  - a circuit breaker: after repeated failures the provider is not called
 *    again until a back-off expires, so an outage fails fast and the email
 *    fallback is offered instead of users waiting on timeouts.
 */
export const SMS_STATES = Object.freeze({ ENABLED: 'SMS_ENABLED', DISABLED: 'SMS_DISABLED', PROVIDER_ERROR: 'SMS_PROVIDER_ERROR' });
export const PROVIDER_STATUS = Object.freeze({
  OPERATIONAL: 'operational', DEGRADED: 'degraded', UNAVAILABLE: 'unavailable', NOT_CONFIGURED: 'not_configured',
});

const OPEN_AFTER_FAILURES = 3;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;

const health = {
  consecutiveFailures: 0,
  totalFailures: 0,
  totalSuccesses: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastErrorCode: null,
  lastLatencyMs: null,
  circuitOpenUntil: 0,
  loaded: false,
};

async function loadOnce() {
  if (health.loaded) return;
  health.loaded = true;
  try {
    const row = await withTimeout(adminRepo.getProviderHealth('termii'), 1_500, 'provider health');
    if (!row) return;
    health.consecutiveFailures = row.consecutive_failures ?? 0;
    health.totalFailures = Number(row.total_failures ?? 0);
    health.totalSuccesses = Number(row.total_successes ?? 0);
    health.lastSuccessAt = row.last_success_at;
    health.lastFailureAt = row.last_failure_at;
    health.lastErrorCode = row.last_error_code;
    health.lastLatencyMs = row.last_latency_ms;
    health.circuitOpenUntil = row.circuit_open_until ? new Date(row.circuit_open_until).getTime() : 0;
  } catch {
    /* health history is informative only */
  }
}

export function providerStatus(now = Date.now()) {
  if (!env.features.sms) return PROVIDER_STATUS.NOT_CONFIGURED;
  if (health.circuitOpenUntil > now) return PROVIDER_STATUS.UNAVAILABLE;
  if (health.consecutiveFailures > 0) return PROVIDER_STATUS.DEGRADED;
  return PROVIDER_STATUS.OPERATIONAL;
}

function persist() {
  adminRepo.saveProviderHealth('termii', {
    status: providerStatus(),
    last_success_at: health.lastSuccessAt,
    last_failure_at: health.lastFailureAt,
    last_error_code: health.lastErrorCode,
    consecutive_failures: health.consecutiveFailures,
    total_successes: health.totalSuccesses,
    total_failures: health.totalFailures,
    last_latency_ms: health.lastLatencyMs,
    circuit_open_until: health.circuitOpenUntil ? new Date(health.circuitOpenUntil).toISOString() : null,
  }).catch(() => {});
}

function recordSuccess(latencyMs) {
  health.consecutiveFailures = 0;
  health.circuitOpenUntil = 0;
  health.totalSuccesses += 1;
  health.lastSuccessAt = new Date().toISOString();
  health.lastLatencyMs = latencyMs;
  persist();
}

function recordFailure(code, latencyMs) {
  health.consecutiveFailures += 1;
  health.totalFailures += 1;
  health.lastFailureAt = new Date().toISOString();
  health.lastErrorCode = String(code || 'SMS_SEND_FAILED').slice(0, 120);
  health.lastLatencyMs = latencyMs;
  if (health.consecutiveFailures >= OPEN_AFTER_FAILURES) {
    const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (health.consecutiveFailures - OPEN_AFTER_FAILURES));
    health.circuitOpenUntil = Date.now() + backoff;
    logger.warn({ provider: 'termii', failures: health.consecutiveFailures, backoffMs: backoff }, 'SMS provider unavailable; pausing requests');
  }
  persist();
}

/** What phone verification should do right now. */
export async function verificationState() {
  await loadOnce();
  const enabled = await settingsService.getBool('sms.verification_enabled', false);
  if (!enabled) return SMS_STATES.DISABLED;
  const status = providerStatus();
  if (status === PROVIDER_STATUS.NOT_CONFIGURED || status === PROVIDER_STATUS.UNAVAILABLE) return SMS_STATES.PROVIDER_ERROR;
  return SMS_STATES.ENABLED;
}

/**
 * Send an SMS. kind: 'verification' (codes), 'security' (alerts) or
 * 'notification' (non-essential notices). Never throws; returns
 * { ok, skipped?, error? } with a safe error code (provider text is logged only).
 */
export async function send({ to, message, kind = 'notification' }) {
  await loadOnce();
  if (!env.features.sms) return { ok: false, skipped: true, error: 'SMS_NOT_CONFIGURED' };
  const [verificationOn, notificationsOn] = await Promise.all([
    settingsService.getBool('sms.verification_enabled', false),
    settingsService.getBool('sms.notifications_enabled', false),
  ]);
  const allowed = kind === 'verification' ? verificationOn : kind === 'security' ? verificationOn || notificationsOn : notificationsOn;
  if (!allowed) return { ok: false, skipped: true, error: 'SMS_DISABLED' };
  if (health.circuitOpenUntil > Date.now()) return { ok: false, skipped: true, error: 'SMS_PROVIDER_UNAVAILABLE' };

  const started = Date.now();
  const result = await termiiSend({ to, message });
  const latency = Date.now() - started;
  if (result.ok) recordSuccess(latency);
  else recordFailure(result.error, latency);
  return result.ok ? result : { ok: false, error: 'SMS_SEND_FAILED' };
}

/** Admin view (no credentials). */
export async function status() {
  await loadOnce();
  const [verificationEnabled, notificationsEnabled, state] = await Promise.all([
    settingsService.getBool('sms.verification_enabled', false),
    settingsService.getBool('sms.notifications_enabled', false),
    verificationState(),
  ]);
  return {
    provider: 'Termii',
    senderId: env.TERMII_SENDER_ID || null,
    configured: env.features.sms,
    verificationEnabled,
    notificationsEnabled,
    state,
    providerStatus: providerStatus(),
    lastSuccessAt: health.lastSuccessAt,
    lastFailureAt: health.lastFailureAt,
    lastErrorCode: health.lastErrorCode,
    consecutiveFailures: health.consecutiveFailures,
    failureCount: health.totalFailures,
    successCount: health.totalSuccesses,
    lastLatencyMs: health.lastLatencyMs,
    retryAfter: health.circuitOpenUntil > Date.now() ? new Date(health.circuitOpenUntil).toISOString() : null,
  };
}

/** Test hook. */
export function __resetHealth() {
  Object.assign(health, {
    consecutiveFailures: 0, totalFailures: 0, totalSuccesses: 0, lastSuccessAt: null, lastFailureAt: null,
    lastErrorCode: null, lastLatencyMs: null, circuitOpenUntil: 0, loaded: true,
  });
}
