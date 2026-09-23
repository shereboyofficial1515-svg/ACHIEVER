import { STAFF_ROLES } from '../config/constants.js';
import * as supportRepo from '../repositories/supportRepository.js';
import * as paymentRepo from '../repositories/paymentRepository.js';
import * as osusuRepo from '../repositories/osusuRepository.js';
import * as collectorRepo from '../repositories/collectorRepository.js';
import * as riskRepo from '../repositories/riskRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as notificationService from './notificationService.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { newPaymentReference } from '../utils/crypto.js';
import { pageMeta } from '../utils/pagination.js';

const PRIORITY_BY_CATEGORY = {
  unauthorized_activity: 'urgent',
  payout_issue: 'high',
  incorrect_balance: 'high',
  missing_contribution: 'high',
  incorrect_payment: 'normal',
  collector_issue: 'normal',
  bill_payment_issue: 'normal',
  other: 'low',
};

function format(t) {
  return {
    id: t.id,
    reference: t.reference,
    category: t.category,
    subject: t.subject,
    description: t.description,
    status: t.status,
    priority: t.priority,
    relatedTransactionId: t.related_transaction_id,
    relatedGroupId: t.related_group_id,
    relatedPlanId: t.related_collector_saver_id,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    resolvedAt: t.resolved_at,
    user: t.user ? { id: t.user.id, name: t.user.full_name, email: t.user.email } : undefined,
    assignee: t.assignments?.find?.((a) => a.active)?.assignee?.full_name,
  };
}

/** Users may only link records they own or belong to. */
async function validateLinks(user, input) {
  if (input.relatedTransactionId) {
    const tx = await paymentRepo.findTransaction(input.relatedTransactionId);
    if (!tx || tx.user_id !== user.id) throw AppError.badRequest('Linked transaction not found', 'INVALID_LINK');
  }
  if (input.relatedGroupId) {
    const g = await osusuRepo.findGroup(input.relatedGroupId);
    const m = g && (await osusuRepo.findMembership(g.id, user.id));
    if (!g || (g.admin_id !== user.id && !m)) throw AppError.badRequest('Linked group not found', 'INVALID_LINK');
  }
  if (input.relatedPlanId) {
    const p = await collectorRepo.findPlan(input.relatedPlanId);
    if (!p || (p.saver_id !== user.id && p.collector_id !== user.id)) throw AppError.badRequest('Linked plan not found', 'INVALID_LINK');
  }
}

export async function create(user, input, req) {
  await validateLinks(user, input);
  const ticket = await supportRepo.insertTicket({
    reference: newPaymentReference('ACH-TKT').slice(0, 30),
    user_id: user.id,
    category: input.category,
    subject: input.subject,
    description: input.description,
    priority: PRIORITY_BY_CATEGORY[input.category],
    related_transaction_id: input.relatedTransactionId ?? null,
    related_group_id: input.relatedGroupId ?? null,
    related_collector_saver_id: input.relatedPlanId ?? null,
  });

  // Neutral monitoring: repeated complaints about the same collector → review.
  if (input.relatedPlanId) {
    const plan = await collectorRepo.findPlan(input.relatedPlanId);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const count = await supportRepo.recentComplaintsAgainstCollector(plan.collector_id, since);
    if (count >= 3) {
      await riskRepo.insert({
        subject_user_id: plan.collector_id, context: 'collector', reason_code: 'repeated_complaints',
        severity: 'medium', status: 'review_required', collector_saver_id: plan.id, details: { tickets_30d: count },
      });
    }
  }
  await auditService.record({ actorId: user.id, action: 'support.ticket.create', resourceType: 'support_ticket', resourceId: ticket.id, metadata: { category: input.category }, req });
  await notificationService.notify(user.id, {
    type: 'support_ticket_created', category: 'account', title: 'Support case opened',
    body: `We received your case ${ticket.reference}. Our team will respond as soon as possible.`,
    data: { ticket_id: ticket.id }, dedupeKey: `ticket_new:${ticket.id}`,
  });
  return format(ticket);
}

