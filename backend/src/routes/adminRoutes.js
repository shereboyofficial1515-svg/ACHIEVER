import { Router } from 'express';
import { idempotent } from '../middleware/idempotency.js';
import * as c from '../controllers/adminController.js';
import * as sc from '../controllers/securityController.js';
import * as rc from '../controllers/reportController.js';
import * as uc from '../controllers/userController.js';
import { ROLES } from '../config/constants.js';
import { requirePermission, requireRole } from '../middleware/authorize.js';
import { authenticateAdmin, requireAdminStepUp } from '../middleware/adminAuth.js';
import * as ac from '../controllers/adminAuthController.js';
import * as pc from '../controllers/adminPlatformController.js';
import * as f from '../controllers/featureController.js';
import * as oc from '../controllers/osusuController.js';
import * as cc from '../controllers/collectorController.js';
import * as a from '../validators/adminValidators.js';
import {
  adminExportLimiter, adminLoginLimiter, adminMfaLimiter, adminSearchLimiter, adminSensitiveLimiter,
  messageLimiter, passwordResetLimiter,
} from '../middleware/rateLimiters.js';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/common.js';
import { groupParam } from '../validators/osusuValidators.js';
import { planParam } from '../validators/collectorValidators.js';
import * as s from '../validators/miscValidators.js';

const p = requirePermission;
// Sensitive actions: permission + an authenticator code entered within the last few minutes.
const sensitive = (...perms) => [adminSensitiveLimiter, requirePermission(...perms), requireAdminStepUp];
const OVERSIGHT = ['support.tickets', 'disputes.manage', 'finance.ledger.read', 'risk.review'];
const APPROVAL_PERMS = ['finance.reversal.request', 'finance.reversal.approve', 'collectors.status', 'risk.review', 'finance.payouts.execute'];

// /api/admin/auth — Site Administration sign-in (separate from member sign-in)
export const adminAuthRoutes = Router()
  .get('/csrf', ac.csrf)
  .post('/login', adminLoginLimiter, validate({ body: a.login }), ac.login)
  .post('/mfa', adminMfaLimiter, validate({ body: a.secondFactor }), ac.secondFactor)
  .post('/password/forgot', passwordResetLimiter, validate({ body: a.forgotPassword }), ac.forgotPassword)
  .post('/password/reset', passwordResetLimiter, validate({ body: a.resetPassword }), ac.resetPassword)
  // Signing out always clears the cookie, even if the session already expired.
  .post('/logout', (req, res, next) => authenticateAdmin(req, res, () => next()), ac.logout)
  .get('/me', authenticateAdmin, ac.me)
  .get('/sessions', authenticateAdmin, ac.sessions)
  .delete('/sessions/:id', authenticateAdmin, validate({ params: idParam }), ac.revokeSession)
  .post('/logout-all', authenticateAdmin, ac.logoutAll)
  .post('/step-up', authenticateAdmin, adminMfaLimiter, validate({ body: a.codeOnly }), ac.stepUp)
  .post('/password', authenticateAdmin, adminMfaLimiter, validate({ body: a.changePassword }), ac.changePassword)
  .get('/mfa', authenticateAdmin, ac.mfa)
  .post('/mfa/backup-codes', authenticateAdmin, adminMfaLimiter, validate({ body: a.codeOnly }), ac.backupCodes);

// /api/admin — admin session required (mounted after authenticateAdmin); every
// route then checks a specific permission (least privilege).
const r = Router();

r.get('/dashboard', p('overview.read'), pc.dashboard);
r.get('/overview', p('overview.read'), c.overview);
r.get('/compliance/overview', p('security.events.read', 'kyc.review', 'risk.review', 'audit.read'), sc.complianceOverview);

// Users
r.get('/users', adminSearchLimiter, p('users.read'), validate({ query: s.listUsers }), c.listUsers);
r.get('/users/:id', p('users.read'), validate({ params: idParam }), c.getUser);
r.get('/users/:id/sensitive', p('users.read_sensitive'), validate({ params: idParam, query: s.accessReason }), sc.userSensitive);
r.get('/users/:id/security', p('security.events.read'), validate({ params: idParam }), sc.userSecurity);
r.post('/users/:id/sessions/revoke', ...sensitive('security.events.manage'), validate({ params: idParam, body: s.accessReason }), sc.revokeUserSessions);
r.patch('/users/:id/status', ...sensitive('users.manage_status'), validate({ params: idParam, body: s.userStatus }), pc.setUserStatus);
r.get('/users/:id/status-history', p('users.read'), validate({ params: idParam }), pc.userStatusHistory);
r.post('/users/:id/roles', ...sensitive('users.manage_status', 'roles.manage'), validate({ params: idParam, body: s.roleBody }), c.grantRole);
r.delete('/users/:id/roles/:role', ...sensitive('users.manage_status', 'roles.manage'), validate({ params: s.roleParam }), c.revokeRole);

