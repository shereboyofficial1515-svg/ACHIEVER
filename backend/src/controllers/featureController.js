import * as notificationService from '../services/notificationService.js';
import * as messageService from '../services/messageService.js';
import * as callService from '../services/callService.js';
import * as meetingService from '../services/meetingService.js';
import * as inviteService from '../services/inviteService.js';
import * as supportService from '../services/supportService.js';
import * as realtimeHub from '../services/realtimeHub.js';
import * as userRepo from '../repositories/userRepository.js';
import { asyncHandler, created, ok } from '../utils/http.js';

const v = (req) => req.validated;
const paged = (res, { items, meta }) => ok(res, items, 'OK', 200, meta);

// Bills ------------------------------------------------------------------------------

// Notifications -----------------------------------------------------------------------
export const listNotifications = asyncHandler(async (req, res) => {
  const q = v(req).query;
  const { rows, total } = await notificationService.list(req.user.id, q);
  return ok(res, rows, 'OK', 200, { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) });
});
export const unreadCount = asyncHandler(async (req, res) => ok(res, { count: await notificationService.unreadCount(req.user.id) }));
export const markRead = asyncHandler(async (req, res) => {
  await notificationService.markRead(req.user.id, v(req).params.id);
  return ok(res, {});
});
export const markAllRead = asyncHandler(async (req, res) => {
  await notificationService.markAllRead(req.user.id);
  return ok(res, {});
});
export const getPreferences = asyncHandler(async (req, res) => ok(res, await notificationService.getPreferences(req.user.id)));
export const updatePreferences = asyncHandler(async (req, res) => ok(res, await notificationService.updatePreferences(req.user.id, req.body), 'Preferences saved'));

// Messages ------------------------------------------------------------------------------
export const listConversations = asyncHandler(async (req, res) => ok(res, await messageService.listConversations(req.user.id)));
export const getConversation = asyncHandler(async (req, res) => ok(res, await messageService.getConversation(req.user.id, v(req).params.conversationId)));
export const listMessages = asyncHandler(async (req, res) => ok(res, await messageService.listMessages(req.user.id, v(req).params.conversationId, v(req).query)));
export const sendMessage = asyncHandler(async (req, res) =>
  created(res, await messageService.sendText(req.user.id, v(req).params.conversationId, req.body.body, { replyTo: req.body.replyTo || null, announcement: Boolean(req.body.announcement), sender: req.user }), 'Sent'));
export const sendAttachment = asyncHandler(async (req, res) => {
  const replyTo = /^[0-9a-f-]{36}$/i.test(req.body?.replyTo || '') ? req.body.replyTo : null;
  return created(res, await messageService.sendAttachment(req.user.id, v(req).params.conversationId, req.file, req.body?.caption, { replyTo, voice: req.body?.voice === 'true', sender: req.user }), 'Sent');
});
export const messagesAround = asyncHandler(async (req, res) => ok(res, await messageService.messagesAround(req.user.id, v(req).params.conversationId, v(req).params.messageId)));
export const editMessage = asyncHandler(async (req, res) => ok(res, await messageService.editMessage(req.user.id, v(req).params.messageId, req.body.body), 'Edited'));
export const deleteMessage = asyncHandler(async (req, res) => ok(res, await messageService.deleteMessage(req.user, v(req).params.messageId, req.body.scope, req), 'Deleted'));
export const reactMessage = asyncHandler(async (req, res) => ok(res, await messageService.react(req.user.id, v(req).params.messageId, req.body.emoji)));
export const pinMessage = asyncHandler(async (req, res) => ok(res, await messageService.setPinned(req.user, v(req).params.conversationId, v(req).params.messageId, req.body.pinned, req)));
export const typing = asyncHandler(async (req, res) => { await messageService.typing(req.user, v(req).params.conversationId); return ok(res, {}); });
export const delivered = asyncHandler(async (req, res) => { await messageService.markDelivered(req.user.id, v(req).params.conversationId); return ok(res, {}); });
export const searchMessages = asyncHandler(async (req, res) => ok(res, await messageService.search(req.user.id, v(req).params.conversationId, v(req).query.q)));
export const chatMedia = asyncHandler(async (req, res) => ok(res, await messageService.media(req.user.id, v(req).params.conversationId, v(req).query)));
export const muteChat = asyncHandler(async (req, res) => ok(res, await messageService.setMute(req.user.id, v(req).params.conversationId, req.body.until)));
export const clearChat = asyncHandler(async (req, res) => ok(res, await messageService.clearChat(req.user.id, v(req).params.conversationId), 'Chat cleared'));
export const reportChat = asyncHandler(async (req, res) => created(res, await messageService.report(req.user, v(req).params.conversationId, req.body, req), 'Report sent to ACHIEVER support'));
export const blockUser = asyncHandler(async (req, res) => ok(res, await messageService.setBlocked(req.user, v(req).params.userId, req.body.blocked, req)));
export const personProfile = asyncHandler(async (req, res) => ok(res, await messageService.personProfile(req.user, v(req).params.userId)));
export const groupChatSettings = asyncHandler(async (req, res) => ok(res, await messageService.updateGroupChat(req.user, v(req).params.conversationId, req.body, req), 'Group settings saved'));
export const memberPermissions = asyncHandler(async (req, res) =>
  ok(res, await messageService.setMemberPermissions(req.user, v(req).params.conversationId, v(req).params.memberId, req.body, req), 'Permissions saved'));
