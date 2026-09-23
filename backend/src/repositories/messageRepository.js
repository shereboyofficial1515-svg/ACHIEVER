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
    db.from('conversation_members').select('conversation_id, user_id, role, last_read_at, left_at')
      .eq('conversation_id', conversationId).eq('user_id', userId).maybeSingle(),
  );
}

export async function listMembers(conversationId) {
  return run(
    db.from('conversation_members')
      .select('user_id, role, last_read_at, joined_at, profile:profiles(id, full_name, avatar_path, last_seen_at)')
      .eq('conversation_id', conversationId).is('left_at', null),
  );
}

export async function activeMemberIds(conversationId) {
  const rows = await run(db.from('conversation_members').select('user_id').eq('conversation_id', conversationId).is('left_at', null));
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
  'id, conversation_id, sender_id, kind, body, metadata, created_at, attachments:message_attachments(id, file_name, mime_type, size_bytes)';

export async function listMessages(conversationId, { before, limit }) {
  let q = db.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', conversationId).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(limit);
  if (before) q = q.lt('created_at', before);
  return run(q);
}

export async function findMessage(id) {
  return one(db.from('messages').select(MESSAGE_COLUMNS).eq('id', id).maybeSingle());
}

export async function postMessage({ conversationId, senderId, kind, body, metadata = {}, attachments = [] }) {
  return rpc('post_message', {
    p_conversation_id: conversationId, p_sender_id: senderId, p_kind: kind, p_body: body ?? null,
    p_metadata: metadata, p_attachments: attachments,
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
