import * as osusuService from '../services/osusuService.js';
import * as inviteService from '../services/inviteService.js';
import { asyncHandler, created, ok } from '../utils/http.js';

const v = (req) => req.validated;

export const createGroup = asyncHandler(async (req, res) => created(res, await osusuService.createGroup(req.user, req.body, req), 'Group created'));
export const listGroups = asyncHandler(async (req, res) => {
  const { items, meta } = await osusuService.listGroups(req.user, v(req).query);
  return ok(res, items, 'OK', 200, meta);
});
export const getGroup = asyncHandler(async (req, res) => ok(res, await osusuService.getGroup(req.user, v(req).params.groupId)));
export const updateGroup = asyncHandler(async (req, res) => ok(res, await osusuService.updateGroup(req.user, v(req).params.groupId, req.body, req), 'Group updated'));
export const uploadImage = asyncHandler(async (req, res) => ok(res, await osusuService.uploadGroupImage(req.user, v(req).params.groupId, req.file, req), 'Image updated'));
export const startGroup = asyncHandler(async (req, res) => ok(res, await osusuService.startGroup(req.user, v(req).params.groupId, req), 'Group started'));
export const cancelGroup = asyncHandler(async (req, res) => {
  await osusuService.cancelGroup(req.user, v(req).params.groupId, req);
  return ok(res, {}, 'Group cancelled');
});
export const joinGroup = asyncHandler(async (req, res) => ok(res, await osusuService.joinByCode(req.user, req.body.joinCode, req), 'Request sent'));
export const leaveGroup = asyncHandler(async (req, res) => {
  await osusuService.leaveGroup(req.user, v(req).params.groupId, req);
  return ok(res, {}, 'You left the group');
});

export const listMembers = asyncHandler(async (req, res) => ok(res, await osusuService.listMembers(req.user, v(req).params.groupId)));
export const approveMember = asyncHandler(async (req, res) => {
  await osusuService.approveMember(req.user, v(req).params.memberId, req);
  return ok(res, {}, 'Member approved');
});
export const removeMember = asyncHandler(async (req, res) => {
  await osusuService.removeMember(req.user, v(req).params.memberId, req.body.reason, req);
  return ok(res, {}, 'Member removed');
});
export const setPayoutOrder = asyncHandler(async (req, res) =>
  ok(res, await osusuService.setPayoutOrder(req.user, v(req).params.groupId, req.body.memberIds, req), 'Payout order saved'));

export const createInvite = asyncHandler(async (req, res) => created(res, await inviteService.inviteToGroup(req.user, v(req).params.groupId, req.body, req), 'Invitation sent'));
export const listInvites = asyncHandler(async (req, res) => ok(res, await inviteService.listGroupInvites(req.user, v(req).params.groupId)));

export const listCycles = asyncHandler(async (req, res) => ok(res, await osusuService.listCycles(req.user, v(req).params.groupId)));
export const getCycle = asyncHandler(async (req, res) => ok(res, await osusuService.getCycle(req.user, v(req).params.cycleId)));

export const listGroupContributions = asyncHandler(async (req, res) => {
  const { items, meta } = await osusuService.listGroupContributions(req.user, v(req).params.groupId, v(req).query);
  return ok(res, items, 'OK', 200, meta);
});
export const myContributions = asyncHandler(async (req, res) => {
  const { items, meta } = await osusuService.myContributions(req.user, v(req).query);
  return ok(res, items, 'OK', 200, meta);
});
export const payContribution = asyncHandler(async (req, res) =>
  ok(res, await osusuService.payContribution(req.user, v(req).params.contributionId), 'Redirecting to secure payment'));

export const listPayouts = asyncHandler(async (req, res) => ok(res, await osusuService.listPayouts(req.user, v(req).params.groupId)));
export const approvePayout = asyncHandler(async (req, res) =>
  ok(res, await osusuService.approvePayout(req.user, v(req).params.cycleId, req), 'Payout approved'));

export const activity = asyncHandler(async (req, res) => ok(res, await osusuService.activity(req.user, v(req).params.groupId)));
export const risk = asyncHandler(async (req, res) => ok(res, await osusuService.risk(req.user, v(req).params.groupId)));