export async function listMine(user, filters) {
  const result = await supportRepo.listTickets({ ...filters, userId: user.id });
  return { items: result.rows.map(format), meta: pageMeta(filters, result.total) };
}

async function ticketFor(user, id) {
  const ticket = await supportRepo.findTicket(id);
  const staff = user.roles.some((r) => STAFF_ROLES.includes(r));
  if (!ticket || (!staff && ticket.user_id !== user.id)) throw AppError.notFound('Support case not found');
  return { ticket, staff };
}

export async function get(user, id) {
  const { ticket, staff } = await ticketFor(user, id);
  const messages = await supportRepo.listMessages(id, { includeInternal: staff });
  return {
    ...format(ticket),
    messages: messages.map((m) => ({
      id: m.id, authorId: m.author_id, authorName: m.author?.full_name, body: m.body, internal: m.internal,
      createdAt: m.created_at, fromStaff: m.author_id !== ticket.user_id,
    })),
  };
}

export async function addMessage(user, id, { body, internal }, req) {
  const { ticket, staff } = await ticketFor(user, id);
  if (['closed'].includes(ticket.status)) throw AppError.conflict('This case is closed', 'TICKET_CLOSED');
  const message = await supportRepo.insertMessage({ ticket_id: id, author_id: user.id, body, internal: staff && Boolean(internal) });
  if (staff && !internal) {
    await supportRepo.updateTicket(id, { status: 'awaiting_user' });
    await notificationService.notify(ticket.user_id, {
      type: 'support_reply', category: 'account', title: 'New reply on your support case',
      body: `ACHIEVER support replied to case ${ticket.reference}.`, data: { ticket_id: id }, dedupeKey: `ticket_reply:${message.id}`,
    });
  } else if (!staff) {
    await supportRepo.updateTicket(id, { status: ticket.status === 'resolved' ? 'open' : ticket.status === 'awaiting_user' ? 'in_progress' : ticket.status });
  }
  await auditService.record({ actorId: user.id, action: 'support.ticket.message', resourceType: 'support_ticket', resourceId: id, metadata: { internal: Boolean(internal) }, req });
  return message;
}

// Staff -------------------------------------------------------------------------------
export async function listAll(filters) {
  const result = await supportRepo.listTickets(filters);
  return { items: result.rows.map(format), meta: pageMeta(filters, result.total) };
}

export async function updateTicket(actor, id, { status, priority }, req) {
  const ticket = await supportRepo.findTicket(id);
  if (!ticket) throw AppError.notFound('Support case not found');
  const patch = {};
  if (status) {
    patch.status = status;
    if (status === 'resolved' || status === 'closed') patch.resolved_at = new Date().toISOString();
  }
  if (priority) patch.priority = priority;
  const updated = await supportRepo.updateTicket(id, patch);
  if (status && status !== ticket.status && ['resolved', 'closed'].includes(status)) {
    await notificationService.notify(ticket.user_id, {
      type: 'support_resolved', category: 'account', title: 'Support case updated',
      body: `Case ${ticket.reference} has been marked ${status}.`, data: { ticket_id: id }, dedupeKey: `ticket_status:${id}:${status}`,
    });
  }
  await auditService.record({ actorId: actor.id, action: 'support.ticket.update', resourceType: 'support_ticket', resourceId: id, metadata: patch, req });
  return format(updated);
}

export async function assign(actor, id, assigneeId, req) {
  const ticket = await supportRepo.findTicket(id);
  if (!ticket) throw AppError.notFound('Support case not found');
  const roles = await userRepo.getRoles(assigneeId);
  if (!roles.some((r) => STAFF_ROLES.includes(r))) throw AppError.badRequest('Assignee must be a staff member', 'INVALID_ASSIGNEE');
  await supportRepo.assign(id, assigneeId, actor.id);
  if (ticket.status === 'open') await supportRepo.updateTicket(id, { status: 'in_progress' });
  await auditService.record({ actorId: actor.id, action: 'support.ticket.assign', resourceType: 'support_ticket', resourceId: id, metadata: { assigneeId }, req });
}
