import { Router } from 'express';
import * as c from '../controllers/adminController.js';
import * as sc from '../controllers/securityController.js';
import * as rc from '../controllers/reportController.js';
import * as uc from '../controllers/userController.js';
import { ROLES } from '../config/constants.js';
import { requirePermission, requireRole, requireStaff, requireStepUp } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/common.js';
import { groupParam } from '../validators/osusuValidators.js';
import * as s from '../validators/miscValidators.js';

const p = requirePermission;
// Sensitive actions: permission + fresh step-up (password re-entry) on this session.
const sensitive = (...perms) => [requirePermission(...perms), requireStepUp];
const APPROVAL_PERMS = ['finance.reversal.request', 'finance.reversal.approve', 'collectors.status', 'risk.review', 'finance.payouts.execute'];

// /api/admin — any staff role gets in; each route then checks a specific permission (least privilege).
const r = Router();
r.use(requireStaff);

r.get('/overview', p('overview.read'), c.overview);
r.get('/compliance/overview', p('security.events.read', 'kyc.review', 'risk.review', 'audit.read'), sc.complianceOverview);

// Users
r.get('/users', p('users.read'), validate({ query: s.listUsers }), c.listUsers);
r.get('/users/:id', p('users.read'), validate({ params: idParam }), c.getUser);
r.get('/users/:id/sensitive', p('users.read_sensitive'), validate({ params: idParam, query: s.accessReason }), sc.userSensitive);
r.get('/users/:id/security', p('security.events.read'), validate({ params: idParam }), sc.userSecurity);
r.post('/users/:id/sessions/revoke', ...sensitive('security.events.manage'), validate({ params: idParam, body: s.accessReason }), sc.revokeUserSessions);
r.patch('/users/:id/status', ...sensitive('users.manage_status'), validate({ params: idParam, body: s.userStatus }), c.setUserStatus);
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
r.get('/collectors', p('collectors.review', 'collectors.status', 'overview.read'), validate({ query: s.collectorList }), c.listCollectors);
r.get('/collectors/:id', p('collectors.review', 'collectors.status'), validate({ params: idParam }), sc.collectorDetail);
r.patch('/collectors/:id/status', ...sensitive('collectors.review', 'collectors.status'), validate({ params: idParam, body: s.collectorStatus }), c.setCollectorStatus);

// Finance
r.get('/transactions', p('finance.ledger.read'), validate({ query: s.adminTransactions }), c.listTransactions);
r.get('/payments', p('finance.ledger.read'), validate({ query: s.adminAttempts }), c.listPaymentAttempts);
r.get('/bills', p('finance.ledger.read', 'support.tickets'), validate({ query: s.listBills }), c.listBills);
r.get('/payouts', p('finance.payouts.execute'), c.payoutQueue);
r.post('/payouts/:kind/:id/confirm', ...sensitive('finance.payouts.execute'), validate({ params: s.disbursementParam, body: s.confirmDisbursement }), c.confirmPayout);
r.post('/payouts/:kind/:id/fail', ...sensitive('finance.payouts.execute'), validate({ params: s.disbursementParam, body: s.failDisbursement }), c.failPayout);
r.post('/payouts/:kind/:id/retry', ...sensitive('finance.payouts.execute'), validate({ params: s.disbursementParam }), c.retryPayout);

// Two-person approvals (reversal, adjustment, collector revocation, restriction lift, large payout)
r.get('/approvals', p(...APPROVAL_PERMS), validate({ query: s.approvalList }), sc.approvals);
r.get('/approvals/:id', p(...APPROVAL_PERMS), validate({ params: idParam }), sc.approval);
r.post('/approvals', ...sensitive(...APPROVAL_PERMS), validate({ body: s.approvalRequest }), sc.requestApproval);
r.post('/approvals/:id/decision', ...sensitive(...APPROVAL_PERMS), validate({ params: idParam, body: s.approvalDecision }), sc.decideApproval);
r.post('/approvals/:id/execute', ...sensitive(...APPROVAL_PERMS), validate({ params: idParam }), sc.executeApproval);
r.post('/approvals/:id/cancel', p(...APPROVAL_PERMS), validate({ params: idParam }), sc.cancelApproval);

// Disputes / support cases
r.get('/support/tickets', p('support.tickets', 'disputes.manage'), validate({ query: s.listTickets }), c.listTickets);
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
r.get('/data-access-logs', p('data_access.read'), validate({ query: s.dataAccessList }), sc.dataAccessLog);

// Privacy: account / personal-data deletion requests
r.get('/privacy/requests', p('privacy.requests.manage'), validate({ query: s.deletionList }), uc.adminDeletionRequests);
r.post('/privacy/requests/:id/decision', ...sensitive('privacy.requests.manage'), validate({ params: idParam, body: s.deletionDecision }), uc.adminDecideDeletion);

// Platform
r.get('/settings', p('overview.read'), c.getSettings);
r.put('/settings/:key', ...sensitive('settings.manage'), validate({ params: s.settingParam, body: s.settingBody }), c.updateSetting);
r.post('/notifications/broadcast', p('notifications.broadcast'), validate({ body: s.broadcast }), c.broadcast);

export default r;

// /api/reports
export const reportRoutes = Router()
  .get('/types', rc.types)
  .get('/osusu/:groupId', validate({ params: groupParam, query: s.reportQuery }), rc.osusu)
  .get('/collector', requireRole(ROLES.COLLECTOR), validate({ query: s.reportQuery }), rc.collector)
  .get('/platform', requirePermission('reports.platform'), validate({ query: s.reportQuery }), rc.platform);
