import * as adminAccountService from '../services/adminAccountService.js';
import * as adminAuthService from '../services/adminAuthService.js';
import * as adminService from '../services/adminService.js';
import * as settingsService from '../services/settingsService.js';
import * as smsService from '../services/smsService.js';
import * as reportService from '../services/reportService.js';
import * as adminRepo from '../repositories/adminRepository.js';
import { sendReport } from './adminController.js';
import { can } from '../services/permissionService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler, ok } from '../utils/http.js';
import { pageMeta } from '../utils/pagination.js';

const v = (req) => req.validated;

export const dashboard = asyncHandler(async (_req, res) => ok(res, await adminService.dashboard()));

// Administrators ---------------------------------------------------------------------------
export const listAdmins = asyncHandler(async (req, res) => {
  const { items, meta } = await adminAccountService.list(v(req).query);
  return ok(res, items, 'OK', 200, meta);
});
export const createAdmin = asyncHandler(async (req, res) => ok(res, await adminAccountService.create(req.user, req.body, req), 'Administrator access granted'));
export const updateAdminRoles = asyncHandler(async (req, res) => ok(res, await adminAccountService.updateRoles(req.user, v(req).params.id, req.body, req), 'Roles updated'));
export const setAdminStatus = asyncHandler(async (req, res) => ok(res, await adminAccountService.setStatus(req.user, v(req).params.id, req.body, req), 'Administrator updated'));
export const resetAdminMfa = asyncHandler(async (req, res) => ok(res, await adminAccountService.resetMfa(req.user, v(req).params.id, req.body, req), 'Authenticator reset'));

export const adminSessions = asyncHandler(async (req, res) => {
  const q = v(req).query;
  const { items, total } = await adminAuthService.listAllSessions(q);
  return ok(res, items, 'OK', 200, pageMeta(q, total));
});
export const endAdminSession = asyncHandler(async (req, res) => {
  await adminAuthService.revokeSession(req.user, v(req).params.id, req, { byStaff: true });
  return ok(res, {}, 'Session signed out');
});

// Admin security monitoring: sign-ins, failures, role/permission and configuration changes.
export const adminActivity = asyncHandler(async (req, res) => {
  const q = v(req).query;
  const { rows, total } = await adminRepo.adminAuditFeed(q);
  return ok(res, rows, 'OK', 200, pageMeta(q, total));
});

// Users -----------------------------------------------------------------------------------------
export const setUserStatus = asyncHandler(async (req, res) => ok(res, await adminService.setUserStatus(req.user, v(req).params.id, req.body, req), 'Account status updated'));
export const userStatusHistory = asyncHandler(async (req, res) => ok(res, await adminService.statusHistory(v(req).params.id)));

// Settings --------------------------------------------------------------------------------------
const SMS_KEYS = ['sms.verification_enabled', 'sms.notifications_enabled'];

export const settings = asyncHandler(async (_req, res) => {
  const rows = await settingsService.list();
  return ok(res, rows.map((r) => ({ ...r, warnings: settingsService.WARNINGS[r.key] ?? null })));
});
export const settingHistory = asyncHandler(async (req, res) => ok(res, await settingsService.history(v(req).params.key)));
export const updateSetting = asyncHandler(async (req, res) => {
  const { key } = v(req).params;
  if (SMS_KEYS.includes(key) && !can(req.user, 'sms.configure')) {
    throw AppError.forbidden('You do not have permission to change SMS settings', 'PERMISSION_DENIED');
  }
  const row = await settingsService.update(key, req.body.value, req.user, { reason: req.body.reason, req });
  return ok(res, row, 'Setting saved');
});

// SMS ----------------------------------------------------------------------------------------------
export const smsStatus = asyncHandler(async (_req, res) => ok(res, await smsService.status()));
export const updateSms = asyncHandler(async (req, res) => {
  const { verificationEnabled, notificationsEnabled, reason } = req.body;
  const changes = [];
  if (typeof verificationEnabled === 'boolean') changes.push(['sms.verification_enabled', verificationEnabled]);
  if (typeof notificationsEnabled === 'boolean') changes.push(['sms.notifications_enabled', notificationsEnabled]);
  if (!changes.length) throw AppError.badRequest('Nothing to change', 'NO_CHANGES');
  for (const [key, value] of changes) {
    // Sequential on purpose: each change gets its own history row and audit record.
    // eslint-disable-next-line no-await-in-loop
    await settingsService.update(key, value, req.user, { reason, req }).catch((err) => {
      if (err.code !== 'SETTING_UNCHANGED') throw err;
    });
  }
  return ok(res, await smsService.status(), 'SMS settings saved');
});

// Reports & exports ------------------------------------------------------------------------------------
// Each report needs the permission for the data it contains, plus reports.export to download.
const REPORT_PERMISSIONS = {
  transactions: ['finance.ledger.read'],
  bills: ['finance.ledger.read'],
  'failed-payments': ['finance.ledger.read'],
  revenue: ['finance.ledger.read'],
  'user-growth': ['overview.read'],
  kyc: ['kyc.review'],
  'security-events': ['security.events.read'],
};
export const reportTypes = (req, res) => ok(res, Object.entries(REPORT_PERMISSIONS)
  .filter(([, perms]) => perms.some((p) => can(req.user, p)))
  .map(([type]) => type));
export const platformReport = asyncHandler(async (req, res) => {
  const q = v(req).query;
  const needed = REPORT_PERMISSIONS[q.type];
  if (!needed || !needed.some((p) => can(req.user, p))) throw AppError.forbidden('You do not have permission to export this report', 'PERMISSION_DENIED');
  if (q.format === 'csv' && !can(req.user, 'reports.export')) throw AppError.forbidden('You do not have permission to export records', 'PERMISSION_DENIED');
  return sendReport(res, await reportService.platformReport(req.user, q, req));
});
