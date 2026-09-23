import { Router } from 'express';
import * as c from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter, otpLimiter, passwordResetLimiter } from '../middleware/rateLimiters.js';
import * as s from '../validators/authValidators.js';

const r = Router();

r.get('/csrf', c.csrf);
r.post('/register', authLimiter, validate({ body: s.register }), c.register);
r.post('/login', authLimiter, validate({ body: s.login }), c.login);
r.post('/refresh', authLimiter, c.refresh);
r.post('/logout', (req, res, next) => authenticate(req, res, () => next()), c.logout);
r.get('/me', authenticate, c.me);

r.post('/email/resend', authenticate, otpLimiter, c.resendEmailCode);
r.post('/email/verify', authenticate, otpLimiter, validate({ body: s.verifyCode }), c.verifyEmail);
r.post('/phone/send', authenticate, otpLimiter, c.sendPhoneCode);
r.post('/phone/verify', authenticate, otpLimiter, validate({ body: s.verifyCode }), c.verifyPhone);

r.post('/password/forgot', passwordResetLimiter, validate({ body: s.forgotPassword }), c.forgotPassword);
r.post('/password/reset', passwordResetLimiter, validate({ body: s.resetPassword }), c.resetPassword);
r.post('/password/change', authenticate, authLimiter, validate({ body: s.changePassword }), c.changePassword);

export default r;
