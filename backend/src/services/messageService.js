import { BUCKETS } from '../config/constants.js';
import { canAny } from './permissionService.js';
import * as preferencesService from './preferencesService.js';
import * as messageRepo from '../repositories/messageRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as storageService from './storageService.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { cleanText, safeFileName } from '../utils/sanitize.js';
import { likePattern } from '../utils/pagination.js';

/**
 * Messaging. Every rule is checked here (and again by post_message in the
 * database): membership, group send / announcement / pin / picture
 * permissions, blocking, edit and delete windows. Privacy settings decide
 * what others see (online status, last seen, read receipts).
 */
const ONLINE_WINDOW_MS = 2 * 60 * 1000;   // presence heartbeat is every 60 s while the app is open
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const DELETE_FOR_EVERYONE_MS = 60 * 60 * 1000;

export const DEFAULT_CHAT_SETTINGS = Object.freeze({
  send: 'all', announce: 'admins', pin: 'admins', change_picture: 'admins', edit_info: 'admins',
  add_members: 'admins', invite: 'admins', remove_members: 'admins', member_list: 'all', show_online: 'all',
});
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function isOnline(lastSeen) {
  return Boolean(lastSeen) && Date.now() - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS;
}

let hubPromise;
const hub = () => (hubPromise ??= import('./realtimeHub.js'));
async function broadcast(conversationId, event, payload) {
  try {
    (await hub()).publishToConversation(conversationId, event, payload);
  } catch { /* realtime is best effort; clients also refetch */ }
}

export async function assertMember(userId, conversationId) {
  const membership = await messageRepo.findMembership(conversationId, userId);
  if (!membership || membership.left_at) throw AppError.forbidden('You are not a member of this conversation', 'NOT_A_MEMBER');
  return membership;
}

/** What this member may do in this conversation (computed from their real role and the group's settings). */
export function chatPermissions(conv, me) {
  const s = { ...DEFAULT_CHAT_SETTINGS, ...(conv.settings || {}) };
  const group = conv.type === 'group';
  const admin = group && me.role === 'admin';
  return {
    isAdmin: admin,
    canSend: !group || s.send === 'all' || admin,
    canAnnounce: admin,
    canPin: group ? admin || (s.pin === 'selected' && me.can_pin) : true,
    canChangePicture: group && (admin || (s.change_picture === 'selected' && me.can_change_picture)),
    canEditInfo: admin,
    canManageSettings: admin,
    canInvite: group && (admin || s.invite === 'all'),
    canRemoveMembers: admin,
    canSeeMembers: !group || s.member_list === 'all' || admin,
    canSeeOnline: !group || s.show_online === 'all' || admin,
  };
}

// Conversation lifecycle (used by Osusu and Collector services) -------------------
export async function ensureGroupConversation(groupId, title, adminId) {
  let conv = await messageRepo.findByGroup(groupId);
  if (!conv) {
    conv = await messageRepo.insertConversation({ type: 'group', osusu_group_id: groupId, title, created_by: adminId });
  }
  await messageRepo.upsertMember(conv.id, adminId, 'admin');
  return conv;
}

export async function ensurePlanConversation(planId, collectorId, saverId, title) {
  let conv = await messageRepo.findByPlan(planId);
  if (!conv) {
    conv = await messageRepo.insertConversation({ type: 'collector', collector_saver_id: planId, title, created_by: collectorId });
  }
  await messageRepo.upsertMember(conv.id, collectorId, 'admin');
  await messageRepo.upsertMember(conv.id, saverId, 'member');
  return conv;
}

export async function addToGroupConversation(groupId, userId) {
  const conv = await messageRepo.findByGroup(groupId);
  if (conv) await messageRepo.upsertMember(conv.id, userId, 'member');
}

export async function removeFromGroupConversation(groupId, userId) {
  const conv = await messageRepo.findByGroup(groupId);
  if (conv) await messageRepo.removeMember(conv.id, userId);
}

export async function postSystemMessage(conversationId, body, metadata = {}, kind = 'system') {
  return messageRepo.postMessage({ conversationId, senderId: null, kind, body, metadata });
}

/** Group picture: the group admin, or members the admin selected when the group allows it. */
export async function canChangeGroupPicture(userId, groupId) {
  const conv = await messageRepo.findByGroup(groupId);
  if (!conv) return false;
  const me = await messageRepo.findMembership(conv.id, userId);
  return Boolean(me && !me.left_at && chatPermissions(conv, me).canChangePicture);
}

