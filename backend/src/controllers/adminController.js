import * as adminService from '../services/adminService.js';
import * as onboardingService from '../services/onboardingService.js';
import * as payoutService from '../services/payoutService.js';
import * as billService from '../services/billService.js';
import * as supportService from '../services/supportService.js';
import * as settingsService from '../services/settingsService.js';
import * as auditService from '../services/auditService.js';
import * as reportService from '../services/reportService.js';
import { asyncHandler, ok } from '../utils/http.js';
import { pageMeta } from '../utils/pagination.js';

const v = (req) => req.validated;
const paged = (res, { items, meta }) => ok(res, items, 'OK', 200, meta);

export const overview = asyncHandler(async (_req, res) => ok(res, await adminService.overview()));

export const listUsers = asyncHandler(async (req, res) => paged(res, await adminService.listUsers(req.user, v(req).query)));
export const getUser = asyncHandler(async (req, res) => ok(res, await adminService.getUser(req.user, v(req).params.id, req)));
export const setUserStatus = asyncHandler(async (req, res) => {
  await adminService.setUserStatus(req.user, v(req).params.id, req.body, req);
  return ok(res, {}, 'Status updated');
});
export const grantRole = asyncHandler(async (req, res) => {
  await adminService.grantRole(req.user, v(req).params.id, req.body.role, req);
  return ok(res, {}, 'Role granted');
});
export const revokeRole = asyncHandler(async (req, res) => {
  await adminService.revokeRole(req.user, v(req).params.id, v(req).params.role, req);
  return ok(res, {}, 'Role removed');
});

export const listGroups = asyncHandler(async (req, res) => paged(res, await adminService.listGroups(v(req).query)));
export const listCollectors = asyncHandler(async (req, res) => paged(res, await adminService.listCollectors(v(req).query)));
export const setCollectorStatus = asyncHandler(async (req, res) => {
  return ok(res, await adminService.setCollectorStatus(req.user, v(req).params.id, req.body.status, req.body.reason, req), 'Collector status updated');
});

export const listTransactions = asyncHandler(async (req, res) => paged(res, await adminService.listTransactions(v(req).query)));
export const listPaymentAttempts = asyncHandler(async (req, res) => paged(res, await adminService.listPaymentAttempts(v(req).query)));
export const listBills = asyncHandler(async (req, res) => paged(res, await billService.listAll(v(req).query)));

export const payoutQueue = asyncHandler(async (_req, res) => ok(res, await payoutService.queue()));
export const confirmPayout = asyncHandler(async (req, res) => {
  const { kind, id } = v(req).params;
  return ok(res, await payoutService.confirmManual(req.user, kind, id, req.body, req), 'Payout recorded as paid');
});
export const failPayout = asyncHandler(async (req, res) => {
  const { kind, id } = v(req).params;
  await payoutService.markFailed(req.user, kind, id, req.body.reason, req);
  return ok(res, {}, 'Payout marked as failed');
});
export const retryPayout = asyncHandler(async (req, res) => {
  const { kind, id } = v(req).params;
  return ok(res, await payoutService.retry(req.user, kind, id, req), 'Payout re-queued');
});

export const listVerifications = asyncHandler(async (req, res) => {
  const q = v(req).query;
  const { rows, total } = await onboardingService.listForReview(q);
  return ok(res, rows.map(({ document_path: doc, ...r }) => ({ ...r, documentUploaded: Boolean(doc) })), 'OK', 200, pageMeta(q, total));
});
export const verificationDocument = asyncHandler(async (req, res) => ok(res, { url: await onboardingService.documentUrl(req.user, v(req).params.id, v(req).query.reason, req) }));
export const decideVerification = asyncHandler(async (req, res) =>
  ok(res, await onboardingService.decide(req.user, v(req).params.id, req.body, req), 'Decision recorded'));

export const listTickets = asyncHandler(async (req, res) => paged(res, await supportService.listAll(v(req).query)));
export const updateTicket = asyncHandler(async (req, res) => ok(res, await supportService.updateTicket(req.user, v(req).params.id, req.body, req), 'Case updated'));
export const assignTicket = asyncHandler(async (req, res) => {
  await supportService.assign(req.user, v(req).params.id, req.body.assigneeId, req);
  return ok(res, {}, 'Case assigned');
});

export const listRisk = asyncHandler(async (req, res) => paged(res, await adminService.listRiskFlags(v(req).query)));
export const updateRisk = asyncHandler(async (req, res) => ok(res, await adminService.updateRiskFlag(req.user, v(req).params.id, req.body, req), 'Review updated'));

export const auditLogs = asyncHandler(async (req, res) => {
  const q = v(req).query;
  const { rows, total } = await auditService.list(q);
  return ok(res, rows, 'OK', 200, pageMeta(q, total));
});

export const getSettings = asyncHandler(async (_req, res) => ok(res, await settingsService.list()));
export const updateSetting = asyncHandler(async (req, res) => {
  const row = await settingsService.update(v(req).params.key, req.body.value, req.user.id);
  await auditService.record({ actorId: req.user.id, action: 'admin.setting.update', resourceType: 'app_setting', resourceId: v(req).params.key, metadata: { value: req.body.value }, req });
  return ok(res, row, 'Setting saved');
});

export const broadcast = asyncHandler(async (req, res) => ok(res, await adminService.broadcast(req.user, req.body, req), 'Notice sent'));

export const platformReport = asyncHandler(async (req, res) => sendReport(res, await reportService.platformReport(req.user, v(req).query, req)));

export function sendReport(res, report) {
  if (report.csv !== undefined) {
    const name = `${report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${report.generatedAt.slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return res.send(`﻿${report.csv}`);
  }
  return ok(res, report);
}
