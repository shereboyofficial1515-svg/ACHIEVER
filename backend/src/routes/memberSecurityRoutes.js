import { Router } from 'express';
import * as t from '../controllers/transactionSecurityController.js';
import { authLimiter, otpLimiter } from '../middleware/rateLimiters.js';
import { validate } from '../middleware/validate.js';
import * as s from '../validators/securityValidators.js';

// /api/security — transaction PIN, biometric device keys, verification states
export const memberSecurityRoutes = Router()
  .get('/transaction-pin', t.pinStatus)
  .put('/transaction-pin', otpLimiter, validate({ body: s.setTransactionPin }), t.setPin)
  .get('/biometric/devices', t.listKeys)
  .post('/biometric/enrol/start', authLimiter, validate({ body: s.enrolStart }), t.enrolStart)
  .post('/biometric/enrol/complete', authLimiter, validate({ body: s.enrolComplete }), t.enrolComplete)
  .post('/biometric/devices/:id/revoke', validate({ params: s.keyParam, body: s.revokeKey }), t.revokeKey)
  .get('/verification-states', t.verificationStates);

// /api/referrals — the member's own referral programme view
export const referralRoutes = Router()
  .get('/me', t.referralDashboard)
  .post('/me/refresh', authLimiter, t.referralRefresh);

// /api/push — Android device registration for push notifications
export const pushRoutes = Router()
  .post('/devices', validate({ body: s.pushRegister }), t.pushRegister)
  .post('/devices/unregister', validate({ body: s.pushUnregister }), t.pushUnregister);