/** Group invitations: admins, or every member when the admin allows it. */
export async function canInviteToGroup(userId, groupId) {
  const conv = await messageRepo.findByGroup(groupId);
  if (!conv) return false;
  const me = await messageRepo.findMembership(conv.id, userId);
  return Boolean(me && !me.left_at && chatPermissions(conv, me).canInvite);
}

// Conversation list ---------------------------------------------------------------------
export async function listConversations(userId) {
  const rows = await messageRepo.summaries(userId);
  const flags = await preferencesService.flagsFor(rows.map((r) => r.other_user_id).filter(Boolean));
  return rows.map((r) => {
    let lastMessage = r.last_message_body;
    if (r.last_message_deleted) lastMessage = 'This message was deleted';
    else if (r.last_message_kind === 'attachment') lastMessage = r.last_message_body || 'Attachment';
    return {
      id: r.conversation_id,
      type: r.type,
      title: r.title,
      groupId: r.osusu_group_id,
      planId: r.collector_saver_id,
      imageUrl: storageService.publicUrl(BUCKETS.groupImages, r.group_image),
      lastMessageAt: r.last_message_at,
      lastMessage,
      lastMessageKind: r.last_message_kind,
      lastSenderId: r.last_sender_id,
      unreadCount: Number(r.unread_count),
      memberCount: Number(r.member_count),
      mutedUntil: r.muted_until && new Date(r.muted_until) > new Date() ? r.muted_until : null,
      otherUser: r.other_user_id
        ? {
            id: r.other_user_id,
            name: r.other_user_name,
            avatarUrl: storageService.publicUrl(BUCKETS.avatars, r.other_user_avatar),
            online: flags(r.other_user_id).showOnlineStatus ? isOnline(r.other_user_last_seen) : false,
          }
        : null,
    };
  });
}

// One conversation ----------------------------------------------------------------------
export async function getConversation(userId, conversationId) {
  const me = await assertMember(userId, conversationId);
  const [conversation, members, pins] = await Promise.all([
    messageRepo.findConversation(conversationId),
    messageRepo.listMembers(conversationId),
    messageRepo.listPins(conversationId),
  ]);
  const perms = chatPermissions(conversation, me);
  // Read receipts are reciprocal: if you hide yours you don't see others' either.
  const flags = await preferencesService.flagsFor(members.map((m) => m.user_id));
  const viewerShares = flags(userId).readReceipts;
  const group = conversation.type === 'group';
  const visibleMembers = perms.canSeeMembers ? members : members.filter((m) => m.user_id === userId || m.role === 'admin');

  const formatted = visibleMembers.map((m) => {
    const f = flags(m.user_id);
    const self = m.user_id === userId;
    const showPresence = self || (f.showOnlineStatus && perms.canSeeOnline);
    const receipts = self || (viewerShares && f.readReceipts);
    return {
      id: m.user_id,
      name: m.profile?.full_name,
      role: m.role,
      avatarUrl: storageService.publicUrl(BUCKETS.avatars, m.profile?.avatar_path),
      online: showPresence ? isOnline(m.profile?.last_seen_at) : false,
      lastSeenAt: showPresence && !group ? m.profile?.last_seen_at ?? null : null,
      lastReadAt: receipts ? m.last_read_at : null,
      lastDeliveredAt: receipts ? m.last_delivered_at : null,
      sharesReceipts: Boolean(receipts),
      canPin: perms.isAdmin ? m.can_pin : undefined,
      canChangePicture: perms.isAdmin ? m.can_change_picture : undefined,
    };
  });

  let group_ = null;
  let block = null;
  if (group && conversation.osusu_group_id) {
    const g = await (await import('../repositories/osusuRepository.js')).findGroup(conversation.osusu_group_id);
    group_ = g ? {
      id: g.id, name: g.name, imageUrl: storageService.publicUrl(BUCKETS.groupImages, g.image_path), status: g.status,
      contributionAmount: Number(g.contribution_amount), frequency: g.frequency, createdAt: g.created_at, adminId: g.admin_id,
      rules: g.rules ?? null,
    } : null;
  } else if (!group) {
    const other = members.find((m) => m.user_id !== userId);
    if (other) block = await messageRepo.blockedBetween(userId, other.user_id);
  }

  return {
    id: conversation.id,
    type: conversation.type,
    title: group_?.name || conversation.title,
    description: conversation.description ?? null,
    groupId: conversation.osusu_group_id,
    planId: conversation.collector_saver_id,
    group: group_,
    createdAt: conversation.created_at,
    readReceipts: viewerShares,
    settings: { ...DEFAULT_CHAT_SETTINGS, ...(conversation.settings || {}) },
    permissions: perms,
    me: { role: me.role, mutedUntil: me.muted_until && new Date(me.muted_until) > new Date() ? me.muted_until : null },
    memberCount: members.length,
    onlineCount: formatted.filter((m) => m.online).length,
    members: formatted,
    blocked: block ? { byMe: block.iBlocked, byThem: block.blockedMe } : null,
    pinned: pins.filter((p) => p.message && !p.message.deleted_at).map((p) => ({
      messageId: p.message_id, pinnedAt: p.pinned_at, body: p.message.body, kind: p.message.kind, senderId: p.message.sender_id, createdAt: p.message.created_at,
    })),
  };
}

