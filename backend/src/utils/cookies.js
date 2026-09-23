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

/** Signed "session started at" marker: enforces absolute lifetime and revocation. */
export function signSessionStart(startedAtMs) {
  return `${startedAtMs}.${hmac(env.SESSION_SECRET, `session:${startedAtMs}`)}`;
}

export function readSessionStart(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const [ts, sig] = cookieValue.split('.');
  if (!ts || !sig || !safeEqual(sig, hmac(env.SESSION_SECRET, `session:${ts}`))) return null;
  const startedAt = Number(ts);
  return Number.isFinite(startedAt) ? startedAt : null;
}

export function sessionMaxAgeMs() {
  return env.SESSION_MAX_AGE_HOURS * 3600 * 1000;
}

export function setSessionCookies(res, session, startedAtMs = Date.now()) {
  const remaining = Math.max(0, startedAtMs + sessionMaxAgeMs() - Date.now());
  const accessMs = Math.max(60_000, session.expires_at * 1000 - Date.now());
  res.cookie(COOKIES.access, session.access_token, { ...base(), maxAge: Math.min(accessMs, remaining) });
  res.cookie(COOKIES.refresh, session.refresh_token, {
    ...base(),
    path: '/api/auth',
    maxAge: Math.min(REFRESH_MAX_MS, remaining),
  });
  res.cookie(COOKIES.session, signSessionStart(startedAtMs), { ...base(), maxAge: remaining });
}

export function clearSessionCookies(res) {
  res.clearCookie(COOKIES.access, base());
  res.clearCookie(COOKIES.refresh, { ...base(), path: '/api/auth' });
  res.clearCookie(COOKIES.session, base());
}

export function csrfCookieOptions() {
  return { ...base(), maxAge: 24 * 3600 * 1000 };
}
