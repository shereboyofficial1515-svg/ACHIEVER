import { Router } from 'express';
import * as f from '../controllers/featureController.js';
import * as p from '../controllers/paymentController.js';
import * as sc from '../controllers/securityController.js';
import { uploadSingle } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { messageLimiter, paymentLimiter, uploadLimiter } from '../middleware/rateLimiters.js';
import { idParam } from '../validators/common.js';
import * as s from '../validators/miscValidators.js';

// /api/payments
export const paymentRoutes = Router()
  .get('/status/:reference', validate({ params: s.referenceParam }), p.status)
  .get('/transactions', validate({ query: s.listTransactions }), p.listTransactions)
  .get('/transactions/:id', validate({ params: idParam }), p.getTransaction)
  .get('/banks', p.banks);

// /api/bills
export const billRoutes = Router()
  .get('/catalog', f.billCatalog)
  .get('/variations', validate({ query: s.variationsQuery }), f.billVariations)
  .post('/verify-customer', validate({ body: s.verifyCustomer }), f.billVerifyCustomer)
  .post('/', paymentLimiter, validate({ body: s.createBill }), f.createBill)
  .get('/', validate({ query: s.listBills }), f.listBills)
  .get('/:id', validate({ params: idParam }), f.getBill)
  .post('/:id/requery', validate({ params: idParam }), f.requeryBill);

// /api/notifications
export const notificationRoutes = Router()
  .get('/', validate({ query: s.listNotifications }), f.listNotifications)
  .get('/unread-count', f.unreadCount)
  .post('/read-all', f.markAllRead)
  .get('/preferences', f.getPreferences)
  .put('/preferences', validate({ body: s.preferences }), f.updatePreferences)
  .post('/:id/read', validate({ params: idParam }), f.markRead);

// /api/messages
const conv = { params: s.conversationParam };
export const messageRoutes = Router()
  .get('/conversations', f.listConversations)
  .post('/conversations/direct', validate({ body: s.openDirect }), f.openDirect)
  .get('/contacts', f.contacts)
  .get('/conversations/:conversationId', validate(conv), f.getConversation)
  .get('/conversations/:conversationId/messages', validate({ ...conv, query: s.listMessages }), f.listMessages)
  .post('/conversations/:conversationId/messages', messageLimiter, validate({ ...conv, body: s.sendMessage }), f.sendMessage)
  .post('/conversations/:conversationId/attachments', uploadLimiter, validate(conv), ...uploadSingle('file', 'attachment'), f.sendAttachment)
  .post('/conversations/:conversationId/read', validate(conv), f.markConversationRead)
  .get('/attachments/:id/url', validate({ params: idParam }), f.attachmentUrl);

// /api/calls
const call = { params: s.callParam };
export const callRoutes = Router()
  .post('/', validate({ body: s.startCall }), f.startCall)
  .get('/history', f.callHistory)
  .get('/:callId', validate(call), f.getCall)
  .post('/:callId/accept', validate(call), f.acceptCall)
  .post('/:callId/join', validate(call), f.joinCall)
  .post('/:callId/token', validate(call), f.callToken)
  .post('/:callId/reject', validate(call), f.rejectCall)
  .post('/:callId/leave', validate(call), f.leaveCall)
  .post('/:callId/end', validate(call), f.endCall);

// /api/meetings
export const meetingRoutes = Router()
  .get('/', validate({ query: s.listMeetings }), f.listMeetings)
  .post('/', validate({ body: s.createMeeting }), f.createMeeting)
  .patch('/:id', validate({ params: idParam, body: s.updateMeeting }), f.updateMeeting)
  .post('/:id/cancel', validate({ params: idParam }), f.cancelMeeting)
  .post('/:id/start', validate({ params: idParam, body: s.startMeeting }), f.startMeeting)
  .post('/:id/join', validate({ params: idParam }), f.joinMeeting);

// /api/invites
export const inviteRoutes = Router()
  .delete('/manage/:id', validate({ params: idParam }), f.revokeInvite)
  .get('/:token', validate({ params: s.tokenParam }), f.previewInvite)
  .post('/:token/accept', validate({ params: s.tokenParam }), f.acceptInvite)
  .post('/:token/decline', validate({ params: s.tokenParam }), f.declineInvite);

// /api/support
export const supportRoutes = Router()
  .post('/tickets', validate({ body: s.createTicket }), f.createTicket)
  .get('/tickets', validate({ query: s.listTickets }), f.myTickets)
  .get('/tickets/:id', validate({ params: idParam }), f.getTicket)
  .post('/tickets/:id/messages', messageLimiter, validate({ params: idParam, body: s.ticketMessage }), f.addTicketMessage)
  .post('/tickets/:id/evidence', uploadLimiter, validate({ params: idParam }), ...uploadSingle('file', 'evidence'), sc.uploadEvidence)
  .get('/evidence/:id/url', validate({ params: idParam, query: s.accessReason.partial() }), sc.evidenceUrl);

// /api/events
export const eventRoutes = Router().get('/stream', f.eventStream);
