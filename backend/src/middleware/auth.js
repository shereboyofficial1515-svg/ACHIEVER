import { COOKIES } from '../config/constants.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/http.js';
import { readSession } from '../utils/cookies.js';
import * as authService from '../services/authService.js';
import * as sessionService from '../services/sessionService.js';

function bearer(req) {
  const h = req.get('authorization');
  return h && h.startsWith('Bearer ') ? h.slice(7) : null;
}

/**
 * Authenticate the caller from the HTTP-only access cookie (browser) or a
 * Bearer token (future native clients). Roles are always loaded from the
 * database — never trusted from the request.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const cookieToken = req.cookies?.[COOKIES.access];
  const token = cookieToken || bearer(req);
  if (!token) throw AppError.unauthorized();
  const marker = cookieToken ? readSession(req.cookies?.[COOKIES.session]) : undefined;
  if (cookieToken && marker === null) throw AppError.unauthorized('Your session has ended. Please sign in again.', 'SESSION_EXPIRED');
  const user = await authService.resolveUser(token, marker?.startedAt);
  // Server-side session: individually revocable and used for step-up checks.
  if (marker?.sessionId) {
    await sessionService.validate(marker.sessionId, user.id);
    user.sessionId = marker.sessionId;
  }
  req.user = user;
  next();
});

/** Most of the app requires a verified email address. */
export function requireVerifiedEmail(req, _res, next) {
  if (!req.user?.emailVerified) {
    return next(AppError.forbidden('Please verify your email address to continue', 'EMAIL_NOT_VERIFIED'));
  }
  return next();
}
