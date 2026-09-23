import { env } from '../config/env.js';
import { INVITE_TTL_DAYS } from '../config/constants.js';
import { sendEmail } from '../integrations/resend/resendClient.js';
import { templates } from '../integrations/resend/templates.js';
import { sendSms } from '../integrations/termii/termiiClient.js';
import * as inviteRepo from '../repositories/inviteRepository.js';
import * as osusuRepo from '../repositories/osusuRepository.js';
import * as collectorRepo from '../repositories/collectorRepository.js';
import * as osusuService from './osusuService.js';
import * as collectorService from './collectorService.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { hashInviteToken, randomToken } from '../utils/crypto.js';
import { formatNaira } from '../utils/money.js';

async function deliver(invite, token, inviterName, contextName) {
  const url = `${env.CLIENT_URL}/invite/${token}`;
  const results = {};
  if (invite.email) {
    const r = await sendEmail({ to: invite.email, ...templates.invite({ inviterName, contextName, url, kind: invite.kind }) });
    results.email = r.ok;
  }
  if (invite.phone) {
    const r = await sendSms({ to: invite.phone, message: `ACHIEVER: ${inviterName} invited you to ${contextName}. Review: ${url}` });
    results.sms = r.ok;
  }
  return results;
}

async function create(user, row, contextName, req) {
  const token = randomToken(32);
  const invite = await inviteRepo.insert({
    ...row,
    invited_by: user.id,
    token_hash: hashInviteToken(token),
    expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString(),
  });
  const delivery = await deliver(invite, token, user.fullName, contextName);
  await auditService.record({ actorId: user.id, action: `invite.create.${row.kind}`, resourceType: 'invite', resourceId: invite.id, metadata: { delivery }, req });
  return { id: invite.id, status: invite.status, expiresAt: invite.expires_at, delivery, link: `${env.CLIENT_URL}/invite/${token}` };
}

export async function inviteToGroup(user, groupId, { email, phone }, req) {
  const { group } = await osusuService.groupAccess(user, groupId, { adminOnly: true });
  if (group.status !== 'recruiting') throw AppError.conflict('Invitations can only be sent while the group is recruiting', 'GROUP_NOT_RECRUITING');
  return create(user, { kind: 'osusu_group', group_id: groupId, email: email ?? null, phone: phone ?? null }, group.name, req);
}

export async function inviteSaver(user, input, req) {
  const account = await collectorService.requireActiveAccount(user);
  const terms = {
    plan_name: input.planName,
    frequency: input.frequency,
    expected_amount: input.expectedAmount ?? null,
    start_date: input.startDate,
    end_date: input.endDate,
    commission_type: input.commissionType ?? account.default_commission_type,
    commission_value: input.commissionValue ?? Number(account.default_commission_value),
  };
  if (terms.commission_type === 'percentage' && terms.commission_value > 2000) {
    throw AppError.unprocessable('Commission cannot exceed 20%', 'COMMISSION_TOO_HIGH');
  }
  return create(
    user,
    { kind: 'collector_saver', collector_account_id: account.id, email: input.email ?? null, phone: input.phone ?? null, terms },
    account.business_name,
    req,
  );
}

async function findValid(token) {
  const invite = await inviteRepo.findByTokenHash(hashInviteToken(token));
  if (!invite) throw AppError.notFound('This invitation link is invalid', 'INVITE_INVALID');
  if (invite.status !== 'pending') throw AppError.conflict(`This invitation has been ${invite.status}`, 'INVITE_NOT_PENDING');
  if (new Date(invite.expires_at).getTime() < Date.now()) throw AppError.conflict('This invitation has expired', 'INVITE_EXPIRED');
  return invite;
}

