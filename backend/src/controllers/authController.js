import { COOKIES } from '../config/constants.js';
import * as authService from '../services/authService.js';
import * as profileService from '../services/profileService.js';
import { issueCsrfToken } from '../middleware/csrf.js';
import { AppError } from '../utils/AppError.js';
import { clearSessionCookies, readSessionStart, setSessionCookies } from '../utils/cookies.js';
import { asyncHandler, created, ok } from '../utils/http.js';

export const csrf = (req, res) => ok(res, { csrfToken: issueCsrfToken(res) });

export const register = asyncHandler(async (req, res) => {
  const { userId, session } = await authService.register(req.body, req);
  if (session) setSessionCookies(res, session);
  return created(res, { userId, emailVerificationRequired: true }, 'Account created. Check your email for a verification code.');
});

export const login = asyncHandler(async (req, res) => {
  const { session, userId } = await authService.login(req.body, req);
  setSessionCookies(res, session);
  return ok(res, await profileService.me(userId), 'Signed in');
});

export const refresh = asyncHandler(async (req, res) => {
  const startedAt = readSessionStart(req.cookies?.[COOKIES.session]);
  try {
    const session = await authService.refresh(req.cookies?.[COOKIES.refresh], startedAt);
    setSessionCookies(res, session, startedAt);
    return ok(res, { refreshed: true });
  } catch (err) {
    clearSessionCookies(res);
    throw err;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.cookies?.[COOKIES.access], req.user?.id, req);
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
  setSessionCookies(res, session);
  return ok(res, {}, 'Password changed. Other devices have been signed out.');
});
