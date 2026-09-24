import * as profileService from '../services/profileService.js';
import * as securityService from '../services/securityService.js';
import * as sessionService from '../services/sessionService.js';
import * as kycService from '../services/kycService.js';
import * as riskService from '../services/riskService.js';
import * as sensitiveActionService from '../services/sensitiveActionService.js';
import * as traceService from '../services/traceService.js';
import * as adminService from '../services/adminService.js';
import * as supportService from '../services/supportService.js';
import * as onboardingService from '../services/onboardingService.js';
import * as collectorService from '../services/collectorService.js';
import * as complianceRepo from '../repositories/complianceRepository.js';
import * as settingsService from '../services/settingsService.js';
import * as oauthService from '../services/oauthService.js';
import { asyncHandler, created, ok } from '../utils/http.js';

const v = (req) => req.validated;
const paged = (res, { items, meta }) => ok(res, items, 'OK', 200, meta);

// Reference data (public) ---------------------------------------------------------------
export const states = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  return ok(res, await complianceRepo.listStates());
});
export const lgas = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  return ok(res, await complianceRepo.listLgas(v(req).params.code));
});

export const platformStatus = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  return ok(res, {
    maintenance: Boolean(await settingsService.get('platform.maintenance_mode', false)),
    signInProviders: await oauthService.enabledProviders(),
  });
});

// Account owner --------------------------------------------------------------------------
export const requestEmailChange = asyncHandler(async (req, res) => ok(res, await profileService.requestEmailChange(req.user, req.body, req), 'Code sent to your new email address'));
export const confirmEmailChange = asyncHandler(async (req, res) => ok(res, await profileService.confirmEmailChange(req.user, req.body, req), 'Email address changed'));
export const requestPhoneChange = asyncHandler(async (req, res) => ok(res, await profileService.requestPhoneChange(req.user, req.body, req), 'Code sent to your new phone number'));
export const confirmPhoneChange = asyncHandler(async (req, res) => ok(res, await profileService.confirmPhoneChange(req.user, req.body, req), 'Phone number changed'));
export const deactivate = asyncHandler(async (req, res) => {
  await profileService.deactivate(req.user, req.body, req);
  return ok(res, {}, 'Your account has been deactivated');
});
export const myActivity = asyncHandler(async (req, res) => ok(res, await securityService.myActivity(req.user)));
export const trustProfile = asyncHandler(async (req, res) => ok(res, await profileService.trustProfile(v(req).params.id)));
export const confirmPayoutAccount = asyncHandler(async (req, res) =>
  ok(res, await profileService.confirmPayoutAccountChange(req.user, req.body, req), 'Payout account changed'));
export const myKyc = asyncHandler(async (req, res) => ok(res, await kycService.summary(req.user.id, { refresh: true })));
export const startLiveness = asyncHandler(async () => onboardingService.startLiveness());
export const collectorTrust = asyncHandler(async (req, res) => ok(res, await collectorService.trust(req.user, v(req).params.id)));

// Disputes ------------------------------------------------------------------------------
export const uploadEvidence = asyncHandler(async (req, res) =>
  created(res, await supportService.uploadEvidence(req.user, v(req).params.id, req.file, evidenceFields(req.body), req), 'Evidence added'));
export const evidenceUrl = asyncHandler(async (req, res) =>
  ok(res, { url: await supportService.evidenceUrl(req.user, v(req).params.id, v(req).query?.reason, req) }));

function evidenceFields(body = {}) {
  const allowed = ['payment_receipt', 'message', 'document', 'screenshot'];
  return {
    evidenceType: allowed.includes(body.evidenceType) ? body.evidenceType : 'document',
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 1000) || null : null,
    supersedesId: /^[0-9a-f-]{36}$/i.test(body.supersedesId ?? '') ? body.supersedesId : undefined,
  };
}

// Staff: users ---------------------------------------------------------------------------
export const userSensitive = asyncHandler(async (req, res) => ok(res, await adminService.getUserSensitive(req.user, v(req).params.id, v(req).query.reason, req)));
export const userSecurity = asyncHandler(async (req, res) => ok(res, await adminService.userSecurity(req.user, v(req).params.id, req)));
export const revokeUserSessions = asyncHandler(async (req, res) =>
  ok(res, await sessionService.revokeByStaff(req.user, v(req).params.id, req.body.reason, req), 'All sessions signed out'));

// Staff: security & compliance ------------------------------------------------------------
export const complianceOverview = asyncHandler(async (_req, res) => ok(res, await adminService.complianceOverview()));
export const securityEvents = asyncHandler(async (req, res) => paged(res, await securityService.listEvents(v(req).query)));
export const updateSecurityEvent = asyncHandler(async (req, res) => ok(res, await securityService.updateEvent(req.user, v(req).params.id, req.body, req), 'Security event updated'));
export const dataAccessLog = asyncHandler(async (req, res) => paged(res, await securityService.listDataAccess(v(req).query)));

export const kycList = asyncHandler(async (req, res) => paged(res, await kycService.list(v(req).query)));
export const kycHistory = asyncHandler(async (req, res) => ok(res, await kycService.history(v(req).params.id)));
export const kycRestrict = asyncHandler(async (req, res) => ok(res, await kycService.setRestriction(req.user, v(req).params.id, req.body, req), 'Verification status updated'));

export const riskProfiles = asyncHandler(async (req, res) => paged(res, await riskService.list(v(req).query)));
export const riskProfile = asyncHandler(async (req, res) => ok(res, await riskService.profile(v(req).params.id)));
export const setRiskStatus = asyncHandler(async (req, res) =>
  ok(res, await riskService.setStatus(req.user, v(req).params.id, req.body, req, { consumeApproval: sensitiveActionService.consumeApproval }), 'Risk status updated'));

export const collectorDetail = asyncHandler(async (req, res) => ok(res, await adminService.collectorDetail(req.user, v(req).params.id)));

// Staff: two-person approvals --------------------------------------------------------------
export const approvals = asyncHandler(async (req, res) => paged(res, await sensitiveActionService.list(v(req).query)));
export const approval = asyncHandler(async (req, res) => ok(res, await sensitiveActionService.get(v(req).params.id)));
export const requestApproval = asyncHandler(async (req, res) => created(res, await sensitiveActionService.request(req.user, req.body, req), 'Request submitted for a second approval'));
export const decideApproval = asyncHandler(async (req, res) => ok(res, await sensitiveActionService.decide(req.user, v(req).params.id, req.body, req), 'Decision recorded'));
export const executeApproval = asyncHandler(async (req, res) => ok(res, await sensitiveActionService.execute(req.user, v(req).params.id, req), 'Action completed'));
export const cancelApproval = asyncHandler(async (req, res) => ok(res, await sensitiveActionService.cancel(req.user, v(req).params.id, req), 'Request cancelled'));

// Staff: traceability & disputes -------------------------------------------------------------
export const traceTransaction = asyncHandler(async (req, res) => ok(res, await traceService.transactionTrace(req.user, v(req).params.id, req)));
export const traceCase = asyncHandler(async (req, res) => ok(res, await traceService.caseTrace(req.user, v(req).params.id, req)));
export const linkCaseTransaction = asyncHandler(async (req, res) => {
  await supportService.linkTransaction(req.user, v(req).params.id, req.body, req);
  return ok(res, {}, 'Transaction linked to the case');
});
export const linkCaseEvidence = asyncHandler(async (req, res) => created(res, await supportService.linkRecordEvidence(req.user, v(req).params.id, req.body, req), 'Record attached as evidence'));
