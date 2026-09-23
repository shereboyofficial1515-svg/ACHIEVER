import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';
import { startRealtimeBridge, stopRealtimeBridge } from './services/realtimeHub.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV, features: env.features }, 'ACHIEVER API listening');
  if (env.ENABLE_JOBS) startJobs();
  startRealtimeBridge();
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
process.on('unhandledRejection', (reason) => logger.error({ reason: String(reason) }, 'unhandled rejection'));
