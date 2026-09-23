import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';
import { startRealtimeBridge, stopRealtimeBridge } from './services/realtimeHub.js';
import { checkDatabase } from './services/healthService.js';

const app = createApp();
const server = app.listen(env.PORT, async () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV, features: env.features }, 'ACHIEVER API listening');
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