// KYC & identity documents
r.get('/kyc', p('kyc.review'), validate({ query: s.kycList }), sc.kycList);
r.get('/kyc/:id/history', p('kyc.review'), validate({ params: idParam }), sc.kycHistory);
r.post('/kyc/:id/restriction', ...sensitive('kyc.review'), validate({ params: idParam, body: s.kycRestriction }), sc.kycRestrict);
r.get('/verification', p('kyc.review'), validate({ query: s.verificationList }), c.listVerifications);
r.get('/verification/:id/document', p('kyc.documents.view'), validate({ params: idParam, query: s.accessReason }), c.verificationDocument);
r.post('/verification/:id/decision', ...sensitive('kyc.review'), validate({ params: idParam, body: s.verificationDecision }), c.decideVerification);

// Groups & collectors
r.get('/osusu/groups', p('overview.read'), validate({ query: s.adminGroups }), c.listGroups);
// Read-only oversight of a group or savings plan (the member views, never member actions)
r.get('/osusu/groups/:groupId', p(...OVERSIGHT), validate({ params: groupParam }), oc.getGroup);
r.get('/osusu/groups/:groupId/members', p(...OVERSIGHT), validate({ params: groupParam }), oc.listMembers);
r.get('/osusu/groups/:groupId/cycles', p(...OVERSIGHT), validate({ params: groupParam }), oc.listCycles);
r.get('/osusu/groups/:groupId/payouts', p(...OVERSIGHT), validate({ params: groupParam }), oc.listPayouts);
r.get('/osusu/groups/:groupId/activity', p(...OVERSIGHT), validate({ params: groupParam }), oc.activity);
r.get('/collector/plans/:planId', p(...OVERSIGHT), validate({ params: planParam }), cc.getPlan);
r.get('/collectors', p('collectors.review', 'collectors.status', 'overview.read'), validate({ query: s.collectorList }), c.listCollectors);
r.get('/collectors/:id', p('collectors.review', 'collectors.status'), validate({ params: idParam }), sc.collectorDetail);
r.patch('/collectors/:id/status', ...sensitive('collectors.review', 'collectors.status'), validate({ params: idParam, body: s.collectorStatus }), c.setCollectorStatus);

// Finance
r.get('/transactions', p('finance.ledger.read'), validate({ query: s.adminTransactions }), c.listTransactions);
r.get('/payments', p('finance.ledger.read'), validate({ query: s.adminAttempts }), c.listPaymentAttempts);
r.get('/bills', p('finance.ledger.read', 'support.tickets'), validate({ query: s.listBills }), c.listBills);
r.get('/payouts', p('finance.payouts.execute'), c.payoutQueue);
r.post('/payouts/:kind/:id/confirm', ...sensitive('finance.payouts.execute'), idempotent, validate({ params: s.disbursementParam, body: s.confirmDisbursement }), c.confirmPayout);
r.post('/payouts/:kind/:id/fail', ...sensitive('finance.payouts.execute'), validate({ params: s.disbursementParam, body: s.failDisbursement }), c.failPayout);
r.post('/payouts/:kind/:id/retry', ...sensitive('finance.payouts.execute'), idempotent, validate({ params: s.disbursementParam }), c.retryPayout);

// Two-person approvals (reversal, adjustment, collector revocation, restriction lift, large payout)
r.get('/approvals', p(...APPROVAL_PERMS), validate({ query: s.approvalList }), sc.approvals);
r.get('/approvals/:id', p(...APPROVAL_PERMS), validate({ params: idParam }), sc.approval);
r.post('/approvals', ...sensitive(...APPROVAL_PERMS), validate({ body: s.approvalRequest }), sc.requestApproval);
r.post('/approvals/:id/decision', ...sensitive(...APPROVAL_PERMS), validate({ params: idParam, body: s.approvalDecision }), sc.decideApproval);
r.post('/approvals/:id/execute', ...sensitive(...APPROVAL_PERMS), idempotent, validate({ params: idParam }), sc.executeApproval);
r.post('/approvals/:id/cancel', p(...APPROVAL_PERMS), validate({ params: idParam }), sc.cancelApproval);

// Disputes / support cases
r.get('/support/tickets', p('support.tickets', 'disputes.manage'), validate({ query: s.listTickets }), c.listTickets);
r.get('/support/tickets/:id', p('support.tickets', 'disputes.manage'), validate({ params: idParam }), f.getTicket);
r.post('/support/tickets/:id/messages', messageLimiter, p('support.tickets', 'disputes.manage'), validate({ params: idParam, body: s.ticketMessage }), f.addTicketMessage);
r.get('/support/evidence/:id/url', p('disputes.evidence.view'), validate({ params: idParam, query: s.accessReason }), sc.evidenceUrl);
r.patch('/support/tickets/:id', p('support.tickets', 'disputes.manage'), validate({ params: idParam, body: s.updateTicket }), c.updateTicket);
r.post('/support/tickets/:id/assign', p('support.tickets', 'disputes.manage'), validate({ params: idParam, body: s.assignTicket }), c.assignTicket);
r.post('/support/tickets/:id/transactions', p('disputes.manage'), validate({ params: idParam, body: s.linkTransaction }), sc.linkCaseTransaction);
r.post('/support/tickets/:id/evidence', p('disputes.manage'), validate({ params: idParam, body: s.linkEvidence }), sc.linkCaseEvidence);