export function formatMessage(m) {
  const deleted = Boolean(m.deleted_at);
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    kind: m.kind,
    body: deleted ? null : m.body,
    deleted,
    editedAt: deleted ? null : m.edited_at ?? null,
    metadata: deleted ? {} : m.metadata,
    createdAt: m.created_at,
    replyTo: !deleted && m.reply ? { id: m.reply.id, senderId: m.reply.sender_id, kind: m.reply.kind, body: m.reply.deleted_at ? null : m.reply.body, deleted: Boolean(m.reply.deleted_at) } : null,
    reactions: deleted ? [] : (m.reactions || []).map((r) => ({ userId: r.user_id, emoji: r.emoji })),
    attachments: deleted ? [] : (m.attachments || []).map((a) => ({ id: a.id, fileName: a.file_name, mimeType: a.mime_type, sizeBytes: a.size_bytes })),
  };
}

export async function listMessages(userId, conversationId, { before, after, limit }) {
  const me = await assertMember(userId, conversationId);
  const rows = await messageRepo.listMessages(conversationId, { before, after, limit, viewerId: userId, clearedAt: me.cleared_at });
  const ordered = after && !before ? rows : rows.reverse();
  return { messages: ordered.map(formatMessage), hasMore: rows.length === limit };
}

/** Jump to a message (e.g. a search result): the message with some context before and after it. */
export async function messagesAround(userId, conversationId, messageId) {
  const me = await assertMember(userId, conversationId);
  const target = await messageRepo.findMessage(messageId);
  if (!target || target.conversation_id !== conversationId) throw AppError.notFound('Message not found');
  const [older, newer] = await Promise.all([
    messageRepo.listMessages(conversationId, { before: target.created_at, limit: 25, viewerId: userId, clearedAt: me.cleared_at }),
    messageRepo.listMessages(conversationId, { after: target.created_at, limit: 25, viewerId: userId, clearedAt: me.cleared_at }),
  ]);
  return { messages: [...older.reverse(), ...newer].map(formatMessage), hasMore: older.length === 25, hasNewer: newer.length === 25, targetId: messageId };
}

// Sending -----------------------------------------------------------------------------------
export async function sendText(userId, conversationId, body, { replyTo = null, announcement = false } = {}) {
  const text = cleanText(body);
  if (!text) throw AppError.badRequest('Message cannot be empty', 'EMPTY_MESSAGE');
  const id = await messageRepo.postMessage({ conversationId, senderId: userId, kind: announcement ? 'announcement' : 'text', body: text, replyTo });
  if (announcement) {
    await auditService.record({ actorId: userId, action: 'chat.announcement', resourceType: 'conversation', resourceId: conversationId, metadata: { messageId: id } });
  }
  return formatMessage(await messageRepo.findMessage(id));
}

export async function sendAttachment(userId, conversationId, file, caption, { replyTo = null, voice = false } = {}) {
  await assertMember(userId, conversationId);
  const path = storageService.objectPath(conversationId, file.detectedExt);
  await storageService.upload(BUCKETS.attachments, path, file);
  try {
    const id = await messageRepo.postMessage({
      conversationId,
      senderId: userId,
      kind: 'attachment',
      body: cleanText(caption) || null,
      replyTo,
      metadata: voice && (file.detectedMime.startsWith('audio/') || file.detectedMime === 'video/webm') ? { voice: true } : {},
      attachments: [{ storage_path: path, file_name: safeFileName(file.originalname), mime_type: file.detectedMime, size_bytes: file.size }],
    });
    return formatMessage(await messageRepo.findMessage(id));
  } catch (err) {
    await storageService.remove(BUCKETS.attachments, path);
    throw err;
  }
}

