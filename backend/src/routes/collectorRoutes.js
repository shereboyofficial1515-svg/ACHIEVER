import { Router } from 'express';
import * as c from '../controllers/collectorController.js';
import * as sc from '../controllers/securityController.js';
import { idParam } from '../validators/common.js';
import { ROLES } from '../config/constants.js';
import { requireActiveOperator, requireRole } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { paymentLimiter } from '../middleware/rateLimiters.js';
import { paging } from '../validators/common.js';
import * as s from '../validators/collectorValidators.js';

const r = Router();
const collector = requireRole(ROLES.COLLECTOR);
const plan = { params: s.planParam };

// Collector account (the collector's business profile)
r.get('/account', collector, c.getAccount);
r.post('/account', requireActiveOperator(ROLES.COLLECTOR), validate({ body: s.createAccount }), c.createAccount);
r.patch('/account', collector, validate({ body: s.updateAccount }), c.updateAccount);
r.get('/dashboard', collector, c.dashboard);
r.get('/accounts/:id/trust', validate({ params: idParam }), sc.collectorTrust);

// Savers (plans managed by this collector)
r.get('/savers', collector, validate({ query: s.listPlans }), c.listSavers);
r.post('/savers/invite', requireActiveOperator(ROLES.COLLECTOR), validate({ body: s.inviteSaver }), c.inviteSaver);
r.get('/invites', collector, c.listInvites);
r.get('/commissions', collector, c.commissions);

// Plans (saver or collector of the plan; enforced in the service)
r.get('/plans/mine', validate({ query: s.listPlans }), c.myPlans);
r.get('/plans/:planId', validate(plan), c.getPlan);
r.post('/plans/:planId/cancel', validate(plan), c.cancelPlan);
r.get('/plans/:planId/contributions', validate({ ...plan, query: paging }), c.listContributions);
r.post('/plans/:planId/returns', validate({ ...plan, body: s.requestReturn }), c.requestReturn);

// Contributions (flexible amounts) and returns
r.post('/contributions', paymentLimiter, validate({ body: s.contribute }), c.contribute);
r.get('/returns', validate({ query: s.listReturns }), c.listReturns);
r.post('/returns/:returnId/approve', validate({ params: s.returnParam }), c.approveReturn);
r.post('/returns/:returnId/reject', validate({ params: s.returnParam, body: s.rejectReturn }), c.rejectReturn);

export default r;
