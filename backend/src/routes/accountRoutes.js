import { Router } from 'express';
import * as c from '../controllers/userController.js';
import { uploadSingle } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { uploadLimiter } from '../middleware/rateLimiters.js';
import * as s from '../validators/miscValidators.js';

// /api/profiles
export const profileRoutes = Router()
  .get('/me', c.getProfile)
  .patch('/me', validate({ body: s.updateProfile }), c.updateProfile)
  .post('/me/avatar', uploadLimiter, ...uploadSingle('file', 'avatar'), c.uploadAvatar);

// /api/users
export const userRoutes = Router()
  .get('/me/dashboard', c.dashboard)
  .get('/me/payout-account', c.getPayoutAccount)
  .put('/me/payout-account', validate({ body: s.payoutAccount }), c.setPayoutAccount)
  .post('/me/roles', validate({ body: s.addRole }), c.addRole);

// /api/verification
export const verificationRoutes = Router()
  .get('/status', c.onboardingStatus)
  .post('/identity', validate({ body: s.identity }), c.submitIdentity)
  .post('/identity/document', uploadLimiter, ...uploadSingle('file', 'verificationDocument'), c.uploadIdentityDocument)
  .get('/undertaking', c.getUndertaking)
  .post('/undertaking', validate({ body: s.undertaking }), c.acceptUndertaking);
