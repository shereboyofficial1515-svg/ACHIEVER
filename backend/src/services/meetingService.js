import * as meetingRepo from '../repositories/meetingRepository.js';
import * as osusuRepo from '../repositories/osusuRepository.js';
import * as messageRepo from '../repositories/messageRepository.js';
import * as osusuService from './osusuService.js';
import * as callService from './callService.js';
import * as notificationService from './notificationService.js';
import * as messageService from './messageService.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';

function format(m, userId) {
  return {
    id: m.id,
    groupId: m.group_id,
    groupName: m.group?.name,
    organizerId: m.organizer_id,
    title: m.title,
    description: m.description,
    startsAt: m.starts_at,
    durationMinutes: m.duration_minutes,
    status: m.status,
    callEnabled: m.call_enabled,
    callId: m.call_id,
    isOrganizer: m.organizer_id === userId,
  };
}

function lagosTime(iso) {
  return new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

async function notifyMembers(groupId, exceptUserId, build) {
  const members = await osusuRepo.listMembers(groupId, { statuses: ['active'] });
  for (const m of members) {
    if (m.user_id !== exceptUserId) await notificationService.notify(m.user_id, build(m.user_id));
  }
}

export async function list(user, { groupId, upcomingOnly }) {
  let groupIds;
  if (groupId) {
    await osusuService.groupAccess(user, groupId);
    groupIds = [groupId];
  } else {
    const memberships = await osusuRepo.listMemberships(user.id);
    const admin = await osusuRepo.listGroups({ adminId: user.id, page: 1, pageSize: 100 });
    groupIds = [...new Set([...memberships.filter((m) => m.status === 'active').map((m) => m.group_id), ...admin.rows.map((g) => g.id)])];
  }
  const rows = await meetingRepo.listForGroups(groupIds, { upcomingOnly });
  return rows.map((m) => format(m, user.id));
}

export async function create(user, input, req) {
  const { group } = await osusuService.groupAccess(user, input.groupId, { adminOnly: true });
  if (!['recruiting', 'active'].includes(group.status)) throw AppError.conflict('Meetings can only be scheduled for open groups');
  if (new Date(input.startsAt).getTime() < Date.now() + 5 * 60 * 1000) {
    throw AppError.badRequest('Meetings must be scheduled at least 5 minutes ahead', 'MEETING_TOO_SOON');
  }
  const meeting = await meetingRepo.insert({
    group_id: input.groupId,
    organizer_id: user.id,
    title: input.title,
    description: input.description ?? null,
    starts_at: input.startsAt,
    duration_minutes: input.durationMinutes,
    call_enabled: input.callEnabled,
  });
  await notifyMembers(group.id, user.id, (uid) => ({
    type: 'meeting_scheduled', category: 'meetings', title: 'Meeting scheduled',
    body: `${meeting.title} for ${group.name} is scheduled for ${lagosTime(meeting.starts_at)}.`,
    data: { meeting_id: meeting.id, group_id: group.id }, dedupeKey: `meeting_new:${meeting.id}:${uid}`,
  }));
  const conv = await messageRepo.findByGroup(group.id);
  if (conv) await messageService.postSystemMessage(conv.id, `Meeting scheduled: ${meeting.title} — ${lagosTime(meeting.starts_at)}`, { meeting_id: meeting.id });
  await auditService.record({ actorId: user.id, action: 'meeting.create', resourceType: 'meeting', resourceId: meeting.id, req });
  return format(meeting, user.id);
}

async function organizerMeeting(user, id) {
  const meeting = await meetingRepo.find(id);
  if (!meeting) throw AppError.notFound('Meeting not found');
  await osusuService.groupAccess(user, meeting.group_id, { adminOnly: true });
  return meeting;
}

export async function update(user, id, patch, req) {
  const meeting = await organizerMeeting(user, id);
  if (meeting.status !== 'scheduled') throw AppError.conflict('Only scheduled meetings can be edited');
  const row = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.startsAt !== undefined) row.starts_at = patch.startsAt;
  if (patch.durationMinutes !== undefined) row.duration_minutes = patch.durationMinutes;
  if (patch.callEnabled !== undefined) row.call_enabled = patch.callEnabled;
  const updated = await meetingRepo.update(id, row);
  if (row.starts_at) {
    await notifyMembers(meeting.group_id, user.id, (uid) => ({
      type: 'meeting_rescheduled', category: 'meetings', title: 'Meeting rescheduled',
      body: `${updated.title} has moved to ${lagosTime(updated.starts_at)}.`,
      data: { meeting_id: id }, dedupeKey: `meeting_moved:${id}:${row.starts_at}:${uid}`,
    }));
  }
  await auditService.record({ actorId: user.id, action: 'meeting.update', resourceType: 'meeting', resourceId: id, req });
  return format(updated, user.id);
}

export async function cancel(user, id, req) {
  const meeting = await organizerMeeting(user, id);
  if (meeting.status !== 'scheduled') throw AppError.conflict('Only scheduled meetings can be cancelled');
  await meetingRepo.update(id, { status: 'cancelled' });
  await notifyMembers(meeting.group_id, user.id, (uid) => ({
    type: 'meeting_cancelled', category: 'meetings', title: 'Meeting cancelled',
    body: `${meeting.title} (${lagosTime(meeting.starts_at)}) has been cancelled.`,
    data: { meeting_id: id }, dedupeKey: `meeting_cancel:${id}:${uid}`,
  }));
  await auditService.record({ actorId: user.id, action: 'meeting.cancel', resourceType: 'meeting', resourceId: id, req });
}

/** Organiser starts the meeting: opens a group call in the group conversation. */
export async function start(user, id, { callType }, req) {
  const meeting = await organizerMeeting(user, id);
  if (!meeting.call_enabled) throw AppError.conflict('Calling is disabled for this meeting');
  if (!['scheduled', 'in_progress'].includes(meeting.status)) throw AppError.conflict('This meeting is not open');
  const conv = await messageRepo.findByGroup(meeting.group_id);
  const result = await callService.startCall(user, { conversationId: conv.id, callType, meetingId: id }, req);
  await meetingRepo.update(id, { status: 'in_progress', call_id: result.call.id });
  return result;
}

export async function join(user, id, req) {
  const meeting = await meetingRepo.find(id);
  if (!meeting) throw AppError.notFound('Meeting not found');
  await osusuService.groupAccess(user, meeting.group_id);
  if (meeting.status !== 'in_progress' || !meeting.call_id) throw AppError.conflict('The organiser has not started this meeting yet', 'MEETING_NOT_STARTED');
  return callService.joinCall(user, meeting.call_id, req);
}
