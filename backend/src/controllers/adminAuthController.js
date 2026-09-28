import * as adminAuthService from '../services/adminAuthService.js';
import * as authService from '../services/authService.js';
import { issueAdminCsrf } from '../middleware/adminAuth.js';
import { asyncHandler, ok } from '../utils/http.js';

export const csrf = (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return ok(res, { csrfToken: issueAdminCsrf(res) });
};

export const login = asyncHandler(async (req, res) => ok(res, await adminAuthService.login(req.body, req, res)));

export const secondFactor = asyncHandler(async (req, res) =>
  ok(res, await adminAuthService.verifySecondFactor(req.body, req, res), 'Signed in to the admin platform'));

export const me = asyncHandler(async (req, res) => ok(res, {
  ...(await adminAuthService.describe(req.user.id)),
  session: { id: req.adminSession.id, expiresAt: req.adminSession.expires_at, idleMinutes: req.adminSession.idle_minutes },
}));

export const logout = asyncHandler(async (req, res) => {
  await adminAuthService.logout(req.user, req.adminSession, req, res);
  return ok(res, {}, 'Signed out');
});

export const logoutAll = asyncHandler(async (req, res) => ok(res, await adminAuthService.logoutAll(req.user, req.adminSession, req, res), 'All admin sessions signed out'));
export const sessions = asyncHandler(async (req, res) => ok(res, await adminAuthService.mySessions(req.user, req.adminSession)));
export const revokeSession = asyncHandler(async (req, res) => {
  await adminAuthService.revokeSession(req.user, req.validated.params.id, req);
  return ok(res, {}, 'Session signed out');
});

export const stepUp = asyncHandler(async (req, res) => ok(res, await adminAuthService.stepUp(req.user, req.adminSession, req.body, req), 'Confirmed'));
export const changePassword = asyncHandler(async (req, res) => ok(res, await adminAuthService.changePassword(req.user, req.adminSession, req.body, req), 'Password changed'));
export const mfa = asyncHandler(async (req, res) => ok(res, await adminAuthService.mfaStatus(req.user)));
export const backupCodes = asyncHandler(async (req, res) => ok(res, await adminAuthService.regenerateBackupCodes(req.user, req.adminSession, req.body, req), 'New backup codes created'));

// Password recovery by email code (same identity store as members); then sign in with the authenticator.
export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email, req);
  return ok(res, {}, 'If an account exists for that email, a reset code has been sent.');
});
export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body, req);
  await adminAuthService.afterPasswordReset(req.body.email, req);
  return ok(res, {}, 'Password reset. Sign in with your new password and authenticator code.');
});
