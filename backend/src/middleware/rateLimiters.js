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

export const apiLimiter = make(15, 600);
export const authLimiter = make(15, 20);
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
export const otpLimiter = make(15, 8);
export const passwordResetLimiter = make(60, 6);
export const paymentLimiter = make(15, 40, true);
export const uploadLimiter = make(15, 40, true);
export const messageLimiter = make(1, 60, true);
export const webhookLimiter = make(1, 300);
