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
import { apiLimiter, webhookLimiter } from './middleware/rateLimiters.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import * as paymentController from './controllers/paymentController.js';
import api from './routes/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind one reverse proxy/load balancer (Render, Railway, Nginx, etc.)
  app.set('trust proxy', 1);

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
      crossOriginResourcePolicy: { policy: 'same-site' },
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
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'Authorization'],
      maxAge: 600,
    }),
  );
  app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/events') && compression.filter(req, res) }));

  app.get('/api/health', (_req, res) => res.json({ success: true, message: 'ok', data: { status: 'up', time: new Date().toISOString() } }));

  // Webhooks need the exact raw bytes for signature verification, so they are
  // mounted BEFORE the JSON parser and are exempt from CSRF (they are
  // authenticated by HMAC / signed JWT instead).
  app.post('/api/paystack/webhook', webhookLimiter, express.raw({ type: 'application/json', limit: '256kb' }), paymentController.paystackWebhook);
  app.post('/api/calls/livekit/webhook', webhookLimiter, express.raw({ type: ['application/webhook+json', 'application/json'], limit: '256kb' }), paymentController.livekitWebhook);

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter, csrfProtection, api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
