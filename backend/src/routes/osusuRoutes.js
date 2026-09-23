import { Router } from 'express';
import * as c from '../controllers/osusuController.js';
import { ROLES } from '../config/constants.js';
import { requireActiveOperator } from '../middleware/authorize.js';
import { uploadSingle } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { paymentLimiter, uploadLimiter } from '../middleware/rateLimiters.js';
import * as s from '../validators/osusuValidators.js';

const r = Router();
const group = { params: s.groupParam };

// Groups
r.get('/groups', validate({ query: s.listGroups }), c.listGroups);
r.post('/groups', requireActiveOperator(ROLES.OSUSU_ADMIN), validate({ body: s.createGroup }), c.createGroup);
r.post('/groups/join', validate({ body: s.joinGroup }), c.joinGroup);
r.get('/groups/:groupId', validate(group), c.getGroup);
r.patch('/groups/:groupId', validate({ ...group, body: s.updateGroup }), c.updateGroup);
r.post('/groups/:groupId/image', uploadLimiter, validate(group), ...uploadSingle('file', 'groupImage'), c.uploadImage);
r.post('/groups/:groupId/start', validate(group), c.startGroup);
r.post('/groups/:groupId/cancel', validate(group), c.cancelGroup);
r.post('/groups/:groupId/leave', validate(group), c.leaveGroup);

// Members & invitations
r.get('/groups/:groupId/members', validate(group), c.listMembers);
r.put('/groups/:groupId/payout-order', validate({ ...group, body: s.payoutOrder }), c.setPayoutOrder);
r.post('/groups/:groupId/invites', validate({ ...group, body: s.invite }), c.createInvite);
r.get('/groups/:groupId/invites', validate(group), c.listInvites);
r.post('/members/:memberId/approve', validate({ params: s.memberParam }), c.approveMember);
r.post('/members/:memberId/remove', validate({ params: s.memberParam, body: s.removeMember }), c.removeMember);

// Cycles, contributions, payouts
r.get('/groups/:groupId/cycles', validate(group), c.listCycles);
r.get('/groups/:groupId/contributions', validate({ ...group, query: s.listContributions }), c.listGroupContributions);
r.get('/groups/:groupId/payouts', validate(group), c.listPayouts);
r.get('/groups/:groupId/activity', validate(group), c.activity);
r.get('/groups/:groupId/risk', validate(group), c.risk);
r.get('/cycles/:cycleId', validate({ params: s.cycleParam }), c.getCycle);
r.post('/cycles/:cycleId/payout/approve', validate({ params: s.cycleParam }), c.approvePayout);
r.get('/contributions/mine', validate({ query: s.listContributions }), c.myContributions);
r.post('/contributions/:contributionId/pay', paymentLimiter, validate({ params: s.contributionParam }), c.payContribution);

export default r;
