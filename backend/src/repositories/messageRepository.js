import { db, one, run, rpc } from '../integrations/supabase/db.js';

export async function summaries(userId) {
  return rpc('conversation_summaries', { p_user_id: userId });
}

export async function findConversation(id) {
  return one(db.from('conversations').select('*').eq('id', id).maybeSingle());
}

export async function findByGroup(groupId) {
  return one(db.from('conversations').select('*').eq('osusu_group_id', groupId).maybeSingle());
}

export async function findByPlan(planId) {
  return one(db.from('conversations').select('*').eq('collector_saver_id', planId).maybeSingle());
}

export async function findByDirectKey(key) {
  return one(db.from('conversations').select('*').eq('direct_key', key).maybeSingle());
}

export async function insertConversation(row) {
  return one(db.from('conversations').insert(row).select('*').maybeSingle());
}

export async function findMembership(conversationId, userId) {
  return one(
    db.from('conversation_members').select('conversation_id, user_id, role, last_read_at, last_delivered_at, muted_until, cleared_at, can_pin, can_change_picture, left_at')
      .eq('conversation_id', conversationId).eq('user_id', userId).maybeSingle(),
  );
}

export async function listMembers(conversationId) {
  return run(
    db.from('conversation_members')
      .select('user_id, role, last_read_at, last_delivered_at, joined_at, can_pin, can_change_picture, profile:profiles(id, full_name, avatar_path, last_seen_at)')
      .eq('conversation_id', conversationId).is('left_at', null),
  );
}

export async function activeMemberIds(conversationId) {
  const rows = await run(db.from('conversation_members').select('user_id').eq('conversation_id', conversationId).is('left_at', null));
  return rows.map((r) => r.user_id);
}

/** Members who muted the chat (no sound / pop-up for new messages). */
export async function mutedMemberIds(conversationId, userIds) {
  if (!userIds.length) return [];
  const rows = await run(db.from('conversation_members').select('user_id').eq('conversation_id', conversationId)
    .in('user_id', userIds).gt('muted_until', new Date().toISOString()));
  return rows.map((r) => r.user_id);
}

export async function upsertMember(conversationId, userId, role = 'member') {
  return run(
    db.from('conversation_members').upsert(
      { conversation_id: conversationId, user_id: userId, role, left_at: null },
      { onConflict: 'conversation_id,user_id' },
    ),
  );
}

export async function removeMember(conversationId, userId) {
  return run(
    db.from('conversation_members').update({ left_at: new Date().toISOString() })
      .eq('conversation_id', conversationId).eq('user_id', userId),
  );
}

export async function markRead(conversationId, userId) {
  return run(
    db.from('conversation_members').update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId).eq('user_id', userId),
  );
}

const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, kind, body, metadata, created_at, edited_at, deleted_at, reply_to_id, ' +
  'attachments:message_attachments(id, file_name, mime_type, size_bytes), ' +
  'reply:messages!messages_reply_to_id_fkey(id, sender_id, kind, body, deleted_at), ' +
  'reactions:message_reactions(user_id, emoji)';

/**
 * Messages for one member: deleted messages come back as tombstones (no body),
 * anything they hid ("delete for me") or cleared is left out.
 *   before: older page (newest first)   after: newer page (oldest first)
 */
export async function listMessages(conversationId, { before, after, limit, viewerId, clearedAt }) {
  let q = db.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', conversationId)
    .order('created_at', { ascending: !before && Boolean(after) }).limit(limit);
  if (before) q = q.lt('created_at', before);
  if (after) q = q.gte('created_at', after);
  if (clearedAt) q = q.gt('created_at', clearedAt);
  const rows = await run(q);
  if (!viewerId || !rows.length) return rows;
  const hidden = await run(db.from('message_hidden').select('message_id').eq('user_id', viewerId).in('message_id', rows.map((r) => r.id)));
  const skip = new Set(hidden.map((h) => h.message_id));
  return rows.filter((r) => !skip.has(r.id));
}

export async function updateMessage(id, patch) {
  return one(db.from('messages').update(patch).eq('id', id).select(MESSAGE_COLUMNS).maybeSingle());
}

export async function updateMember(conversationId, userId, patch) {
  return one(db.from('conversation_members').update(patch).eq('conversation_id', conversationId).eq('user_id', userId)
    .select('conversation_id, user_id, role, last_read_at, last_delivered_at, muted_until, cleared_at, can_pin, can_change_picture').maybeSingle());
}

export async function updateConversation(id, patch) {
  return one(db.from('conversations').update(patch).eq('id', id).select('*').maybeSingle());
}

