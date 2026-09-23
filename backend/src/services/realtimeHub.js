import { env } from '../config/env.js';
import { supabaseAdmin } from '../integrations/supabase/client.js';
import * as messageRepo from '../repositories/messageRepository.js';
import * as callRepo from '../repositories/callRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import { formatMessage } from './messageService.js';
import { logger } from '../utils/logger.js';

/**
 * Realtime fan-out.
 *
 * Supabase Realtime (postgres_changes) → this backend (service role) →
 * authorised browsers over Server-Sent Events. Browsers never hold a Supabase
 * token, and every event is delivered only to users entitled to see it.
 * Each API instance subscribes independently, so it scales horizontally.
 */
const clients = new Map(); // userId -> Set<res>
const memberCache = new Map(); // conversationId -> { ids, until }

export function connectedUserCount() {
  return clients.size;
}

export function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  userRepo.touchLastSeen(userId).catch(() => {});
  return () => {
    const set = clients.get(userId);
    if (!set) return;
    set.delete(res);
    if (!set.size) clients.delete(userId);
  };
}

export function publishToUser(userId, event, payload) {
  const set = clients.get(userId);
  if (!set) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) res.write(frame);
}

export function publishToUsers(userIds, event, payload) {
  for (const id of userIds) publishToUser(id, event, payload);
}

async function conversationMembers(conversationId) {
  const hit = memberCache.get(conversationId);
  if (hit && hit.until > Date.now()) return hit.ids;
  const ids = await messageRepo.activeMemberIds(conversationId);
  memberCache.set(conversationId, { ids, until: Date.now() + 15_000 });
  return ids;
}

async function onMessage(row) {
  const members = await conversationMembers(row.conversation_id);
  const local = members.filter((id) => clients.has(id));
  if (!local.length) return;
  const full = await messageRepo.findMessage(row.id);
  if (full) publishToUsers(local, 'message.new', formatMessage(full));
}

function onNotification(row) {
  publishToUser(row.user_id, 'notification.new', {
    id: row.id, type: row.type, category: row.category, title: row.title, body: row.body, data: row.data, createdAt: row.created_at,
  });
}

async function onCall(row, eventType) {
  const participants = await callRepo.listParticipants(row.id);
  const payload = {
    id: row.id,
    conversationId: row.conversation_id,
    callType: row.call_type,
    scope: row.scope,
    status: row.status,
    initiatedBy: row.initiated_by,
    meetingId: row.meeting_id,
    startedAt: row.started_at,
  };
  if (eventType === 'INSERT') {
    const caller = await userRepo.findById(row.initiated_by);
    payload.callerName = caller?.full_name;
    publishToUsers(participants.filter((p) => p.user_id !== row.initiated_by).map((p) => p.user_id), 'call.incoming', payload);
  } else {
    publishToUsers(participants.map((p) => p.user_id), 'call.updated', payload);
  }
}

let channel;
export function startRealtimeBridge() {
  if (!env.ENABLE_REALTIME_BRIDGE || env.isTest || channel) return;
  const safe = (fn) => (payload) => Promise.resolve(fn(payload)).catch((err) => logger.warn({ err: err.message }, 'realtime handler error'));
  channel = supabaseAdmin
    .channel('achiever-api-bridge')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, safe((p) => onMessage(p.new)))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, safe((p) => onNotification(p.new)))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, safe((p) => onCall(p.new, 'INSERT')))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, safe((p) => onCall(p.new, 'UPDATE')))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, (p) => {
      const id = p.new?.conversation_id || p.old?.conversation_id;
      if (id) memberCache.delete(id);
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') logger.info('realtime bridge subscribed');
      else if (err) logger.warn({ status, err: err.message }, 'realtime bridge status');
      else logger.info({ status }, 'realtime bridge status');
    });
}

export async function stopRealtimeBridge() {
  if (channel) await supabaseAdmin.removeChannel(channel);
  channel = undefined;
  for (const set of clients.values()) for (const res of set) res.end();
  clients.clear();
}
