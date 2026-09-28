import { COOKIES } from '../config/constants.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/http.js';
import { hmac, randomToken, safeEqual } from '../utils/crypto.js';
import * as adminAuthService from '../services/adminAuthService.js';

/**
 * Admin requests authenticate ONLY with the admin session cookie. Member
 * cookies and bearer tokens are ignored here, so an ordinary sign-in can never
 * reach /api/admin/* — whatever roles its account holds.
 */
export const authenticateAdmin = asyncHandler(async (req, _res, next) => {
  const { session, user } = await adminAuthService.authenticate(req.cookies?.[COOKIES.admin]);
  req.adminSession = session;
  req.user = user;
  next();
});

/** Sensitive admin actions need an authenticator code entered within the last few minutes. */
export const requireAdminStepUp = asyncHandler(async (req, _res, next) => {
  if (!(await adminAuthService.hasRecentStepUp(req.adminSession))) {
    throw AppError.forbidden('Enter a code from your authenticator app to continue with this sensitive action', 'STEP_UP_REQUIRED');
  }
  next();
});

// CSRF for the admin app: signed double-submit, separate cookie from the member app.
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_COOKIE = 'ach_adm_csrf';
const sign = (token) => hmac(env.adminSessionSecret, `admin-csrf:${token}`);

export function issueAdminCsrf(res) {
  const token = randomToken(24);
  res.cookie(CSRF_COOKIE, sign(token), adminAuthService.adminCsrfCookieOptions());
  return token;
}

export function adminCsrf(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  const header = req.get('x-csrf-token');
  const cookie = req.cookies?.[CSRF_COOKIE];
  if (!header || !cookie || !safeEqual(sign(header), cookie)) {
    return next(AppError.forbidden('Your security token is missing or expired. Refresh and try again.', 'CSRF_INVALID'));
  }
  return next();
}