export async function attachmentUrl(userId, attachmentId) {
  const attachment = await messageRepo.findAttachment(attachmentId);
  if (!attachment) throw AppError.notFound('Attachment not found');
  await assertMember(userId, attachment.conversation_id);
  const msg = await messageRepo.findMessage(attachment.message_id);
  if (!msg || msg.deleted_at) throw AppError.notFound('Attachment not found');
  return storageService.signedUrl(BUCKETS.attachments, attachment.storage_path, 600, attachment.file_name);
}

// Message actions ---------------------------------------------------------------------------
async function ownMessage(userId, messageId) {
  const m = await messageRepo.findMessage(messageId);
  if (!m) throw AppError.notFound('Message not found');
  const me = await assertMember(userId, m.conversation_id);
  return { m, me };
}

export async function editMessage(userId, messageId, body) {
  const { m } = await ownMessage(userId, messageId);
  if (m.sender_id !== userId) throw AppError.forbidden('You can only edit your own messages', 'NOT_YOUR_MESSAGE');
  if (m.deleted_at || !['text', 'announcement'].includes(m.kind)) throw AppError.conflict('This message cannot be edited', 'NOT_EDITABLE');
  if (Date.now() - new Date(m.created_at).getTime() > EDIT_WINDOW_MS) throw AppError.conflict('Messages can be edited for 15 minutes after sending', 'EDIT_WINDOW_PASSED');
  const text = cleanText(body);
  if (!text) throw AppError.badRequest('Message cannot be empty', 'EMPTY_MESSAGE');
  const updated = formatMessage(await messageRepo.updateMessage(messageId, { body: text, edited_at: new Date().toISOString() }));
  await broadcast(m.conversation_id, 'message.updated', updated);
  return updated;
}

/**
 * Delete for me: hidden only for you. Delete for everyone: your own message
 * within an hour, or any message by a group admin (moderation, audited).
 */
export async function deleteMessage(user, messageId, scope, req) {
  const { m, me } = await ownMessage(user.id, messageId);
  if (scope === 'me') {
    await messageRepo.hideMessage(messageId, user.id);
    return { deleted: 'me' };
  }
  if (m.deleted_at) return { deleted: 'everyone' };
  const conv = await messageRepo.findConversation(m.conversation_id);
  const own = m.sender_id === user.id;
  const moderator = conv.type === 'group' && me.role === 'admin' && !own;
  if (!own && !moderator) throw AppError.forbidden('You can only delete your own messages for everyone', 'NOT_YOUR_MESSAGE');
  if (own && Date.now() - new Date(m.created_at).getTime() > DELETE_FOR_EVERYONE_MS) {
    throw AppError.conflict('Messages can be deleted for everyone for one hour after sending. You can still delete it for yourself.', 'DELETE_WINDOW_PASSED');
  }
  if (!['text', 'attachment', 'announcement'].includes(m.kind)) throw AppError.conflict('This message cannot be deleted', 'NOT_DELETABLE');
  const updated = formatMessage(await messageRepo.updateMessage(messageId, { deleted_at: new Date().toISOString(), deleted_by: user.id, body: null }));
  await messageRepo.unpin(m.conversation_id, messageId).catch(() => {});
  if (moderator) {
    await auditService.record({ actorId: user.id, action: 'chat.message.moderated_delete', resourceType: 'message', resourceId: messageId, metadata: { conversationId: m.conversation_id, senderId: m.sender_id }, req });
  }
  await broadcast(m.conversation_id, 'message.updated', updated);
  return { deleted: 'everyone' };
}

export async function react(userId, messageId, emoji) {
  const { m } = await ownMessage(userId, messageId);
  if (m.deleted_at || ['system', 'call'].includes(m.kind)) throw AppError.conflict('You cannot react to this message', 'NOT_REACTABLE');
  if (emoji && !REACTIONS.includes(emoji)) throw AppError.badRequest('Unsupported reaction', 'INVALID_REACTION');
  await messageRepo.setReaction(messageId, m.conversation_id, userId, emoji || null);
  const updated = formatMessage(await messageRepo.findMessage(messageId));
  await broadcast(m.conversation_id, 'message.updated', updated);
  return updated;
}

