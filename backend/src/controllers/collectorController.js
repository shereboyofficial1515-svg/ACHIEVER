import * as collectorService from '../services/collectorService.js';
import * as inviteService from '../services/inviteService.js';
import { asyncHandler, created, ok } from '../utils/http.js';

const v = (req) => req.validated;
const paged = (res, { items, meta }) => ok(res, items, 'OK', 200, meta);

export const getAccount = asyncHandler(async (req, res) => ok(res, await collectorService.getMyAccount(req.user)));
export const createAccount = asyncHandler(async (req, res) => created(res, await collectorService.createAccount(req.user, req.body, req), 'Collector account created'));
export const updateAccount = asyncHandler(async (req, res) => ok(res, await collectorService.updateAccount(req.user, req.body, req), 'Account updated'));
export const dashboard = asyncHandler(async (req, res) => ok(res, await collectorService.dashboard(req.user)));

export const listSavers = asyncHandler(async (req, res) => paged(res, await collectorService.listSavers(req.user, v(req).query)));
export const inviteSaver = asyncHandler(async (req, res) => created(res, await inviteService.inviteSaver(req.user, req.body, req), 'Invitation sent'));
export const listInvites = asyncHandler(async (req, res) => ok(res, await inviteService.listCollectorInvites(req.user)));
export const myPlans = asyncHandler(async (req, res) => paged(res, await collectorService.listMyPlans(req.user, v(req).query)));
export const getPlan = asyncHandler(async (req, res) => ok(res, await collectorService.getPlan(req.user, v(req).params.planId)));
export const cancelPlan = asyncHandler(async (req, res) => {
  await collectorService.cancelPlan(req.user, v(req).params.planId, req);
  return ok(res, {}, 'Plan cancelled');
});

export const listContributions = asyncHandler(async (req, res) =>
  paged(res, await collectorService.listPlanContributions(req.user, v(req).params.planId, v(req).query)));
export const contribute = asyncHandler(async (req, res) => ok(res, await collectorService.contribute(req.user, req.body), 'Redirecting to secure payment'));

export const requestReturn = asyncHandler(async (req, res) =>
  created(res, await collectorService.requestReturn(req.user, v(req).params.planId, req.body.reason, req), 'Return requested'));
export const listReturns = asyncHandler(async (req, res) => paged(res, await collectorService.listReturns(req.user, v(req).query)));
export const approveReturn = asyncHandler(async (req, res) => ok(res, await collectorService.approveReturn(req.user, v(req).params.returnId, req), 'Return approved'));
export const rejectReturn = asyncHandler(async (req, res) => {
  await collectorService.rejectReturn(req.user, v(req).params.returnId, req.body.reason, req);
  return ok(res, {}, 'Return request closed');
});
export const commissions = asyncHandler(async (req, res) => ok(res, await collectorService.listCommissions(req.user)));
