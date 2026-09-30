import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import * as providerHealth from '../providerHealthService.js';

/**
 * Low-level VTpass HTTP client (https://vtpass.com/documentation/).
 *
 * Authentication (current VTpass API keys, generated in the VTpass profile for
 * the sandbox or live environment):
 *   GET   api-key + public-key
 *   POST  api-key + secret-key
 * Keys live only in the backend environment; they are never sent to a client
 * or written to logs.
 */
export const PROVIDER = 'vtpass';

export function isConfigured() {
  return env.BILL_PROVIDER === 'vtpass' && Boolean(env.VTPASS_API_KEY && env.VTPASS_PUBLIC_KEY && env.VTPASS_SECRET_KEY);
}

export function isSandbox() {
  return /(^|\.)sandbox\.vtpass\.com$/i.test(new URL(env.VTPASS_BASE_URL).hostname);
}

/** Refuse to run with a mismatched environment (e.g. sandbox flag but live URL). */
export function assertEnvironment() {
  if (env.VTPASS_SANDBOX && !isSandbox()) {
    throw new Error('VTPASS_SANDBOX=true but VTPASS_BASE_URL is not the VTpass sandbox. Refusing to start bill payments.');
  }
  if (!env.VTPASS_SANDBOX && isSandbox() && env.isProduction) {
    throw new Error('VTPASS_SANDBOX=false but VTPASS_BASE_URL points at the sandbox.');
  }
}

const TIMEOUT_MS = { GET: 20_000, POST: 60_000 };

/**
 * Returns { httpStatus, json, networkError, latencyMs }. Never throws for
 * network problems: for a purchase the outcome is then UNKNOWN and is
 * requeried later.
 */
export async function call(method, path, body, { kind = 'catalog', fetchImpl = fetch } = {}) {
  const headers = method === 'GET'
    ? { 'api-key': env.VTPASS_API_KEY, 'public-key': env.VTPASS_PUBLIC_KEY, Accept: 'application/json' }
    : { 'api-key': env.VTPASS_API_KEY, 'secret-key': env.VTPASS_SECRET_KEY, 'Content-Type': 'application/json', Accept: 'application/json' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS[method] ?? 30_000);
  const started = Date.now();
  try {
    const res = await fetchImpl(`${env.VTPASS_BASE_URL.replace(/\/$/, '')}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    const latencyMs = Date.now() - started;
    const authFailure = res.status === 401 || res.status === 403 || json?.code === '087';
    const serverFailure = res.status >= 500 || !json;
    providerHealth.record(PROVIDER, {
      ok: !authFailure && !serverFailure, latencyMs, kind,
      errorCode: authFailure ? 'AUTHENTICATION_FAILED' : serverFailure ? `HTTP_${res.status}` : null,
      configured: isConfigured(),
    });
    return { httpStatus: res.status, json, networkError: false, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const code = err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
    logger.warn({ path, code }, 'vtpass request did not complete');
    providerHealth.record(PROVIDER, { ok: false, latencyMs, kind, errorCode: code, configured: isConfigured() });
    return { httpStatus: 0, json: null, networkError: true, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}