export async function setPinned(user, conversationId, messageId, pinned, req) {
  const me = await assertMember(user.id, conversationId);
  const conv = await messageRepo.findConversation(conversationId);
  if (!chatPermissions(conv, me).canPin) throw AppError.forbidden('Only group admins can pin messages here', 'NOT_ALLOWED');
  const m = await messageRepo.findMessage(messageId);
  if (!m || m.conversation_id !== conversationId || m.deleted_at) throw AppError.notFound('Message not found');
  if (pinned) await messageRepo.pin(conversationId, messageId, user.id);
  else await messageRepo.unpin(conversationId, messageId);
  if (conv.type === 'group') {
    await auditService.record({ actorId: user.id, action: pinned ? 'chat.message.pinned' : 'chat.message.unpinned', resourceType: 'conversation', resourceId: conversationId, metadata: { messageId }, req });
  }
  await broadcast(conversationId, 'conversation.updated', { conversationId });
  return { pinned };
}

// Receipts and typing -------------------------------------------------------------------------
async function sharesReceipts(userId) {
  return (await preferencesService.flagsFor([userId]))(userId).readReceipts;
}

export async function markRead(userId, conversationId) {
  await assertMember(userId, conversationId);
  const now = new Date().toISOString();
  await messageRepo.updateMember(conversationId, userId, { last_read_at: now, last_delivered_at: now });
  if (!(await sharesReceipts(userId))) return;   // the person turned read receipts off
  await broadcast(conversationId, 'conversation.receipt', { conversationId, userId, lastReadAt: now, lastDeliveredAt: now });
}

/** The member's app received new messages (shown as "delivered" to senders who share receipts). */
export async function markDelivered(userId, conversationId) {
  await assertMember(userId, conversationId);
  const now = new Date().toISOString();
  await messageRepo.updateMember(conversationId, userId, { last_delivered_at: now });
  if (!(await sharesReceipts(userId))) return;
  await broadcast(conversationId, 'conversation.receipt', { conversationId, userId, lastDeliveredAt: now });
}

export async function typing(user, conversationId) {
  const me = await assertMember(user.id, conversationId);
  const conv = await messageRepo.findConversation(conversationId);
  if (!chatPermissions(conv, me).canSend) return;
  try {
    (await hub()).publishToConversation(conversationId, 'typing', { conversationId, userId: user.id, name: user.fullName?.split(' ')[0] || 'Someone' }, user.id);
  } catch { /* best effort */ }
}

