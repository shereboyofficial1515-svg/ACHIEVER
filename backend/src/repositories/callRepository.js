import { db, one, run } from '../integrations/supabase/db.js';

const CALL_COLUMNS =
  'id, conversation_id, room_name, initiated_by, call_type, scope, status, meeting_id, started_at, answered_at, ended_at, duration_seconds, ended_by';

export async function insertCall(row) {
  return one(db.from('calls').insert(row).select(CALL_COLUMNS).maybeSingle());
}

export async function findCall(id) {
  return one(db.from('calls').select(`${CALL_COLUMNS}, participants:call_participants(user_id, status, joined_at, left_at, profile:profiles(full_name, avatar_path))`).eq('id', id).maybeSingle());
}

export async function findCallByRoom(roomName) {
  return one(db.from('calls').select(CALL_COLUMNS).eq('room_name', roomName).maybeSingle());
}

export async function findLiveCall(conversationId) {
  return one(db.from('calls').select(CALL_COLUMNS).eq('conversation_id', conversationId).in('status', ['ringing', 'active']).maybeSingle());
}

/** Conditional status transition; returns the row only if the transition happened. */
export async function transitionCall(id, fromStatuses, patch) {
  return one(db.from('calls').update(patch).eq('id', id).in('status', fromStatuses).select(CALL_COLUMNS).maybeSingle());
}

export async function insertParticipants(rows) {
  return run(db.from('call_participants').upsert(rows, { onConflict: 'call_id,user_id', ignoreDuplicates: true }));
}

export async function findParticipant(callId, userId) {
  return one(db.from('call_participants').select('*').eq('call_id', callId).eq('user_id', userId).maybeSingle());
}

export async function updateParticipant(callId, userId, patch) {
  return run(db.from('call_participants').update(patch).eq('call_id', callId).eq('user_id', userId));
}

export async function listParticipants(callId) {
  return run(db.from('call_participants').select('user_id, status').eq('call_id', callId));
}

export async function history(userId, limit = 50) {
  const rows = await run(
    db.from('call_participants')
      .select('status, call:calls(id, conversation_id, call_type, scope, status, initiated_by, started_at, answered_at, ended_at, duration_seconds, initiator:profiles!calls_initiated_by_fkey(full_name))')
      .eq('user_id', userId)
      .order('call_id', { ascending: false })
      .limit(limit),
  );
  return rows
    .filter((r) => r.call)
    .map((r) => ({ ...r.call, myStatus: r.status }))
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
}
