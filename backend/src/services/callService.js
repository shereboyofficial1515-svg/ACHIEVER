import crypto from 'node:crypto';
import { closeRoom, createRoomToken, receiveWebhook } from '../integrations/livekit/livekitClient.js';
import { env } from '../config/env.js';
import { BUCKETS } from '../config/constants.js';
import * as callRepo from '../repositories/callRepository.js';
import * as messageRepo from '../repositories/messageRepository.js';
import * as meetingRepo from '../repositories/meetingRepository.js';
import * as paymentRepo from '../repositories/paymentRepository.js';
import * as messageService from './messageService.js';
import * as auditService from './auditService.js';
import * as storageService from './storageService.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

function formatCall(c) {
  return {
    id: c.id,
    conversationId: c.conversation_id,
    callType: c.call_type,
    scope: c.scope,
    status: c.status,
    initiatedBy: c.initiated_by,
    meetingId: c.meeting_id,
    startedAt: c.started_at,
    answeredAt: c.answered_at,
    endedAt: c.ended_at,
    durationSeconds: c.duration_seconds,
    participants: (c.participants || []).map((p) => ({
      userId: p.user_id,
      status: p.status,
      name: p.profile?.full_name,
      avatarUrl: storageService.publicUrl(BUCKETS.avatars, p.profile?.avatar_path),
    })),
  };
}

async function issueToken(user, call) {
  const { token, url } = await createRoomToken({
    roomName: call.room_name,
    identity: user.id,
    name: user.fullName,
    metadata: { avatarUrl: user.avatarUrl },
  });
  return { token, url, roomName: call.room_name };
}

async function requireParticipant(user, callId) {
  const call = await callRepo.findCall(callId);
  if (!call) throw AppError.notFound('Call not found');
  const participant = (call.participants || []).find((p) => p.user_id === user.id);
  if (!participant) throw AppError.forbidden('You are not part of this call');
  return { call, participant };
}

/** Start (or join the live) call in a conversation the user belongs to. */
export async function startCall(user, { conversationId, callType, meetingId = null }, req) {
  if (!env.features.calls) throw AppError.unavailable('Calling is not configured on this server', 'CALLS_NOT_CONFIGURED');
  await messageService.assertMember(user.id, conversationId);
  const conversation = await messageRepo.findConversation(conversationId);

  const live = await callRepo.findLiveCall(conversationId);
  if (live) {
    await callRepo.insertParticipants([{ call_id: live.id, user_id: user.id, status: 'invited' }]);
    if (live.status === 'ringing' && live.initiated_by !== user.id) return acceptCall(user, live.id, req);
    return joinCall(user, live.id, req);
  }

  const scope = conversation.type === 'group' ? 'group' : 'direct';
  const memberIds = await messageRepo.activeMemberIds(conversationId);
  const id = crypto.randomUUID();
  let call;
  try {
    call = await callRepo.insertCall({
      id,
      conversation_id: conversationId,
      room_name: `ach_${id}`,
      initiated_by: user.id,
      call_type: callType,
      scope,
      // Group calls are joinable immediately; direct calls ring the other person.
      status: scope === 'group' ? 'active' : 'ringing',
      answered_at: scope === 'group' ? new Date().toISOString() : null,
      meeting_id: meetingId,
    });
  } catch (err) {
    if (err.code === 'DUPLICATE') {
      const existing = await callRepo.findLiveCall(conversationId);
      if (existing) return joinCall(user, existing.id, req);
    }
    throw err;
  }
  await callRepo.insertParticipants(
    memberIds.map((uid) => ({
      call_id: call.id,
      user_id: uid,
      status: uid === user.id ? 'joined' : 'invited',
      joined_at: uid === user.id ? new Date().toISOString() : null,
    })),
  );
  await auditService.record({ actorId: user.id, action: 'call.start', resourceType: 'call', resourceId: call.id, metadata: { scope, callType }, req });
  return { call: formatCall(await callRepo.findCall(call.id)), ...(await issueToken(user, call)) };
}

export async function acceptCall(user, callId, req) {
  const { call, participant } = await requireParticipant(user, callId);
  if (!['ringing', 'active'].includes(call.status)) throw AppError.conflict('This call has ended', 'CALL_ENDED');
  if (participant.status === 'rejected') throw AppError.conflict('You declined this call', 'CALL_DECLINED');
  await callRepo.updateParticipant(callId, user.id, { status: 'joined', joined_at: new Date().toISOString(), left_at: null });
  if (call.status === 'ringing') {
    await callRepo.transitionCall(callId, ['ringing'], { status: 'active', answered_at: new Date().toISOString() });
  }
  await auditService.record({ actorId: user.id, action: 'call.accept', resourceType: 'call', resourceId: callId, req });
  return { call: formatCall(await callRepo.findCall(callId)), ...(await issueToken(user, call)) };
}

export async function joinCall(user, callId, req) {
  const { call } = await requireParticipant(user, callId);
  if (call.status !== 'active' && !(call.status === 'ringing' && call.initiated_by === user.id)) {
    throw AppError.conflict('This call is not active', 'CALL_NOT_ACTIVE');
  }
  await callRepo.updateParticipant(callId, user.id, { status: 'joined', joined_at: new Date().toISOString(), left_at: null });
  await auditService.record({ actorId: user.id, action: 'call.join', resourceType: 'call', resourceId: callId, req });
  return { call: formatCall(await callRepo.findCall(callId)), ...(await issueToken(user, call)) };
}

