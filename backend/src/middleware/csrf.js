import { env } from '../config/env.js';
import { COOKIES } from '../config/constants.js';
import { AppError } from '../utils/AppError.js';
import { hmac, randomToken, safeEqual } from '../utils/crypto.js';
import { csrfCookieOptions } from '../utils/cookies.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Signed double-submit token. The browser receives the token in a JSON body
 * and echoes it in X-CSRF-Token; the HTTP-only cookie holds its HMAC. A
 * cross-site form cannot read the token, so it cannot forge the header.
 */
export function issueCsrfToken(res) {
  const token = randomToken(24);
  res.cookie(COOKIES.csrf, hmac(env.SESSION_SECRET, `csrf:${token}`), csrfCookieOptions());
  return token;
}

export function csrfProtection(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  // Non-browser clients authenticating with a Bearer token are not exposed to CSRF.
  if (!req.cookies?.[COOKIES.access] && !req.cookies?.[COOKIES.refresh] && req.get('authorization')) return next();
  const header = req.get('x-csrf-token');
  const cookie = req.cookies?.[COOKIES.csrf];
  if (!header || !cookie || !safeEqual(hmac(env.SESSION_SECRET, `csrf:${header}`), cookie)) {
    return next(AppError.forbidden('Your session security token is missing or expired. Refresh and try again.', 'CSRF_INVALID'));
  }
  return next();
}