export async function preview(token) {
  const invite = await findValid(token);
  if (invite.kind === 'osusu_group') {
    const g = await osusuRepo.findGroup(invite.group_id);
    return {
      kind: invite.kind,
      expiresAt: invite.expires_at,
      group: {
        name: g.name,
        description: g.description,
        organiser: g.admin?.full_name,
        contributionAmount: Number(g.contribution_amount),
        contributionLabel: formatNaira(g.contribution_amount),
        frequency: g.frequency,
        maxMembers: g.max_members,
        startDate: g.start_date,
        status: g.status,
      },
    };
  }
  const account = await collectorRepo.findAccount(invite.collector_account_id);
  return {
    kind: invite.kind,
    expiresAt: invite.expires_at,
    collector: { businessName: account.business_name, name: account.collector?.full_name, operatingArea: account.operating_area },
    terms: {
      planName: invite.terms.plan_name,
      frequency: invite.terms.frequency,
      expectedAmount: invite.terms.expected_amount,
      startDate: invite.terms.start_date,
      endDate: invite.terms.end_date,
      commissionType: invite.terms.commission_type,
      commissionValue: invite.terms.commission_value,
    },
  };
}

function assertRecipient(user, invite) {
  // Invitations are personal: the accepting account must match the invited contact.
  const emailOk = invite.email && invite.email.toLowerCase() === user.email.toLowerCase();
  const phoneOk = invite.phone && invite.phone === user.phone;
  if (!emailOk && !phoneOk) {
    throw AppError.forbidden('This invitation was sent to a different email or phone number', 'INVITE_RECIPIENT_MISMATCH');
  }
}

export async function accept(user, token, req) {
  const invite = await findValid(token);
  assertRecipient(user, invite);
  // Claim the invitation first (conditional update) so two concurrent accepts
  // cannot both create a membership or savings plan.
  const claimed = await inviteRepo.transition(invite.id, { status: 'accepted', accepted_by: user.id, accepted_at: new Date().toISOString() });
  if (!claimed) throw AppError.conflict('This invitation was already used', 'INVITE_NOT_PENDING');
  let result;
  try {
    if (invite.kind === 'osusu_group') {
      const group = await osusuRepo.findGroup(invite.group_id);
      result = await osusuService.addMember(user, group, { viaInvite: true }, req);
    } else {
      result = await collectorService.createPlanFromInvite(user, invite, req);
    }
  } catch (err) {
    await inviteRepo.reopen(invite.id);
    throw err;
  }
  await auditService.record({ actorId: user.id, action: 'invite.accept', resourceType: 'invite', resourceId: invite.id, req });
  return { kind: invite.kind, ...result };
}

export async function decline(user, token, req) {
  const invite = await findValid(token);
  assertRecipient(user, invite);
  await inviteRepo.transition(invite.id, { status: 'declined' });
  await auditService.record({ actorId: user.id, action: 'invite.decline', resourceType: 'invite', resourceId: invite.id, req });
}

export async function revoke(user, inviteId, req) {
  const invite = await inviteRepo.find(inviteId);
  if (!invite || invite.invited_by !== user.id) throw AppError.notFound('Invitation not found');
  const updated = await inviteRepo.transition(inviteId, { status: 'revoked' });
  if (!updated) throw AppError.conflict('Only pending invitations can be revoked', 'INVITE_NOT_PENDING');
  await auditService.record({ actorId: user.id, action: 'invite.revoke', resourceType: 'invite', resourceId: inviteId, req });
}

function formatInvite(i) {
  return { id: i.id, kind: i.kind, email: i.email, phone: i.phone, status: i.status, expiresAt: i.expires_at, createdAt: i.created_at, terms: i.terms };
}

export async function listGroupInvites(user, groupId) {
  await osusuService.groupAccess(user, groupId, { adminOnly: true });
  return (await inviteRepo.listForGroup(groupId)).map(formatInvite);
}

export async function listCollectorInvites(user) {
  const account = await collectorService.requireActiveAccount(user);
  return (await inviteRepo.listForCollectorAccount(account.id)).map(formatInvite);
}
