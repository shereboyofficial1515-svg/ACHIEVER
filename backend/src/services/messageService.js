import { BUCKETS, STAFF_ROLES } from '../config/constants.js';
import * as messageRepo from '../repositories/messageRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as storageService from './storageService.js';
import { AppError } from '../utils/AppError.js';
import { cleanText, safeFileName } from '../utils/sanitize.js';

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

function isOnline(lastSeen) {
  return Boolean(lastSeen) && Date.now() - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS;
}

export async function assertMember(userId, conversationId) {
  const membership = await messageRepo.findMembership(conversationId, userId);
  if (!membership || membership.left_at) throw AppError.forbidden('You are not a member of this conversation', 'NOT_A_MEMBER');
  return membership;
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

// User-facing ------------------------------------------------------------------------
export async function listConversations(userId) {
  const rows = await messageRepo.summaries(userId);
  return rows.map((r) => ({
    id: r.conversation_id,
    type: r.type,
    title: r.title,
    groupId: r.osusu_group_id,
    planId: r.collector_saver_id,
    lastMessageAt: r.last_message_at,
    lastMessage: r.last_message_kind === 'attachment' ? 'Attachment' : r.last_message_body,
    lastSenderId: r.last_sender_id,
    unreadCount: Number(r.unread_count),
    memberCount: Number(r.member_count),
    otherUser: r.other_user_id
      ? {
          id: r.other_user_id,
          name: r.other_user_name,
          avatarUrl: storageService.publicUrl(BUCKETS.avatars, r.other_user_avatar),
          online: isOnline(r.other_user_last_seen),
        }
      : null,
  }));
}

export async function getConversation(userId, conversationId) {
  await assertMember(userId, conversationId);
  const [conversation, members] = await Promise.all([
    messageRepo.findConversation(conversationId),
    messageRepo.listMembers(conversationId),
  ]);
  return {
    id: conversation.id,
    type: conversation.type,
    title: conversation.title,
    groupId: conversation.osusu_group_id,
    planId: conversation.collector_saver_id,
    members: members.map((m) => ({
      id: m.user_id,
      name: m.profile?.full_name,
      role: m.role,
      avatarUrl: storageService.publicUrl(BUCKETS.avatars, m.profile?.avatar_path),
      online: isOnline(m.profile?.last_seen_at),
      lastReadAt: m.last_read_at,
    })),
  };
}

export function formatMessage(m) {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    kind: m.kind,
    body: m.body,
    metadata: m.metadata,
    createdAt: m.created_at,
    attachments: (m.attachments || []).map((a) => ({ id: a.id, fileName: a.file_name, mimeType: a.mime_type, sizeBytes: a.size_bytes })),
  };
}

export async function listMessages(userId, conversationId, { before, limit }) {
  await assertMember(userId, conversationId);
  const rows = await messageRepo.listMessages(conversationId, { before, limit });
  return { messages: rows.reverse().map(formatMessage), hasMore: rows.length === limit };
}

export async function sendText(userId, conversationId, body) {
  const text = cleanText(body);
  if (!text) throw AppError.badRequest('Message cannot be empty', 'EMPTY_MESSAGE');
  const id = await messageRepo.postMessage({ conversationId, senderId: userId, kind: 'text', body: text });
  return formatMessage(await messageRepo.findMessage(id));
}

export async function sendAttachment(userId, conversationId, file, caption) {
  await assertMember(userId, conversationId);
  const path = storageService.objectPath(conversationId, file.detectedExt);
  await storageService.upload(BUCKETS.attachments, path, file);
  try {
    const id = await messageRepo.postMessage({
      conversationId,
      senderId: userId,
      kind: 'attachment',
      body: cleanText(caption) || null,
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
  return storageService.signedUrl(BUCKETS.attachments, attachment.storage_path, 600, attachment.file_name);
}

export async function markRead(userId, conversationId) {
  await assertMember(userId, conversationId);
  await messageRepo.markRead(conversationId, userId);
}

export async function contacts(userId) {
  const ids = await messageRepo.contactIds(userId);
  const profiles = await userRepo.findManyBasic(ids);
  return profiles
    .map((p) => ({ id: p.id, name: p.full_name, avatarUrl: storageService.publicUrl(BUCKETS.avatars, p.avatar_path), online: isOnline(p.last_seen_at) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Direct chats are only allowed between people who share a group or a savings plan (or with staff). */
export async function openDirect(user, otherUserId) {
  if (otherUserId === user.id) throw AppError.badRequest('You cannot message yourself');
  const isStaff = user.roles.some((r) => STAFF_ROLES.includes(r));
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
