import { Router } from 'express';
import * as c from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { requireStepUp } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { authLimiter, otpLimiter, passwordResetLimiter, refreshLimiter } from '../middleware/rateLimiters.js';
import * as s from '../validators/authValidators.js';
import { stepUp } from '../validators/miscValidators.js';
import { idParam } from '../validators/common.js';

const r = Router();

r.get('/csrf', c.csrf);
r.post('/register', authLimiter, validate({ body: s.register }), c.register);
r.post('/login', authLimiter, validate({ body: s.login }), c.login);
r.post('/refresh', refreshLimiter, c.refresh);
r.post('/logout', (req, res, next) => authenticate(req, res, () => next()), c.logout);
r.get('/me', authenticate, c.me);

r.post('/email/resend', authenticate, otpLimiter, c.resendEmailCode);
r.post('/email/verify', authenticate, otpLimiter, validate({ body: s.verifyCode }), c.verifyEmail);
r.post('/phone/send', authenticate, otpLimiter, c.sendPhoneCode);
r.post('/phone/verify', authenticate, otpLimiter, validate({ body: s.verifyCode }), c.verifyPhone);

r.post('/password/forgot', passwordResetLimiter, validate({ body: s.forgotPassword }), c.forgotPassword);
r.post('/password/reset', passwordResetLimiter, validate({ body: s.resetPassword }), c.resetPassword);
r.post('/password/change', authenticate, authLimiter, validate({ body: s.changePassword }), c.changePassword);
// Security code for sensitive changes (password verified, code emailed)
r.post('/challenges', authenticate, authLimiter, validate({ body: s.createChallenge }), c.createChallenge);

// Social sign-in (Supabase Auth OAuth). Start/callback are top-level browser navigations.
r.get('/providers', c.providers);
r.get('/oauth/callback', authLimiter, c.oauthCallback);
r.get('/oauth/:provider/start', authLimiter, validate({ params: s.oauthProvider }), c.oauthStart);
r.get('/oauth/pending', c.oauthPending);
r.post('/oauth/complete', authLimiter, validate({ body: s.completeProfile }), c.oauthComplete);
r.get('/identities', authenticate, c.identities);
r.post('/oauth/:provider/link', authenticate, requireStepUp, validate({ params: s.oauthProvider }), c.linkIdentity);
r.delete('/identities/:provider', authenticate, requireStepUp, validate({ params: s.oauthProvider }), c.unlinkIdentity);

// Sessions (own) and step-up re-authentication for sensitive actions
r.get('/sessions', authenticate, c.sessions);
r.delete('/sessions/:id', authenticate, validate({ params: idParam }), c.revokeSession);
r.post('/sessions/revoke-others', authenticate, c.revokeOtherSessions);
r.post('/step-up', authenticate, authLimiter, validate({ body: stepUp }), c.stepUp);

export default r;