// Traceability
r.get('/trace/transactions/:id', p('trace.read'), validate({ params: idParam }), sc.traceTransaction);
r.get('/trace/cases/:id', p('trace.read', 'disputes.manage'), validate({ params: idParam }), sc.traceCase);

// Risk & security
r.get('/risk', p('risk.review', 'security.events.read'), validate({ query: s.riskList }), c.listRisk);
r.patch('/risk/:id', p('risk.review'), validate({ params: idParam, body: s.riskUpdate }), c.updateRisk);
r.get('/risk-profiles', p('risk.review'), validate({ query: s.riskProfileList }), sc.riskProfiles);
r.get('/risk-profiles/:id', p('risk.review'), validate({ params: idParam }), sc.riskProfile);
r.put('/risk-profiles/:id', ...sensitive('risk.review'), validate({ params: idParam, body: s.riskStatus.extend({ approvalRequestId: idParam.shape.id.optional() }) }), sc.setRiskStatus);
r.get('/security/events', p('security.events.read'), validate({ query: s.securityEventList }), sc.securityEvents);
r.patch('/security/events/:id', p('security.events.manage'), validate({ params: idParam, body: s.securityEventUpdate }), sc.updateSecurityEvent);

// Audit & access logs
r.get('/audit-logs', p('audit.read'), validate({ query: s.auditList }), c.auditLogs);
r.get('/security/admin-activity', p('security.events.read', 'audit.read'), validate({ query: a.activityList }), pc.adminActivity);
r.get('/admin-sessions', p('admins.read'), validate({ query: a.sessionList }), pc.adminSessions);
r.delete('/admin-sessions/:id', ...sensitive('admins.manage'), validate({ params: idParam }), pc.endAdminSession);

// Administrators (dedicated management; staff roles cannot be granted from the user screens)
r.get('/admins', p('admins.read'), validate({ query: a.adminList }), pc.listAdmins);
r.post('/admins', ...sensitive('admins.manage'), validate({ body: a.createAdmin }), pc.createAdmin);
r.put('/admins/:id/roles', ...sensitive('admins.manage'), validate({ params: idParam, body: a.adminRoles }), pc.updateAdminRoles);
r.post('/admins/:id/status', ...sensitive('admins.manage'), validate({ params: idParam, body: a.adminStatus }), pc.setAdminStatus);
r.post('/admins/:id/mfa-reset', ...sensitive('admins.manage'), validate({ params: idParam, body: a.reasonOnly }), pc.resetAdminMfa);
r.get('/data-access-logs', p('data_access.read'), validate({ query: s.dataAccessList }), sc.dataAccessLog);

// Privacy: account / personal-data deletion requests
r.get('/privacy/requests', p('privacy.requests.manage'), validate({ query: s.deletionList }), uc.adminDeletionRequests);
r.post('/privacy/requests/:id/decision', ...sensitive('privacy.requests.manage'), validate({ params: idParam, body: s.deletionDecision }), uc.adminDecideDeletion);

// Platform settings (typed; every change needs a reason and is kept in history)
r.get('/settings', p('settings.read'), pc.settings);
r.get('/settings/:key/history', p('settings.read'), validate({ params: a.settingKey }), pc.settingHistory);
r.put('/settings/:key', ...sensitive('settings.manage'), validate({ params: a.settingKey, body: a.settingUpdate }), pc.updateSetting);

// SMS verification switch and provider health
r.get('/sms', p('sms.read'), pc.smsStatus);
r.put('/sms', ...sensitive('sms.configure'), validate({ body: a.smsUpdate }), pc.updateSms);

// Reports & exports (each report checks the permission for its data; CSV needs reports.export)
r.get('/reports/types', p('reports.platform', 'reports.export', 'overview.read'), pc.reportTypes);
r.get('/reports/platform', adminExportLimiter, p('reports.platform', 'reports.export'), validate({ query: s.reportQuery }), pc.platformReport);
r.post('/notifications/broadcast', p('notifications.broadcast'), validate({ body: s.broadcast }), c.broadcast);

export default r;

// /api/reports
export const reportRoutes = Router()
  .get('/types', rc.types)
  .get('/osusu/:groupId', validate({ params: groupParam, query: s.reportQuery }), rc.osusu)
  .get('/collector', requireRole(ROLES.COLLECTOR), validate({ query: s.reportQuery }), rc.collector);