/** Token refresh / reconnection for an existing participant. */
export async function token(user, callId) {
  const { call, participant } = await requireParticipant(user, callId);
  if (!['ringing', 'active'].includes(call.status) || participant.status !== 'joined') {
    throw AppError.conflict('Join the call first', 'CALL_NOT_JOINED');
  }
  return issueToken(user, call);
}

export async function rejectCall(user, callId) {
  const { call } = await requireParticipant(user, callId);
  await callRepo.updateParticipant(callId, user.id, { status: 'rejected' });
  if (call.scope === 'direct' && call.status === 'ringing') {
    await callRepo.transitionCall(callId, ['ringing'], { status: 'rejected', ended_at: new Date().toISOString(), ended_by: user.id });
  }
}

async function finish(call, userId, status = 'ended') {
  const endedAt = new Date();
  const answered = call.answered_at ? new Date(call.answered_at) : null;
  const updated = await callRepo.transitionCall(call.id, ['ringing', 'active'], {
    status: call.status === 'ringing' && status === 'ended' ? 'cancelled' : status,
    ended_at: endedAt.toISOString(),
    ended_by: userId,
    duration_seconds: answered ? Math.max(0, Math.round((endedAt - answered) / 1000)) : 0,
  });
  if (!updated) return;
  await closeRoom(call.room_name);
  const meeting = await meetingRepo.findByCall(call.id);
  if (meeting && meeting.status === 'in_progress') await meetingRepo.update(meeting.id, { status: 'completed' });
  const minutes = Math.floor((updated.duration_seconds || 0) / 60);
  const seconds = (updated.duration_seconds || 0) % 60;
  await messageService.postSystemMessage(
    call.conversation_id,
    updated.status === 'cancelled' ? `Missed ${call.call_type} call` : `${call.call_type === 'video' ? 'Video' : 'Voice'} call ended · ${minutes}m ${seconds}s`,
    { call_id: call.id, duration_seconds: updated.duration_seconds, status: updated.status },
    'call',
  ).catch(() => {});
}

export async function leaveCall(user, callId) {
  const { call } = await requireParticipant(user, callId);
  await callRepo.updateParticipant(callId, user.id, { status: 'left', left_at: new Date().toISOString() });
  const participants = await callRepo.listParticipants(callId);
  const stillIn = participants.filter((p) => p.status === 'joined');
  if (call.scope === 'direct' || stillIn.length === 0) await finish(call, user.id);
}

export async function endCall(user, callId, req) {
  const { call } = await requireParticipant(user, callId);
  const conversation = await messageRepo.findConversation(call.conversation_id);
  const membership = await messageRepo.findMembership(conversation.id, user.id);
  // Direct calls: either party. Group calls: the initiator or a conversation admin ends it for everyone.
  if (call.scope === 'group' && call.initiated_by !== user.id && membership?.role !== 'admin') {
    return leaveCall(user, callId);
  }
  await finish(call, user.id);
  await auditService.record({ actorId: user.id, action: 'call.end', resourceType: 'call', resourceId: callId, req });
  return undefined;
}

export async function getCall(user, callId) {
  const { call } = await requireParticipant(user, callId);
  return formatCall(call);
}

export async function history(user) {
  const rows = await callRepo.history(user.id);
  return rows.map((c) => ({
    id: c.id,
    conversationId: c.conversation_id,
    callType: c.call_type,
    scope: c.scope,
    status: c.status,
    myStatus: c.myStatus,
    initiatedBy: c.initiated_by,
    initiatorName: c.initiator?.full_name,
    startedAt: c.started_at,
    durationSeconds: c.duration_seconds,
  }));
}

/** LiveKit server webhooks keep call state correct if a client disappears. */
export async function handleLivekitWebhook(rawBody, authHeader) {
  const event = await receiveWebhook(rawBody, authHeader);
  const stored = await paymentRepo.recordWebhook({
    provider: 'livekit',
    event: event.event,
    event_key: `livekit:${event.id}`,
    reference: event.room?.name ?? null,
    signature_valid: true,
    payload: JSON.parse(rawBody),
  });
  if (!stored) return;
  const roomName = event.room?.name;
  const call = roomName ? await callRepo.findCallByRoom(roomName) : null;
  if (!call) return;
  const identity = event.participant?.identity;
  try {
    if (event.event === 'participant_joined' && identity) {
      await callRepo.updateParticipant(call.id, identity, { status: 'joined', joined_at: new Date().toISOString() });
    } else if (event.event === 'participant_left' && identity) {
      await callRepo.updateParticipant(call.id, identity, { status: 'left', left_at: new Date().toISOString() });
    } else if (event.event === 'room_finished') {
      await finish(call, null);
    }
    await paymentRepo.updateWebhook(stored.id, { status: 'processed', processed_at: new Date().toISOString() });
  } catch (err) {
    logger.warn({ err: err.message }, 'livekit webhook handling failed');
    await paymentRepo.updateWebhook(stored.id, { status: 'failed', error: err.message.slice(0, 300) });
  }
}
