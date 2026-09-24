import { Router } from 'express';
import * as c from '../controllers/userController.js';
import * as sc from '../controllers/securityController.js';
import { idParam } from '../validators/common.js';
import { uploadSingle } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { authLimiter, otpLimiter, uploadLimiter } from '../middleware/rateLimiters.js';
import * as s from '../validators/miscValidators.js';

// /api/profiles
export const profileRoutes = Router()
  .get('/me', c.getProfile)
  .patch('/me', validate({ body: s.updateProfile }), c.updateProfile)
  .post('/me/avatar', uploadLimiter, ...uploadSingle('file', 'avatar'), c.uploadAvatar)
  .get('/me/security', sc.myActivity)
  .post('/me/email/change', authLimiter, validate({ body: s.emailChange }), sc.requestEmailChange)
  .post('/me/email/confirm', otpLimiter, validate({ body: s.confirmCode }), sc.confirmEmailChange)
  .post('/me/phone/change', authLimiter, validate({ body: s.phoneChange }), sc.requestPhoneChange)
  .post('/me/phone/confirm', otpLimiter, validate({ body: s.confirmCode }), sc.confirmPhoneChange)
  .post('/me/deactivate', authLimiter, validate({ body: s.deactivate }), sc.deactivate);

// /api/users
export const userRoutes = Router()
  .get('/me/dashboard', c.dashboard)
  .get('/me/payout-account', c.getPayoutAccount)
  .put('/me/payout-account', otpLimiter, validate({ body: s.payoutAccount }), c.setPayoutAccount)
  .post('/me/payout-account/confirm', otpLimiter, validate({ body: s.payoutAccountConfirm }), sc.confirmPayoutAccount)
  .get('/:id/trust', validate({ params: idParam }), sc.trustProfile)
  .post('/me/roles', validate({ body: s.addRole }), c.addRole);

// /api/verification
export const verificationRoutes = Router()
  .get('/status', c.onboardingStatus)
  .get('/kyc', sc.myKyc)
  .post('/liveness', sc.startLiveness)
  .post('/identity', validate({ body: s.identity }), c.submitIdentity)
  .post('/identity/document', uploadLimiter, ...uploadSingle('file', 'verificationDocument'), c.uploadIdentityDocument)
  .get('/undertaking', c.getUndertaking)
  .post('/undertaking', validate({ body: s.undertaking }), c.acceptUndertaking);
