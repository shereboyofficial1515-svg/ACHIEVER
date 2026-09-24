import os from 'node:os';
import crypto from 'node:crypto';
import cron from 'node-cron';
import { rpc } from '../integrations/supabase/db.js';
import * as paymentService from '../services/paymentService.js';
import * as refundService from '../services/refundService.js';
import * as payoutService from '../services/payoutService.js';
import * as billService from '../services/billService.js';
import * as notificationService from '../services/notificationService.js';
import * as inviteRepo from '../repositories/inviteRepository.js';
import { logger } from '../utils/logger.js';

const OWNER = `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;

/**
 * Each job takes a short DB lease so that only one API instance runs it at a
 * time, even when several instances are deployed.
 */
async function withLock(name, ttlSeconds, fn) {
  try {
    const acquired = await rpc('acquire_job_lock', { p_name: name, p_owner: OWNER, p_ttl_seconds: ttlSeconds });
    if (!acquired) return;
    const started = Date.now();
    const result = await fn();
    logger.debug({ job: name, result, ms: Date.now() - started }, 'job finished');
  } catch (err) {
    logger.error({ job: name, err: err.message }, 'job failed');
  }
}

export const JOBS = [
  // Osusu rotation and default tracking
  { name: 'osusu.open_cycles', schedule: '*/15 * * * *', ttl: 600, run: () => rpc('open_due_osusu_cycles') },
  { name: 'osusu.mark_overdue', schedule: '5 * * * *', ttl: 600, run: () => rpc('mark_overdue_contributions') },
  { name: 'osusu.reminders', schedule: '0 8 * * *', ttl: 900, run: () => rpc('enqueue_contribution_reminders') },
  // Collector maturity
  { name: 'collector.mature', schedule: '10 0 * * *', ttl: 900, run: () => rpc('mature_collector_plans') },
  // Meetings and calls
  { name: 'meetings.reminders', schedule: '*/10 * * * *', ttl: 300, run: () => rpc('enqueue_meeting_reminders') },
  { name: 'calls.missed', schedule: '* * * * *', ttl: 50, run: () => rpc('mark_missed_calls') },
  // Money movement safety nets
  { name: 'payments.reconcile', schedule: '*/5 * * * *', ttl: 280, run: () => paymentService.reconcilePending() },
  { name: 'payments.webhook_retry', schedule: '*/5 * * * *', ttl: 280, run: () => paymentService.retryFailedWebhooks() },
  { name: 'payments.refunds', schedule: '*/10 * * * *', ttl: 500, run: () => refundService.retryPendingRefunds() },
  { name: 'payouts.execute', schedule: '*/5 * * * *', ttl: 280, run: () => payoutService.executeReady() },
  { name: 'bills.pending', schedule: '*/2 * * * *', ttl: 110, run: () => billService.processPending() },
  // Delivery
  { name: 'notifications.dispatch', schedule: '* * * * *', ttl: 55, run: () => notificationService.dispatchPending(100) },
  { name: 'invites.expire', schedule: '30 1 * * *', ttl: 300, run: () => inviteRepo.expireOld() },
  // Compliance: expire identity documents, flag late collector settlements, expire stale approvals
  { name: 'compliance.checks', schedule: '20 2 * * *', ttl: 900, run: () => rpc('run_compliance_checks') },
];

const tasks = [];
export function startJobs() {
  for (const job of JOBS) {
    tasks.push(cron.schedule(job.schedule, () => withLock(job.name, job.ttl, job.run), { timezone: 'Africa/Lagos' }));
  }
  logger.info({ jobs: JOBS.length, owner: OWNER }, 'background jobs scheduled');
}

export function stopJobs() {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}