// Search and media ------------------------------------------------------------------------------
export async function search(userId, conversationId, q) {
  const me = await assertMember(userId, conversationId);
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const rows = await messageRepo.search(conversationId, likePattern(term), { clearedAt: me.cleared_at });
  return rows.map((r) => ({ id: r.id, senderId: r.sender_id, kind: r.kind, body: r.body, createdAt: r.created_at }));
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
export async function media(userId, conversationId, { type, before }) {
  await assertMember(userId, conversationId);
  if (type === 'links') {
    const rows = await messageRepo.listLinkMessages(conversationId, { before });
    const items = rows.flatMap((r) => (r.body.match(URL_RE) || []).map((url, i) => ({ id: `${r.id}:${i}`, messageId: r.id, url, senderId: r.sender_id, createdAt: r.created_at })));
    return { items, next: rows.length === 30 ? rows.at(-1).created_at : null };
  }
  const rows = await messageRepo.listAttachments(conversationId, { types: type === 'docs' ? 'docs' : type === 'audio' ? 'audio' : 'media', before });
  return {
    items: rows.map((a) => ({ id: a.id, messageId: a.message_id, fileName: a.file_name, mimeType: a.mime_type, sizeBytes: a.size_bytes, senderId: a.message?.sender_id, createdAt: a.created_at })),
    next: rows.length === 30 ? rows.at(-1).created_at : null,
  };
}

// Chat preferences -------------------------------------------------------------------------------
export async function setMute(userId, conversationId, until) {
  await assertMember(userId, conversationId);
  const updated = await messageRepo.updateMember(conversationId, userId, { muted_until: until });
  return { mutedUntil: updated.muted_until };
}

export async function clearChat(userId, conversationId) {
  await assertMember(userId, conversationId);
  const now = new Date().toISOString();
  await messageRepo.updateMember(conversationId, userId, { cleared_at: now, last_read_at: now });
  return { clearedAt: now };
}

export async function setBlocked(user, otherUserId, blocked, req) {
  if (otherUserId === user.id) throw AppError.badRequest('You cannot block yourself');
  if (blocked) await messageRepo.block(user.id, otherUserId);
  else await messageRepo.unblock(user.id, otherUserId);
  await auditService.record({ actorId: user.id, action: blocked ? 'chat.user.blocked' : 'chat.user.unblocked', resourceType: 'profile', resourceId: otherUserId, req });
  return { blocked };
}

export async function report(user, conversationId, { messageId, reason }, req) {
  await assertMember(user.id, conversationId);
  const conv = await messageRepo.findConversation(conversationId);
  let respondent = null;
  let quoted = '';
  if (messageId) {
    const m = await messageRepo.findMessage(messageId);
    if (!m || m.conversation_id !== conversationId) throw AppError.notFound('Message not found');
    respondent = m.sender_id;
    quoted = m.deleted_at ? '[deleted message]' : (m.body || '[attachment]');
  } else if (conv.type !== 'group') {
    respondent = (await messageRepo.activeMemberIds(conversationId)).find((id) => id !== user.id) || null;
  }
  const what = messageId ? 'message' : conv.type === 'group' ? 'group chat' : 'person';
  const { reportAbuse } = await import('./supportService.js');
  const result = await reportAbuse(user, {
    subject: `Reported ${what} in ${conv.type === 'group' ? 'a group chat' : 'a chat'}`,
    description: `${cleanText(reason)}${quoted ? `\n\nReported message:\n"${quoted.slice(0, 1500)}"` : ''}`,
    respondentUserId: respondent,
    relatedGroupId: conv.osusu_group_id,
    details: { conversationId, messageId: messageId || null },
  });
  await auditService.record({ actorId: user.id, action: 'chat.report', resourceType: 'conversation', resourceId: conversationId, metadata: { messageId: messageId || null, reference: result.reference }, req });
  return result;
}

// Group administration -------------------------------------------------------------------------------
async function adminOf(user, conversationId) {
  const me = await assertMember(user.id, conversationId);
  const conv = await messageRepo.findConversation(conversationId);
  if (conv.type !== 'group' || me.role !== 'admin') throw AppError.forbidden('Only the group administrator can change this', 'ADMIN_ONLY');
  return conv;
}

const SETTING_VALUES = {
  send: ['all', 'admins'], pin: ['admins', 'selected'], change_picture: ['admins', 'selected'], invite: ['all', 'admins'],
  member_list: ['all', 'admins'], show_online: ['all', 'admins'],
};

export async function updateGroupChat(user, conversationId, { description, settings, reason }, req) {
  const conv = await adminOf(user, conversationId);
  const patch = {};
  const changed = {};
  if (description !== undefined) { patch.description = cleanText(description) || null; changed.description = true; }
  if (settings) {
    const next = { ...DEFAULT_CHAT_SETTINGS, ...(conv.settings || {}) };
    for (const [k, v] of Object.entries(settings)) {
      if (!SETTING_VALUES[k] || !SETTING_VALUES[k].includes(v)) throw AppError.badRequest(`Invalid setting: ${k}`, 'INVALID_SETTING');
      if (next[k] !== v) changed[k] = { from: next[k], to: v };
      next[k] = v;
    }
    patch.settings = next;
  }
  const updated = await messageRepo.updateConversation(conversationId, patch);
  await auditService.record({
    actorId: user.id, action: 'chat.group.settings', resourceType: 'conversation', resourceId: conversationId,
    reason: reason || null, previousState: { settings: conv.settings, description: conv.description }, newState: { settings: updated.settings, description: updated.description },
    metadata: { changed }, req,
  });
  await broadcast(conversationId, 'conversation.updated', { conversationId });
  if (changed.send) {
    await postSystemMessage(conversationId, changed.send.to === 'admins' ? 'Only admins can send messages now.' : 'All members can send messages now.');
  }
  return { settings: updated.settings, description: updated.description };
}

/** Selected-member permissions (pin, change picture) — admin only, audited. */
export async function setMemberPermissions(user, conversationId, memberId, { canPin, canChangePicture }, req) {
  await adminOf(user, conversationId);
  const target = await messageRepo.findMembership(conversationId, memberId);
  if (!target || target.left_at) throw AppError.notFound('Member not found');
  const patch = {};
  if (canPin !== undefined) patch.can_pin = Boolean(canPin);
  if (canChangePicture !== undefined) patch.can_change_picture = Boolean(canChangePicture);
  await messageRepo.updateMember(conversationId, memberId, patch);
  await auditService.record({ actorId: user.id, action: 'chat.member.permissions', resourceType: 'conversation', resourceId: conversationId, metadata: { memberId, ...patch }, req });
  await broadcast(conversationId, 'conversation.updated', { conversationId });
  return { memberId, canPin: patch.can_pin ?? target.can_pin, canChangePicture: patch.can_change_picture ?? target.can_change_picture };
}

// People ----------------------------------------------------------------------------------------------
export async function contacts(userId) {
  const ids = await messageRepo.contactIds(userId);
  const profiles = await userRepo.findManyBasic(ids);
  const flags = await preferencesService.flagsFor(profiles.map((p) => p.id));
  return profiles
    .map((p) => ({ id: p.id, name: p.full_name, avatarUrl: storageService.publicUrl(BUCKETS.avatars, p.avatar_path), online: flags(p.id).showOnlineStatus ? isOnline(p.last_seen_at) : false }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A member's profile as seen from chat: public information only (name,
 * photo, broad location if they chose to show it, member since, verification
 * badges, on-time record, mutual groups, presence if they share it). Never
 * email, phone, address, KYC, balances or bank details.
 */
export async function personProfile(viewer, otherUserId) {
  if (otherUserId !== viewer.id) {
    const ids = await messageRepo.contactIds(viewer.id);
    const isStaff = canAny(viewer, ['support.tickets', 'disputes.manage']);
    if (!ids.includes(otherUserId) && !isStaff) throw AppError.notFound('Profile not found');
  }
  const [{ trustProfile }, basic] = await Promise.all([import('./profileService.js'), userRepo.findManyBasic([otherUserId])]);
  const t = await trustProfile(otherUserId);
  const p = basic[0];
  const flags = await preferencesService.flagsFor([otherUserId]);
  const showPresence = flags(otherUserId).showOnlineStatus;
  const [groups, block] = await Promise.all([messageRepo.mutualGroups(viewer.id, otherUserId), messageRepo.blockedBetween(viewer.id, otherUserId)]);
  const key = [viewer.id, otherUserId].sort().join(':');
  const direct = await messageRepo.findByDirectKey(key);
  return {
    id: otherUserId,
    fullName: p?.full_name || t.displayName,
    avatarUrl: t.avatarUrl,
    location: t.location,
    memberSince: t.memberSince,
    active: t.active,
    verification: t.verification,
    completedGroups: t.completedGroups,
    onTimeRate: t.onTimeRate,
    online: showPresence ? isOnline(p?.last_seen_at) : null,
    lastSeenAt: showPresence ? p?.last_seen_at ?? null : null,
    mutualGroups: groups.map((g) => ({ id: g.id, name: g.name, imageUrl: storageService.publicUrl(BUCKETS.groupImages, g.image_path) })),
    blockedByMe: block.iBlocked,
    directConversationId: direct?.id ?? null,
  };
}

/** Direct chats are only allowed between people who share a group or a savings plan (or with staff). */
export async function openDirect(user, otherUserId) {
  if (otherUserId === user.id) throw AppError.badRequest('You cannot message yourself');
  const isStaff = canAny(user, ['support.tickets', 'disputes.manage']);
  if (!isStaff) {
    const ids = await messageRepo.contactIds(user.id);
    if (!ids.includes(otherUserId)) throw AppError.forbidden('You can only message people in your groups or savings plans', 'NOT_A_CONTACT');
  }
  const key = [user.id, otherUserId].sort().join(':');
  let conv = await messageRepo.findByDirectKey(key);
  if (!conv) {
    try {
      conv = await messageRepo.insertConversation({ type: 'direct', direct_key: key, created_by: user.id });
    } catch (err) {
      if (err.code !== 'DUPLICATE') throw err;
      conv = await messageRepo.findByDirectKey(key);
    }
  }
  await messageRepo.upsertMember(conv.id, user.id);
  await messageRepo.upsertMember(conv.id, otherUserId);
  return { id: conv.id };
}
