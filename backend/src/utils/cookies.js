import { env } from '../config/env.js';
import { COOKIES } from '../config/constants.js';
import { hmac, safeEqual } from './crypto.js';

const base = () => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax',
  path: '/',
});

const REFRESH_MAX_MS = 30 * 24 * 3600 * 1000;

/**
 * Signed session marker: "<startedAtMs>.<sessionId>.<sig>". Enforces the
 * absolute lifetime and binds the browser to a server-side user_sessions row
 * (so individual sessions can be listed and revoked). The legacy
 * "<startedAtMs>.<sig>" form is still accepted, without a session id.
 */
export function signSessionStart(startedAtMs, sessionId = null) {
  if (!sessionId) return `${startedAtMs}.${hmac(env.SESSION_SECRET, `session:${startedAtMs}`)}`;
  return `${startedAtMs}.${sessionId}.${hmac(env.SESSION_SECRET, `session:${startedAtMs}:${sessionId}`)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns { startedAt, sessionId } or null when missing/tampered. */
export function readSession(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const parts = cookieValue.split('.');
  let ts;
  let sessionId = null;
  let expected;
  if (parts.length === 2) {
    [ts] = parts;
    expected = hmac(env.SESSION_SECRET, `session:${ts}`);
  } else if (parts.length === 3 && UUID.test(parts[1])) {
    [ts, sessionId] = parts;
    expected = hmac(env.SESSION_SECRET, `session:${ts}:${sessionId}`);
  } else {
    return null;
  }
  if (!ts || !safeEqual(parts[parts.length - 1], expected)) return null;
  const startedAt = Number(ts);
  return Number.isFinite(startedAt) ? { startedAt, sessionId } : null;
}

export function readSessionStart(cookieValue) {
  return readSession(cookieValue)?.startedAt ?? null;
}

export function sessionMaxAgeMs() {
  return env.SESSION_MAX_AGE_HOURS * 3600 * 1000;
}

export function setSessionCookies(res, session, startedAtMs = Date.now(), sessionId = null) {
  const remaining = Math.max(0, startedAtMs + sessionMaxAgeMs() - Date.now());
  const accessMs = Math.max(60_000, session.expires_at * 1000 - Date.now());
  res.cookie(COOKIES.access, session.access_token, { ...base(), maxAge: Math.min(accessMs, remaining) });
  res.cookie(COOKIES.refresh, session.refresh_token, {
    ...base(),
    path: '/api/auth',
    maxAge: Math.min(REFRESH_MAX_MS, remaining),
  });
  res.cookie(COOKIES.session, signSessionStart(startedAtMs, sessionId), { ...base(), maxAge: remaining });
}

export function clearSessionCookies(res) {
  res.clearCookie(COOKIES.access, base());
  res.clearCookie(COOKIES.refresh, { ...base(), path: '/api/auth' });
  res.clearCookie(COOKIES.session, base());
}

/** Long-lived random device identifier (stored server-side only as a keyed hash). */
export function setDeviceCookie(res, token) {
  res.cookie(COOKIES.device, token, { ...base(), maxAge: 365 * 24 * 3600 * 1000 });
}

export function csrfCookieOptions() {
  return { ...base(), maxAge: 24 * 3600 * 1000 };
}
