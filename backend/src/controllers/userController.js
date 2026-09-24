import * as profileService from '../services/profileService.js';
import * as onboardingService from '../services/onboardingService.js';
import * as dashboardService from '../services/dashboardService.js';
import * as paymentService from '../services/paymentService.js';
import * as notificationService from '../services/notificationService.js';
import * as preferencesService from '../services/preferencesService.js';
import * as privacyService from '../services/privacyService.js';
import { renderEmail } from '../emails/layouts/baseEmail.js';
import { asyncHandler, created, ok } from '../utils/http.js';

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

/** Signed unsubscribe link from a non-transactional email. Responds with a small branded page. */
export const unsubscribe = asyncHandler(async (req, res) => {
  const { u, c, t } = { ...req.query, ...(req.body || {}) };
  let ok2 = true;
  try {
    await notificationService.unsubscribe(String(u || ''), String(c || ''), String(t || ''));
  } catch {
    ok2 = false;
  }
  const page = renderEmail({
    subject: ok2 ? 'Unsubscribed' : 'Link not valid',
    title: ok2 ? 'You have been unsubscribed' : 'This link is not valid',
    paragraphs: [ok2
      ? 'You will no longer receive these emails. Security and transaction emails about your account are still sent. You can change this any time in Settings → Notifications.'
      : 'This unsubscribe link is invalid or incomplete. You can manage email preferences in Settings → Notifications.'],
    category: 'security',
  });
  res.status(ok2 ? 200 : 400).type('html').send(page.html);
});

// Settings: preferences -------------------------------------------------------------------
export const getPreferences = asyncHandler(async (req, res) => ok(res, await preferencesService.get(req.user.id)));
export const updatePreferences = asyncHandler(async (req, res) => ok(res, await preferencesService.update(req.user.id, req.body, req), 'Settings saved'));

// Privacy: deletion requests -----------------------------------------------------------------
export const privacyPolicy = (_req, res) => ok(res, privacyService.policy());
export const myDeletionRequests = asyncHandler(async (req, res) => ok(res, await privacyService.listMine(req.user)));
export const requestDeletion = asyncHandler(async (req, res) => created(res, await privacyService.request(req.user, req.body, req), 'Deletion request received'));
export const cancelDeletion = asyncHandler(async (req, res) => ok(res, await privacyService.cancel(req.user, req.validated.params.id, req), 'Request cancelled'));
export const adminDeletionRequests = asyncHandler(async (req, res) => {
  const { items, meta } = await privacyService.list(req.validated.query);
  return ok(res, items, 'OK', 200, meta);
});
export const adminDecideDeletion = asyncHandler(async (req, res) =>
  ok(res, await privacyService.decide(req.user, req.validated.params.id, req.body, req), 'Request updated'));
