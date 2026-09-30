import * as authService from '../services/authService.js';
import * as challengeService from '../services/challengeService.js';
import * as deviceKeyService from '../services/deviceKeyService.js';
import * as kycService from '../services/kycService.js';
import * as profileService from '../services/profileService.js';
import * as pushService from '../services/pushService.js';
import * as referralService from '../services/referralService.js';
import * as sessionService from '../services/sessionService.js';
import * as transactionAuth from '../services/transactionAuthService.js';
import { setSessionCookies } from '../utils/cookies.js';
import { asyncHandler, created, ok, paged } from '../utils/http.js';

const v = (req) => req.validated;

// Transaction PIN ------------------------------------------------------------------------------------
export const pinStatus = asyncHandler(async (req, res) => ok(res, await transactionAuth.pinStatus(req.user)));
export const setPin = asyncHandler(async (req, res) => {
  // Sign-in password + emailed code (challenge 'transaction_pin_change') are required first.
  await challengeService.use(req.user, { challengeId: req.body.challengeId, code: req.body.code, action: 'transaction_pin_change' }, req);
  return ok(res, await transactionAuth.setPin(req.user, req.body.pin, req), 'Transaction PIN saved');
});

// Biometric device keys ---------------------------------------------------------------------------------
export const listKeys = asyncHandler(async (req, res) => ok(res, await deviceKeyService.list(req.user)));
export const enrolStart = asyncHandler(async (req, res) =>
  ok(res, await deviceKeyService.startEnrolment(req.user, req.body.password, authService.verifyPassword, req)));
export const enrolComplete = asyncHandler(async (req, res) =>
  created(res, await deviceKeyService.completeEnrolment(req.user, req.body, req), 'Biometrics turned on'));
export const revokeKey = asyncHandler(async (req, res) =>
  ok(res, await deviceKeyService.revoke(req.user, v(req).params.id, req, req.body?.reason), 'Biometrics turned off'));

export const biometricChallenge = asyncHandler(async (req, res) => ok(res, await deviceKeyService.loginChallenge(req.body.keyId, req)));
export const biometricLogin = asyncHandler(async (req, res) => {
  const { session, userId } = await deviceKeyService.login(req.body, req);
  const sessionId = await sessionService.start({ userId, authMethod: 'device_biometric', req, res });
  setSessionCookies(res, session, Date.now(), sessionId);
  return ok(res, await profileService.me(userId), 'Signed in');
});

// Push devices ----------------------------------------------------------------------------------------
export const pushRegister = asyncHandler(async (req, res) => ok(res, await pushService.registerDevice(req.user, req.body)));
export const pushUnregister = asyncHandler(async (req, res) => ok(res, await pushService.unregisterDevice(req.user, req.body.token)));

// Verification states ---------------------------------------------------------------------------------
export const verificationStates = asyncHandler(async (req, res) => ok(res, await kycService.verificationStates(req.user.id)));

// Referrals (member) ------------------------------------------------------------------------------------
export const referralValidate = asyncHandler(async (req, res) => ok(res, await referralService.validateCode(v(req).query.code)));
export const referralTerms = asyncHandler(async (_req, res) => ok(res, await referralService.terms()));
export const referralDashboard = asyncHandler(async (req, res) => ok(res, await referralService.dashboard(req.user)));
export const referralRefresh = asyncHandler(async (req, res) => ok(res, await referralService.refresh(req.user)));

// Referrals (admin) -------------------------------------------------------------------------------------
export const adminReferrals = asyncHandler(async (req, res) => paged(res, await referralService.adminList(req.user, v(req).query)));
export const adminReferralEvents = asyncHandler(async (req, res) => ok(res, await referralService.adminReferralEvents(v(req).params.id)));
export const adminFlagDecision = asyncHandler(async (req, res) =>
  ok(res, await referralService.decideFlag(req.user, v(req).params.id, req.body), 'Decision recorded'));
export const adminRewards = asyncHandler(async (req, res) => paged(res, await referralService.adminRewards(v(req).query)));
export const adminReward = asyncHandler(async (req, res) => ok(res, await referralService.adminReward(v(req).params.id)));
export const adminRewardTransition = asyncHandler(async (req, res) =>
  ok(res, await referralService.transitionReward(req.user, v(req).params.id, req.body), 'Reward updated'));
