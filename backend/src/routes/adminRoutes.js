import { Router } from 'express';
import * as c from '../controllers/adminController.js';
import * as rc from '../controllers/reportController.js';
import { ROLES } from '../config/constants.js';
import { requireRole } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/common.js';
import { groupParam } from '../validators/osusuValidators.js';
import * as s from '../validators/miscValidators.js';

const staff = requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SUPPORT_ADMIN);
const finance = requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN);
const superAdmin = requireRole(ROLES.SUPER_ADMIN);

// /api/admin — every route requires a staff role; finance actions need ADMIN+.
const r = Router();
r.use(staff);

r.get('/overview', c.overview);

r.get('/users', validate({ query: s.listUsers }), c.listUsers);
r.get('/users/:id', validate({ params: idParam }), c.getUser);
r.patch('/users/:id/status', finance, validate({ params: idParam, body: s.userStatus }), c.setUserStatus);
r.post('/users/:id/roles', finance, validate({ params: idParam, body: s.roleBody }), c.grantRole);
r.delete('/users/:id/roles/:role', finance, validate({ params: s.roleParam }), c.revokeRole);

r.get('/osusu/groups', validate({ query: s.adminGroups }), c.listGroups);
r.get('/collectors', validate({ query: s.adminGroups }), c.listCollectors);
r.patch('/collectors/:id/status', finance, validate({ params: idParam, body: s.collectorStatus }), c.setCollectorStatus);

r.get('/transactions', finance, validate({ query: s.adminTransactions }), c.listTransactions);
r.get('/payments', finance, validate({ query: s.adminAttempts }), c.listPaymentAttempts);
r.get('/bills', validate({ query: s.listBills }), c.listBills);

r.get('/payouts', finance, c.payoutQueue);
r.post('/payouts/:kind/:id/confirm', finance, validate({ params: s.disbursementParam, body: s.confirmDisbursement }), c.confirmPayout);
r.post('/payouts/:kind/:id/fail', finance, validate({ params: s.disbursementParam, body: s.failDisbursement }), c.failPayout);
r.post('/payouts/:kind/:id/retry', finance, validate({ params: s.disbursementParam }), c.retryPayout);

r.get('/verification', finance, validate({ query: s.verificationList }), c.listVerifications);
r.get('/verification/:id/document', finance, validate({ params: idParam }), c.verificationDocument);
r.post('/verification/:id/decision', finance, validate({ params: idParam, body: s.verificationDecision }), c.decideVerification);

r.get('/support/tickets', validate({ query: s.listTickets }), c.listTickets);
r.patch('/support/tickets/:id', validate({ params: idParam, body: s.updateTicket }), c.updateTicket);
r.post('/support/tickets/:id/assign', validate({ params: idParam, body: s.assignTicket }), c.assignTicket);

r.get('/risk', validate({ query: s.riskList }), c.listRisk);
r.patch('/risk/:id', finance, validate({ params: idParam, body: s.riskUpdate }), c.updateRisk);

r.get('/audit-logs', finance, validate({ query: s.auditList }), c.auditLogs);
r.get('/settings', c.getSettings);
r.put('/settings/:key', superAdmin, validate({ params: s.settingParam, body: s.settingBody }), c.updateSetting);
r.post('/notifications/broadcast', finance, validate({ body: s.broadcast }), c.broadcast);

export default r;

// /api/reports
export const reportRoutes = Router()
  .get('/types', rc.types)
  .get('/osusu/:groupId', validate({ params: groupParam, query: s.reportQuery }), rc.osusu)
  .get('/collector', requireRole(ROLES.COLLECTOR), validate({ query: s.reportQuery }), rc.collector)
  .get('/platform', finance, validate({ query: s.reportQuery }), rc.platform);
