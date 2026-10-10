import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';
import { COOKIES } from '../config/constants.js';

/**
 * In-memory stores are per process. For multi-instance deployments plug a
 * shared store (e.g. rate-limit-redis) into these limiters — see docs/SECURITY.md.
 */
const handler = (req, res) =>
  res.status(429).json({
    success: false,
    message: 'Too many requests. Please wait a moment and try again.',
    error: { code: 'RATE_LIMITED', requestId: req.id },
  });

const make = (windowMinutes, limit, keyByUser = false) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: env.isTest ? 10_000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler,
    keyGenerator: keyByUser ? (req) => req.user?.id || ipKeyGenerator(req.ip) : (req) => ipKeyGenerator(req.ip),
  });

/**
 * Backstop for credential endpoints, keyed on the address Cloudflare saw
 * (CF-Connecting-IP: set by Cloudflare in front of Render, so a client cannot
 * choose it; it is the Vercel edge for requests forwarded by the website).
 * req.ip comes from X-Forwarded-For, whose first entry the client controls, so
 * the per-IP limiters alone can be sidestepped by sending a different fake
 * address each time. This wider limit still caps such a client.
 */
export const edgeKey = (req) => ipKeyGenerator(String(req.get('cf-connecting-ip') || req.ip));
const backstop = (windowMinutes, limit) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: env.isTest ? 10_000 : limit,
    standardHeaders: false,
    legacyHeaders: false,
    handler,
    keyGenerator: edgeKey,
  });

export const apiLimiter = make(15, 600);
export const authLimiter = [make(15, 20), backstop(15, 200)];
// Refresh only counts when a refresh cookie is actually presented; anonymous
// page loads (no cookie) get a cheap 401 without consuming the budget.
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 10_000 : 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  skip: (req) => !req.cookies?.[COOKIES.refresh],
});
export const otpLimiter = [make(15, 8), backstop(15, 80)];
export const passwordResetLimiter = [make(60, 6), backstop(60, 60)];
export const paymentLimiter = make(15, 40, true);
export const uploadLimiter = make(15, 40, true);
export const messageLimiter = make(1, 60, true);
export const webhookLimiter = make(1, 300);

// Site Administration: stricter than member limits on sign-in, per-admin budgets elsewhere.
export const adminLoginLimiter = [make(15, 10), backstop(15, 60)];
export const adminMfaLimiter = [make(15, 10), backstop(15, 60)];
export const adminApiLimiter = make(1, 240, true);
export const adminSearchLimiter = make(1, 60, true);
export const adminExportLimiter = make(15, 20, true);
export const adminSensitiveLimiter = make(15, 60, true);
