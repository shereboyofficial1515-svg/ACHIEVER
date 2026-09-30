import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { requestContext } from './middleware/requestContext.js';
import { csrfProtection } from './middleware/csrf.js';
import * as userController from './controllers/userController.js';
import { apiLimiter, webhookLimiter } from './middleware/rateLimiters.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import * as paymentController from './controllers/paymentController.js';
import * as billPaymentController from './controllers/billPaymentController.js';
import { safeEqual } from './utils/crypto.js';
import api from './routes/index.js';
import adminRoutes, { adminAuthRoutes } from './routes/adminRoutes.js';
import { adminCsrf, authenticateAdmin } from './middleware/adminAuth.js';
import { adminApiLimiter } from './middleware/rateLimiters.js';
import { readiness } from './services/healthService.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Number of reverse proxies in front of the API (Vercel -> Cloudflare -> Render proxy = 4),
  // so req.ip is the visitor's address for rate limits and audit logs.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.url === '/api/health' || req.url.startsWith('/api/events') },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      // Cross-site deployments (frontend calling the API's own domain) need cross-origin reads.
      crossOriginResourcePolicy: { policy: env.crossSite ? 'cross-origin' : 'same-site' },
      hsts: env.isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin and server-to-server requests have no Origin header.
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'Authorization', 'Idempotency-Key'],
      // Readable by the web app when it calls the API on another origin (file names, error tracing).
      exposedHeaders: ['X-Request-Id', 'Content-Disposition', 'Retry-After', 'Idempotent-Replayed'],
      maxAge: 600,
    }),
  );
  app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/events') && compression.filter(req, res) }));

  // Liveness: the process is up. Identifies the service so a port clash with
  // another local API is obvious.
  app.get('/api/health', (_req, res) =>
    res.json({ success: true, message: 'ACHIEVER API is running', data: { service: 'achiever-api', status: 'up', time: new Date().toISOString() } }));
  // Readiness: can we actually serve requests (database privileges, integrations)?
  app.get('/api/health/ready', async (_req, res) => {
    const result = await readiness();
    res.status(result.ready ? 200 : 503).json({
      success: result.ready,
      message: result.ready ? 'ACHIEVER API is ready' : 'ACHIEVER API is not ready',
      data: result,
    });
  });

  // Shows the caller only their own address as the API sees it, plus the
  // forwarding headers of their own request, to set TRUST_PROXY_HOPS correctly
  // behind Vercel/Render/Cloudflare. Reveals nothing about other users.
  app.get('/api/health/client', (req, res) =>
    res.json({
      success: true,
      data: {
        ip: req.ip,
        trustProxyHops: env.TRUST_PROXY_HOPS,
        forwardedFor: req.get('x-forwarded-for') || null,
        realIp: req.get('x-real-ip') || null,
        cfConnectingIp: req.get('cf-connecting-ip') || null,
        trueClientIp: req.get('true-client-ip') || null,
        vercelForwardedFor: req.get('x-vercel-forwarded-for') || null,
      },
    }));

  // Webhooks need the exact raw bytes for signature verification, so they are
  // mounted BEFORE the JSON parser and are exempt from CSRF (they are
  // authenticated by HMAC / signed JWT instead).
  app.post('/api/paystack/webhook', webhookLimiter, express.raw({ type: 'application/json', limit: '256kb' }), paymentController.paystackWebhook);
  // VTpass callbacks are not signed: the URL carries a secret token and the body
  // is only used to decide which transaction to requery with our own credentials.
  app.post('/api/webhooks/vtpass/:token', webhookLimiter, express.json({ limit: '64kb' }), (req, res, next) => {
    if (!env.VTPASS_WEBHOOK_TOKEN || !safeEqual(req.params.token, env.VTPASS_WEBHOOK_TOKEN)) return res.status(404).json({ success: false });
    return billPaymentController.vtpassWebhook(req, res, next);
  });
  app.post('/api/calls/livekit/webhook', webhookLimiter, express.raw({ type: ['application/webhook+json', 'application/json'], limit: '256kb' }), paymentController.livekitWebhook);

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(cookieParser());

  // Email unsubscribe links (non-transactional categories only). Authenticated
  // by an HMAC in the link, so they work from an email client without a
  // session; POST supports RFC 8058 one-click unsubscribe.
  app.get('/api/notifications/unsubscribe', apiLimiter, userController.unsubscribe);
  app.post('/api/notifications/unsubscribe', apiLimiter, userController.unsubscribe);
  // Site Administration API: admin session cookie only (member sign-ins are ignored),
  // its own CSRF token and rate limits. Mounted before the member API.
  const admin = express.Router();
  // Admin data is never stored by browsers or intermediaries.
  admin.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  admin.use('/auth', adminAuthRoutes);
  admin.use(authenticateAdmin, adminApiLimiter, adminRoutes);
  app.use('/api/admin', adminCsrf, admin);

  app.use('/api', apiLimiter, csrfProtection, api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