export const attachmentUrl = asyncHandler(async (req, res) => ok(res, { url: await messageService.attachmentUrl(req.user.id, v(req).params.id) }));
export const markConversationRead = asyncHandler(async (req, res) => {
  await messageService.markRead(req.user.id, v(req).params.conversationId);
  return ok(res, {});
});
export const openDirect = asyncHandler(async (req, res) => ok(res, await messageService.openDirect(req.user, req.body.userId)));
export const contacts = asyncHandler(async (req, res) => ok(res, await messageService.contacts(req.user.id)));

// Calls ------------------------------------------------------------------------------------
export const startCall = asyncHandler(async (req, res) => created(res, await callService.startCall(req.user, req.body, req), 'Calling'));
export const getCall = asyncHandler(async (req, res) => ok(res, await callService.getCall(req.user, v(req).params.callId)));
export const acceptCall = asyncHandler(async (req, res) => ok(res, await callService.acceptCall(req.user, v(req).params.callId, req)));
export const joinCall = asyncHandler(async (req, res) => ok(res, await callService.joinCall(req.user, v(req).params.callId, req)));
export const callToken = asyncHandler(async (req, res) => ok(res, await callService.token(req.user, v(req).params.callId)));
export const rejectCall = asyncHandler(async (req, res) => {
  await callService.rejectCall(req.user, v(req).params.callId);
  return ok(res, {});
});
export const leaveCall = asyncHandler(async (req, res) => {
  await callService.leaveCall(req.user, v(req).params.callId);
  return ok(res, {});
});
export const endCall = asyncHandler(async (req, res) => {
  await callService.endCall(req.user, v(req).params.callId, req);
  return ok(res, {});
});
export const callHistory = asyncHandler(async (req, res) => ok(res, await callService.history(req.user)));

// Meetings -------------------------------------------------------------------------------------
export const listMeetings = asyncHandler(async (req, res) => ok(res, await meetingService.list(req.user, v(req).query)));
export const createMeeting = asyncHandler(async (req, res) => created(res, await meetingService.create(req.user, req.body, req), 'Meeting scheduled'));
export const updateMeeting = asyncHandler(async (req, res) => ok(res, await meetingService.update(req.user, v(req).params.id, req.body, req), 'Meeting updated'));
export const cancelMeeting = asyncHandler(async (req, res) => {
  await meetingService.cancel(req.user, v(req).params.id, req);
  return ok(res, {}, 'Meeting cancelled');
});
export const startMeeting = asyncHandler(async (req, res) => ok(res, await meetingService.start(req.user, v(req).params.id, req.body, req), 'Meeting started'));
export const joinMeeting = asyncHandler(async (req, res) => ok(res, await meetingService.join(req.user, v(req).params.id, req)));

// Invites ------------------------------------------------------------------------------------------
export const previewInvite = asyncHandler(async (req, res) => ok(res, await inviteService.preview(v(req).params.token)));
export const acceptInvite = asyncHandler(async (req, res) => ok(res, await inviteService.accept(req.user, v(req).params.token, req, { termsAccepted: req.body?.acceptTerms === true }), 'Invitation accepted'));
export const declineInvite = asyncHandler(async (req, res) => {
  await inviteService.decline(req.user, v(req).params.token, req);
  return ok(res, {}, 'Invitation declined');
});
export const revokeInvite = asyncHandler(async (req, res) => {
  await inviteService.revoke(req.user, v(req).params.id, req);
  return ok(res, {}, 'Invitation revoked');
});

// Support ---------------------------------------------------------------------------------------------
export const createTicket = asyncHandler(async (req, res) => created(res, await supportService.create(req.user, req.body, req), 'Support case opened'));
export const myTickets = asyncHandler(async (req, res) => paged(res, await supportService.listMine(req.user, v(req).query)));
export const getTicket = asyncHandler(async (req, res) => ok(res, await supportService.get(req.user, v(req).params.id)));
export const addTicketMessage = asyncHandler(async (req, res) => created(res, await supportService.addMessage(req.user, v(req).params.id, req.body, req), 'Reply sent'));

// Realtime (Server-Sent Events) ------------------------------------------------------------------------
export function eventStream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ userId: req.user.id })}\n\n`);
  const remove = realtimeHub.addClient(req.user.id, res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  const presence = setInterval(() => userRepo.touchLastSeen(req.user.id).catch(() => {}), 60_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(presence);
    remove();
  });
}
