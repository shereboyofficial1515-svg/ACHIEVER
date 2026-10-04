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

/** Send an event to the members of a conversation connected to this instance (optionally not to one user). */
export async function publishToConversation(conversationId, event, payload, exceptUserId = null) {
  const members = await conversationMembers(conversationId);
  publishToUsers(members.filter((id) => id !== exceptUserId && clients.has(id)), event, payload);
}

/** Is this user connected to this API instance right now (app open and in the foreground)? */
export function isConnected(userId) {
  return clients.has(userId);
}

// Messages sent through the API are published straight away (no dependency on the database
// change feed). The change feed still delivers messages written elsewhere (system and call
// messages); ids published recently are skipped so nobody receives a message twice.
const recentlyPublished = new Map(); // messageId -> time
function rememberPublished(id) {
  const now = Date.now();
  recentlyPublished.set(id, now);
  if (recentlyPublished.size > 2000) {
    for (const [k, t] of recentlyPublished) if (now - t > 120_000) recentlyPublished.delete(k);
  }
}

/** Deliver a new (formatted) message to the conversation's connected members. */
export async function publishMessage(message) {
  rememberPublished(message.id);
  const members = await conversationMembers(message.conversationId);
  const local = members.filter((id) => clients.has(id));
  if (!local.length) return;
  const muted = await messageRepo.mutedMemberIds(message.conversationId, local).catch(() => []);
  for (const id of local) publishToUser(id, 'message.new', muted.includes(id) ? { ...message, muted: true } : message);
}

async function onMessage(row) {
  if (recentlyPublished.has(row.id)) return;
  const members = await conversationMembers(row.conversation_id);
  if (!members.some((id) => clients.has(id))) return;
  const full = await messageRepo.findMessage(row.id);
  if (full) await publishMessage(formatMessage(full));
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
let retryTimer;
let retryDelay = 2_000;
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
      if (status === 'SUBSCRIBED') {
        retryDelay = 2_000;
        logger.info('realtime bridge subscribed');
        return;
      }
      logger.warn({ status, err: err?.message }, 'realtime bridge status');
      // A failed, timed-out or closed channel never comes back by itself: subscribe again
      // with backoff, otherwise the change feed would stay silent until the next deploy.
      if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) scheduleBridgeRestart();
    });
}

function scheduleBridgeRestart() {
  if (retryTimer || !channel) return;
  const old = channel;
  retryTimer = setTimeout(async () => {
    retryTimer = undefined;
    if (channel !== old) return;
    channel = undefined;
    await supabaseAdmin.removeChannel(old).catch(() => {});
    startRealtimeBridge();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60_000);
}

export async function stopRealtimeBridge() {
  clearTimeout(retryTimer);
  retryTimer = undefined;
  if (channel) await supabaseAdmin.removeChannel(channel);
  channel = undefined;
  for (const set of clients.values()) for (const res of set) res.end();
  clients.clear();
}
