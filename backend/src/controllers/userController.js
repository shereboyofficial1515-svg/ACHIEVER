import * as profileService from '../services/profileService.js';
import * as onboardingService from '../services/onboardingService.js';
import * as dashboardService from '../services/dashboardService.js';
import * as paymentService from '../services/paymentService.js';
import { asyncHandler, ok } from '../utils/http.js';

// Profiles -----------------------------------------------------------------------
export const getProfile = asyncHandler(async (req, res) => ok(res, await profileService.me(req.user.id)));
export const updateProfile = asyncHandler(async (req, res) => ok(res, await profileService.update(req.user, req.body, req), 'Profile updated'));
export const uploadAvatar = asyncHandler(async (req, res) => ok(res, await profileService.uploadAvatar(req.user, req.file, req), 'Photo updated'));

// Users ----------------------------------------------------------------------------
export const dashboard = asyncHandler(async (req, res) => ok(res, await dashboardService.forUser(req.user)));
export const getPayoutAccount = asyncHandler(async (req, res) => ok(res, await profileService.getPayoutAccount(req.user)));
export const setPayoutAccount = asyncHandler(async (req, res) => {
  const result = await profileService.setPayoutAccount(req.user, req.body, req);
  return ok(res, result, result.otpRequired ? 'Enter the code we emailed you to confirm this change' : 'Payout account saved');
});
export const banks = asyncHandler(async (_req, res) => ok(res, await paymentService.listBanks()));
export const addRole = asyncHandler(async (req, res) => ok(res, await onboardingService.addSelfServiceRole(req.user, req.body.role, req), 'Role added'));

// Verification / onboarding -----------------------------------------------------------
export const onboardingStatus = asyncHandler(async (req, res) => ok(res, await onboardingService.getStatus(req.user.id)));
export const submitIdentity = asyncHandler(async (req, res) =>
  ok(res, await onboardingService.submitIdentity(req.user, req.body, req), 'Identity details submitted'));
export const uploadIdentityDocument = asyncHandler(async (req, res) =>
  ok(res, await onboardingService.uploadIdentityDocument(req.user, req.file, req), 'Document uploaded for review'));
export const getUndertaking = asyncHandler(async (_req, res) => {
  const { version, clauses } = await onboardingService.currentUndertaking();
  return ok(res, { version, clauses });
});
export const acceptUndertaking = asyncHandler(async (req, res) =>
  ok(res, await onboardingService.acceptUndertaking(req.user, req.body, req), 'Undertaking accepted'));
