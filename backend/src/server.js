import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';
import { startRealtimeBridge, stopRealtimeBridge } from './services/realtimeHub.js';
import { checkDatabase } from './services/healthService.js';

const app = createApp();
const server = app.listen(env.PORT, async () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV, features: env.features, cookieSameSite: env.cookieSameSite }, 'ACHIEVER API listening');
  if (env.isProduction) {
    for (const [name, url] of [['CLIENT_URL', env.CLIENT_URL], ['SERVER_URL', env.SERVER_URL], ['API_PUBLIC_URL', env.apiPublicUrl]]) {
      if (!url.startsWith('https://') || /localhost|127\.0\.0\.1/.test(url)) logger.error(`${name} must be the public https:// address in production (links, cookies and CORS depend on it).`);
    }
    if (env.adminSecretsDerived) {
      logger.warn('ADMIN_SESSION_SECRET / ADMIN_MFA_ENCRYPTION_KEY are not set; admin keys are derived from SESSION_SECRET. Set dedicated values (docs/ADMIN_PLATFORM.md).');
    }
    if (env.crossSite) {
      logger.warn('The web app calls the API on a different site: cookies are SameSite=None. Safari and Firefox may block them; prefer forwarding /api through the frontend host (docs/DEPLOYMENT.md).');
    }
  }
  // Fail loudly at startup if the database cannot serve requests, instead of
  // letting the first user request discover it.
  const db = await checkDatabase();
  if (!db.ok) logger.error({ code: db.code }, `Database not ready: ${db.detail}`);
  if (env.ENABLE_JOBS) startJobs();
  startRealtimeBridge();
});

// A port clash (e.g. another local API already on this port) must be reported
// clearly; on Windows a second server can even bind the same port on another
// interface, silently splitting traffic between two applications.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.fatal(`Port ${env.PORT} is already in use by another process. Stop it or set PORT in backend/.env (and API_PROXY_TARGET for the Vite dev server).`);
  } else {
    logger.fatal({ err: { message: err.message, code: err.code } }, 'HTTP server error');
  }
  process.exit(1);
});

// SSE connections are long-lived; keep sockets alive past proxy idle timeouts.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  stopJobs();
  await stopRealtimeBridge().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason) }, 'unhandled rejection');
});
// An uncaught exception leaves the process in an unknown state: log it with
// its stack, close gracefully and let the process manager restart the API.
process.on('uncaughtException', (err) => {
  logger.fatal({ err: { message: err.message, stack: err.stack } }, 'uncaught exception — shutting down');
  shutdown('uncaughtException');
});
