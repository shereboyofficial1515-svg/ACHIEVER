import { COOKIES } from '../config/constants.js';
import * as authService from '../services/authService.js';
import * as profileService from '../services/profileService.js';
import * as sessionService from '../services/sessionService.js';
import { issueCsrfToken } from '../middleware/csrf.js';
import { AppError } from '../utils/AppError.js';
import { clearSessionCookies, readSession, setSessionCookies } from '../utils/cookies.js';
import { asyncHandler, created, ok } from '../utils/http.js';

export const csrf = (req, res) => ok(res, { csrfToken: issueCsrfToken(res) });

export const register = asyncHandler(async (req, res) => {
  const { userId, session } = await authService.register(req.body, req);
  if (session) {
    const sessionId = await sessionService.start({ userId, authMethod: 'registration', req, res });
    setSessionCookies(res, session, Date.now(), sessionId);
  }
  return created(res, { userId, emailVerificationRequired: true }, 'Account created. Check your email for a verification code.');
});

export const login = asyncHandler(async (req, res) => {
  const { session, userId } = await authService.login(req.body, req);
  const sessionId = await sessionService.start({ userId, authMethod: 'password', req, res });
  setSessionCookies(res, session, Date.now(), sessionId);
  return ok(res, await profileService.me(userId), 'Signed in');
});

export const refresh = asyncHandler(async (req, res) => {
  const marker = readSession(req.cookies?.[COOKIES.session]);
  try {
    const session = await authService.refresh(req.cookies?.[COOKIES.refresh], marker?.startedAt, marker?.sessionId);
    setSessionCookies(res, session, marker.startedAt, marker.sessionId);
    return ok(res, { refreshed: true });
  } catch (err) {
    clearSessionCookies(res);
    throw err;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.cookies?.[COOKIES.access], req.user?.id, req, req.user?.sessionId);
  clearSessionCookies(res);
  return ok(res, {}, 'Signed out');
});

export const me = asyncHandler(async (req, res) => ok(res, await profileService.me(req.user.id)));

export const resendEmailCode = asyncHandler(async (req, res) => {
  const result = await authService.sendEmailVerification(req.user.id);
  return ok(res, result, 'Verification code sent');
});

export const verifyEmail = asyncHandler(async (req, res) => {
  await authService.verifyEmail(req.user.id, req.body.code, req);
  return ok(res, await profileService.me(req.user.id), 'Email verified');
});

export const sendPhoneCode = asyncHandler(async (req, res) => {
  const result = await authService.sendPhoneOtp(req.user.id);
  return ok(res, result, 'Verification code sent by SMS');
});

export const verifyPhone = asyncHandler(async (req, res) => {
  await authService.verifyPhone(req.user.id, req.body.code, req);
  return ok(res, await profileService.me(req.user.id), 'Phone number verified');
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email, req);
  return ok(res, {}, 'If an account exists for that email, a reset code has been sent.');
});

export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body, req);
  clearSessionCookies(res);
  return ok(res, {}, 'Password updated. Please sign in with your new password.');
});

export const changePassword = asyncHandler(async (req, res) => {
  const session = await authService.changePassword(req.user.id, req.body, req);
  if (!session) throw AppError.unavailable('Password changed. Please sign in again.');
  const sessionId = await sessionService.start({ userId: req.user.id, authMethod: 'password', req, res });
  setSessionCookies(res, session, Date.now(), sessionId);
  return ok(res, {}, 'Password changed. Other devices have been signed out.');
});

// Sessions & step-up -------------------------------------------------------------------
export const sessions = asyncHandler(async (req, res) => ok(res, await sessionService.list(req.user)));
export const revokeSession = asyncHandler(async (req, res) => {
  await sessionService.revoke(req.user, req.validated.params.id, req);
  return ok(res, {}, 'Session signed out');
});
export const revokeOtherSessions = asyncHandler(async (req, res) => ok(res, await sessionService.revokeOthers(req.user, req), 'Other sessions signed out'));
export const stepUp = asyncHandler(async (req, res) =>
  ok(res, await sessionService.stepUp(req.user, req.body.password, authService.verifyPassword, req), 'Identity confirmed'));