// Reactions, delete-for-me, pins
export async function setReaction(messageId, conversationId, userId, emoji) {
  if (!emoji) return run(db.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', userId));
  return run(db.from('message_reactions').upsert(
    { message_id: messageId, conversation_id: conversationId, user_id: userId, emoji, created_at: new Date().toISOString() },
    { onConflict: 'message_id,user_id' },
  ));
}

export async function hideMessage(messageId, userId) {
  return run(db.from('message_hidden').upsert({ message_id: messageId, user_id: userId }, { onConflict: 'message_id,user_id', ignoreDuplicates: true }));
}

export async function listPins(conversationId) {
  return run(db.from('conversation_pins').select('message_id, pinned_by, pinned_at, message:messages(id, sender_id, kind, body, created_at, deleted_at)')
    .eq('conversation_id', conversationId).order('pinned_at', { ascending: false }));
}

export async function pin(conversationId, messageId, userId) {
  return run(db.from('conversation_pins').upsert({ conversation_id: conversationId, message_id: messageId, pinned_by: userId }, { onConflict: 'conversation_id,message_id' }));
}

export async function unpin(conversationId, messageId) {
  return run(db.from('conversation_pins').delete().eq('conversation_id', conversationId).eq('message_id', messageId));
}

// Blocking
export async function blockedBetween(a, b) {
  const rows = await run(db.from('user_blocks').select('blocker_id, blocked_id')
    .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`));
  return { iBlocked: rows.some((r) => r.blocker_id === a), blockedMe: rows.some((r) => r.blocker_id === b) };
}

export async function block(blockerId, blockedId) {
  return run(db.from('user_blocks').upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }));
}

export async function unblock(blockerId, blockedId) {
  return run(db.from('user_blocks').delete().eq('blocker_id', blockerId).eq('blocked_id', blockedId));
}

// Search, media, links
export async function search(conversationId, term, { limit = 30, clearedAt } = {}) {
  let q = db.from('messages').select('id, sender_id, kind, body, created_at').eq('conversation_id', conversationId).is('deleted_at', null)
    .ilike('body', term).order('created_at', { ascending: false }).limit(limit);
  if (clearedAt) q = q.gt('created_at', clearedAt);
  return run(q);
}

export async function listAttachments(conversationId, { types, before, limit = 30 }) {
  let q = db.from('message_attachments')
    .select('id, message_id, file_name, mime_type, size_bytes, created_at, message:messages!inner(sender_id, deleted_at)')
    .eq('conversation_id', conversationId).is('message.deleted_at', null).order('created_at', { ascending: false }).limit(limit);
  if (types === 'media') q = q.or('mime_type.like.image/%,mime_type.like.video/%');
  else if (types === 'audio') q = q.like('mime_type', 'audio/%');
  else q = q.not('mime_type', 'like', 'image/%').not('mime_type', 'like', 'video/%').not('mime_type', 'like', 'audio/%');
  if (before) q = q.lt('created_at', before);
  return run(q);
}

export async function listLinkMessages(conversationId, { before, limit = 30 }) {
  let q = db.from('messages').select('id, sender_id, body, created_at').eq('conversation_id', conversationId).is('deleted_at', null)
    .ilike('body', '%http%').order('created_at', { ascending: false }).limit(limit);
  if (before) q = q.lt('created_at', before);
  return run(q);
}

export async function findMessage(id) {
  return one(db.from('messages').select(MESSAGE_COLUMNS).eq('id', id).maybeSingle());
}

export async function postMessage({ conversationId, senderId, kind, body, metadata = {}, attachments = [], replyTo = null }) {
  return rpc('post_message', {
    p_conversation_id: conversationId, p_sender_id: senderId, p_kind: kind, p_body: body ?? null,
    p_metadata: metadata, p_attachments: attachments, p_reply_to: replyTo,
  });
}

export async function findAttachment(id) {
  return one(db.from('message_attachments').select('*').eq('id', id).maybeSingle());
}

/** Users who share an active Osusu group or a collector plan with userId. */
export async function contactIds(userId) {
  const groups = await run(db.from('osusu_members').select('group_id').eq('user_id', userId).eq('status', 'active'));
  const groupIds = groups.map((g) => g.group_id);
  const ids = new Set();
  if (groupIds.length) {
    const members = await run(db.from('osusu_members').select('user_id').in('group_id', groupIds).eq('status', 'active'));
    members.forEach((m) => ids.add(m.user_id));
  }
  const plans = await run(
    db.from('collector_savers').select('saver_id, collector_id').or(`saver_id.eq.${userId},collector_id.eq.${userId}`)
      .neq('status', 'cancelled'),
  );
  plans.forEach((p) => { ids.add(p.saver_id); ids.add(p.collector_id); });
  ids.delete(userId);
  return [...ids];
}

/** Groups both users are active members of (for a contact's profile). */
export async function mutualGroups(a, b) {
  const mine = await run(db.from('osusu_members').select('group_id').eq('user_id', a).eq('status', 'active'));
  if (!mine.length) return [];
  const shared = await run(db.from('osusu_members').select('group:osusu_groups(id, name, image_path, status)').eq('user_id', b).eq('status', 'active')
    .in('group_id', mine.map((m) => m.group_id)));
  return shared.map((r) => r.group).filter(Boolean);
}
