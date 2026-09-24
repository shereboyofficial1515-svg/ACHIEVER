import crypto from 'node:crypto';
import { BUCKETS } from '../config/constants.js';
import * as supportRepo from '../repositories/supportRepository.js';
import * as paymentRepo from '../repositories/paymentRepository.js';
import * as osusuRepo from '../repositories/osusuRepository.js';
import * as collectorRepo from '../repositories/collectorRepository.js';
import * as riskRepo from '../repositories/riskRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as notificationService from './notificationService.js';
import * as auditService from './auditService.js';
import * as securityService from './securityService.js';
import * as storageService from './storageService.js';
import { can, canAny, permissionsForRoles } from './permissionService.js';
import { AppError } from '../utils/AppError.js';
import { newPaymentReference, sha256 } from '../utils/crypto.js';
import { pageMeta } from '../utils/pagination.js';

const PRIORITY_BY_CATEGORY = {
  unauthorized_activity: 'urgent',
  account_takeover: 'urgent',
  suspected_fraud: 'urgent',
  payout_issue: 'high',
  missing_payout: 'high',
  failed_withdrawal: 'high',
  collector_settlement: 'high',
  incorrect_balance: 'high',
  missing_contribution: 'high',
  fake_payment: 'high',
  incorrect_payment: 'normal',
  incorrect_contribution: 'normal',
  collector_issue: 'normal',
  bill_payment_issue: 'normal',
  other: 'low',
};

const CASE_STAFF = ['support.tickets', 'disputes.manage'];

// Only disputes about money handled by another party name that party as respondent.
// Other cases (e.g. account security reports) stay private to the complainant and staff.
const RESPONDENT_CATEGORIES = new Set([
  'missing_payout', 'payout_issue', 'collector_issue', 'collector_settlement', 'missing_contribution',
  'incorrect_contribution', 'incorrect_balance', 'fake_payment',
]);
const isCaseStaff = (user) => canAny(user, CASE_STAFF);

function format(t, viewer) {
  return {
    id: t.id,
    reference: t.reference,
    caseNumber: t.case_number,
    category: t.category,
    subject: t.subject,
    description: t.description,
    status: t.status,
    priority: t.priority,
    amount: t.amount != null ? Number(t.amount) : null,
    relatedTransactionId: t.related_transaction_id,
    relatedGroupId: t.related_group_id,
    relatedPlanId: t.related_collector_saver_id,
    respondentUserId: t.respondent_user_id,
    collectorId: t.collector_id,
    resolution: t.resolution,
    resolutionOutcome: t.resolution_outcome,
    viewerRole: viewer ? (viewer.id === t.user_id ? 'complainant' : viewer.id === t.respondent_user_id ? 'respondent' : 'staff') : undefined,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    resolvedAt: t.resolved_at,
    user: t.user ? { id: t.user.id, name: t.user.full_name, email: t.user.email } : undefined,
    assignee: t.assignments?.find?.((a) => a.active)?.assignee?.full_name,
  };
}

/** Users may only link records they own or belong to. Returns the derived respondent/collector. */
async function validateLinks(user, input) {
  const derived = { respondentUserId: null, collectorId: null, planCollectorId: null };
  if (input.relatedTransactionId) {
    const tx = await paymentRepo.findTransaction(input.relatedTransactionId);
    if (!tx || tx.user_id !== user.id) throw AppError.badRequest('Linked transaction not found', 'INVALID_LINK');
  }
  if (input.relatedGroupId) {
    const g = await osusuRepo.findGroup(input.relatedGroupId);
    const m = g && (await osusuRepo.findMembership(g.id, user.id));
    if (!g || (g.admin_id !== user.id && !m)) throw AppError.badRequest('Linked group not found', 'INVALID_LINK');
    // A member's complaint about a group is answered by its organiser.
    if (g.admin_id !== user.id) derived.respondentUserId = g.admin_id;
  }
  if (input.relatedPlanId) {
    const p = await collectorRepo.findPlan(input.relatedPlanId);
    if (!p || (p.saver_id !== user.id && p.collector_id !== user.id)) throw AppError.badRequest('Linked plan not found', 'INVALID_LINK');
    derived.planCollectorId = p.collector_id;
    if (p.saver_id === user.id) {
      derived.collectorId = p.collector_id;
      derived.respondentUserId = p.collector_id;
    } else {
      derived.respondentUserId = p.saver_id;
    }
  }
  return derived;
}

async function caseEvent(caseId, actorId, eventType, details = {}) {
  await supportRepo.addCaseEvent({ case_id: caseId, actor_id: actorId, event_type: eventType, details });
}

export async function create(user, input, req) {
  const derived = await validateLinks(user, input);
  if (!RESPONDENT_CATEGORIES.has(input.category)) derived.respondentUserId = null;
  const ticket = await supportRepo.insertTicket({
    reference: newPaymentReference('ACH-TKT').slice(0, 30),
    user_id: user.id,
    category: input.category,
    subject: input.subject,
    description: input.description,
    priority: PRIORITY_BY_CATEGORY[input.category] ?? 'normal',
    related_transaction_id: input.relatedTransactionId ?? null,
    related_group_id: input.relatedGroupId ?? null,
    related_collector_saver_id: input.relatedPlanId ?? null,
    respondent_user_id: derived.respondentUserId,
    collector_id: derived.collectorId,
    amount: input.amount ?? null,
  });
  await caseEvent(ticket.id, user.id, 'created', { category: input.category });
  if (input.relatedTransactionId) {
    await supportRepo.linkTransaction({ case_id: ticket.id, transaction_id: input.relatedTransactionId, linked_by: user.id, note: 'Linked by complainant' });
  }

  // Neutral monitoring: repeated complaints about the same collector → review.
  if (derived.collectorId) {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const count = await supportRepo.recentComplaintsAgainstCollector(derived.collectorId, since);
    if (count >= 3) {
      await riskRepo.insert({
        subject_user_id: derived.collectorId, context: 'collector', reason_code: 'repeated_complaints',
        severity: 'medium', status: 'review_required', collector_saver_id: input.relatedPlanId, details: { tickets_30d: count },
      });
      await securityService.recordEvent({
        userId: derived.collectorId, type: 'repeated_disputes', severity: 'medium', relatedCaseId: ticket.id,
        description: `${count} cases in 30 days reference this collector. Review required; no finding has been made.`,
        metadata: { cases_30d: count },
      });
    }
  }
  if (['account_takeover', 'unauthorized_activity'].includes(input.category)) {
    await securityService.recordEvent({
      userId: user.id, type: 'account_takeover_indicator', severity: 'high', source: 'user_report', relatedCaseId: ticket.id,
      description: 'The account owner reported activity they did not authorise.',
    });
  }
  await auditService.record({ actorId: user.id, action: 'support.ticket.create', resourceType: 'support_ticket', resourceId: ticket.id, metadata: { category: input.category, caseNumber: ticket.case_number }, req });
  await notificationService.notify(user.id, {
    type: 'support_ticket_created', category: 'support', title: 'Case opened',
    body: `We received your case ${ticket.case_number ?? ticket.reference}. Our team will respond as soon as possible.`,
    data: { ticket_id: ticket.id, case_number: ticket.case_number }, dedupeKey: `ticket_new:${ticket.id}`,
  });
  if (derived.respondentUserId) {
    await notificationService.notify(derived.respondentUserId, {
      type: 'dispute_opened', category: 'support', title: 'A case mentions you',
      body: `Case ${ticket.case_number} was opened about a group or savings plan you are part of. You can view it and add your response and evidence.`,
      data: { ticket_id: ticket.id }, dedupeKey: `dispute_respondent:${ticket.id}`,
    });
  }
  return format(ticket, user);
}

export async function listMine(user, filters) {
  const result = await supportRepo.listTickets({ ...filters, partyId: user.id });
  return { items: result.rows.map((t) => format(t, user)), meta: pageMeta(filters, result.total) };
}

async function ticketFor(user, id) {
  const ticket = await supportRepo.findTicket(id);
  const party = ticket && (ticket.user_id === user.id || ticket.respondent_user_id === user.id);
  // A staff member who is a party to the case is treated as a party, never as staff.
  const staff = isCaseStaff(user) && !party;
  if (!ticket || (!staff && !party)) throw AppError.notFound('Case not found');
  return { ticket, staff };
}

export async function get(user, id) {
  const { ticket, staff } = await ticketFor(user, id);
  const [messages, evidence, events, linked] = await Promise.all([
    supportRepo.listMessages(id, { includeInternal: staff }),
    supportRepo.listEvidence(id),
    staff ? supportRepo.caseEvents(id) : Promise.resolve([]),
    staff ? supportRepo.caseTransactions(id) : Promise.resolve([]),
  ]);
  return {
    ...format(ticket, user),
    messages: messages.map((m) => ({
      id: m.id, authorId: m.author_id, authorName: m.author?.full_name, body: m.body, internal: m.internal,
      createdAt: m.created_at, fromStaff: m.author_id !== ticket.user_id && m.author_id !== ticket.respondent_user_id,
    })),
    // Parties see evidence metadata only; files open through a logged, short-lived link.
    evidence: evidence
      .filter((e) => staff || e.uploaded_by === user.id || e.source === 'system')
      .map((e) => ({
        id: e.id, type: e.evidence_type, source: e.source, description: e.description, hasFile: Boolean(e.storage_path),
        mimeType: e.mime_type, sizeBytes: e.size_bytes, sha256: e.sha256, linkedRecordType: e.linked_record_type,
        linkedRecordId: e.linked_record_id, supersedesId: e.supersedes_id, uploadedBy: e.uploader?.full_name, createdAt: e.created_at,
      })),
    timeline: staff ? events.map((e) => ({ id: e.id, type: e.event_type, details: e.details, actor: e.actor?.full_name, createdAt: e.created_at })) : undefined,
    linkedTransactions: staff ? linked.map((l) => ({ ...l.transaction, note: l.note, linkedAt: l.linked_at })) : undefined,
  };
}

export async function addMessage(user, id, { body, internal }, req) {
  const { ticket, staff } = await ticketFor(user, id);
  if (['closed'].includes(ticket.status)) throw AppError.conflict('This case is closed', 'TICKET_CLOSED');
  const message = await supportRepo.insertMessage({ ticket_id: id, author_id: user.id, body, internal: staff && Boolean(internal) });
  if (staff && !internal) {
    await supportRepo.updateTicket(id, { status: 'awaiting_user' });
    await notificationService.notify(ticket.user_id, {
      type: 'support_reply', category: 'support', title: 'New reply on your case',
      body: `ACHIEVER support replied to case ${ticket.case_number ?? ticket.reference}.`, data: { ticket_id: id }, dedupeKey: `ticket_reply:${message.id}`,
    });
  } else if (!staff) {
    await supportRepo.updateTicket(id, { status: ticket.status === 'resolved' ? 'open' : ticket.status === 'awaiting_user' ? 'in_progress' : ticket.status });
    if (ticket.status === 'resolved') await caseEvent(id, user.id, 'reopened', {});
  }
  if (staff && internal) await caseEvent(id, user.id, 'note', { message_id: message.id });
  await auditService.record({ actorId: user.id, action: 'support.ticket.message', resourceType: 'support_ticket', resourceId: id, metadata: { internal: Boolean(internal) }, req });
  return message;
}

// Evidence ---------------------------------------------------------------------------------------
export async function uploadEvidence(user, caseId, file, { evidenceType, description, supersedesId }, req) {
  const { ticket, staff } = await ticketFor(user, caseId);
  if (ticket.status === 'closed') throw AppError.conflict('This case is closed', 'TICKET_CLOSED');
  if (supersedesId) {
    const prior = await supportRepo.findEvidence(supersedesId);
    if (!prior || prior.case_id !== caseId) throw AppError.badRequest('The evidence being replaced was not found', 'INVALID_LINK');
  }
  const source = staff ? 'investigator' : ticket.user_id === user.id ? 'complainant' : 'respondent';
  const path = storageService.objectPath(caseId, file.detectedExt);
  await storageService.upload(BUCKETS.disputeEvidence, path, file);
  const row = await supportRepo.insertEvidence({
    case_id: caseId,
    evidence_type: evidenceType,
    source,
    description: description ?? null,
    storage_path: path,
    mime_type: file.detectedMime,
    size_bytes: file.size ?? file.buffer.length,
    sha256: sha256Buffer(file.buffer),
    supersedes_id: supersedesId ?? null,
    uploaded_by: user.id,
  });
  await caseEvent(caseId, user.id, 'evidence_added', { evidence_id: row.id, source, sha256: row.sha256 });
  await auditService.record({ actorId: user.id, action: 'dispute.evidence.upload', resourceType: 'dispute_evidence', resourceId: row.id, metadata: { caseId, sha256: row.sha256 }, req });
  return { id: row.id, sha256: row.sha256, source };
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Staff attach an existing platform record (ledger row, security event, audit entry) as evidence. */
export async function linkRecordEvidence(actor, caseId, { evidenceType, linkedRecordType, linkedRecordId, description }, req) {
  const ticket = await supportRepo.findTicket(caseId);
  if (!ticket) throw AppError.notFound('Case not found');
  const row = await supportRepo.insertEvidence({
    case_id: caseId, evidence_type: evidenceType, source: 'investigator', description: description ?? null,
    linked_record_type: linkedRecordType, linked_record_id: String(linkedRecordId), uploaded_by: actor.id,
    sha256: sha256(`${linkedRecordType}:${linkedRecordId}`),
  });
  await caseEvent(caseId, actor.id, 'evidence_added', { evidence_id: row.id, linked: `${linkedRecordType}:${linkedRecordId}` });
  await auditService.record({ actorId: actor.id, action: 'dispute.evidence.link', resourceType: 'dispute_evidence', resourceId: row.id, metadata: { caseId }, req });
  return row;
}

/**
 * Short-lived link to an evidence file. The uploader can open their own file;
 * anyone else needs disputes.evidence.view and a logged reason.
 */
export async function evidenceUrl(user, evidenceId, reason, req) {
  const e = await supportRepo.findEvidence(evidenceId);
  if (!e || !e.storage_path) throw AppError.notFound('Evidence not found');
  if (e.uploaded_by !== user.id) {
    if (!can(user, 'disputes.evidence.view')) throw AppError.notFound('Evidence not found');
    const ticket = await supportRepo.findTicket(e.case_id);
    await securityService.logDataAccess({
      actor: user, subjectUserId: ticket?.user_id ?? null, resourceType: 'dispute_evidence', resourceId: e.id,
      fields: ['file'], reason, req,
    });
  }
  await auditService.record({ actorId: user.id, action: 'dispute.evidence.view', resourceType: 'dispute_evidence', resourceId: e.id, req });
  return storageService.signedUrl(BUCKETS.disputeEvidence, e.storage_path, 120);
}

// Staff -------------------------------------------------------------------------------
export async function listAll(filters) {
  const result = await supportRepo.listTickets(filters);
  return { items: result.rows.map((t) => format(t)), meta: pageMeta(filters, result.total) };
}

export async function linkTransaction(actor, caseId, { transactionId, note }, req) {
  const ticket = await supportRepo.findTicket(caseId);
  if (!ticket) throw AppError.notFound('Case not found');
  if (!(await paymentRepo.findTransaction(transactionId))) throw AppError.notFound('Transaction not found');
  await supportRepo.linkTransaction({ case_id: caseId, transaction_id: transactionId, linked_by: actor.id, note: note ?? null });
  await caseEvent(caseId, actor.id, 'transaction_linked', { transaction_id: transactionId });
  await auditService.record({ actorId: actor.id, action: 'dispute.transaction.link', resourceType: 'support_ticket', resourceId: caseId, metadata: { transactionId }, req });
}

export async function updateTicket(actor, id, { status, priority, resolution, resolutionOutcome }, req) {
  const ticket = await supportRepo.findTicket(id);
  if (!ticket) throw AppError.notFound('Case not found');
  if ([ticket.user_id, ticket.respondent_user_id].includes(actor.id)) {
    throw AppError.forbidden('You cannot handle a case you are a party to', 'SELF_REVIEW_FORBIDDEN');
  }
  const patch = {};
  if (status) {
    patch.status = status;
    if (status === 'resolved' || status === 'closed') {
      if (!resolution && !ticket.resolution) throw AppError.unprocessable('Record how the case was resolved', 'RESOLUTION_REQUIRED');
      patch.resolved_at = new Date().toISOString();
    }
  }
  if (priority) patch.priority = priority;
  if (resolution !== undefined) patch.resolution = resolution;
  if (resolutionOutcome !== undefined) patch.resolution_outcome = resolutionOutcome;
  const updated = await supportRepo.updateTicket(id, patch);
  if (status && status !== ticket.status) {
    await caseEvent(id, actor.id, ['resolved', 'closed'].includes(status) ? 'resolved' : ticket.status === 'resolved' ? 'reopened' : 'status_changed',
      { from: ticket.status, to: status, outcome: resolutionOutcome ?? null });
  }
  if (priority && priority !== ticket.priority) await caseEvent(id, actor.id, 'priority_changed', { from: ticket.priority, to: priority });
  if (status && status !== ticket.status && ['resolved', 'closed'].includes(status)) {
    for (const uid of [ticket.user_id, ticket.respondent_user_id].filter(Boolean)) {
      await notificationService.notify(uid, {
        type: 'support_resolved', category: 'support', title: 'Case updated',
        body: `Case ${ticket.case_number ?? ticket.reference} has been marked ${status}.`, data: { ticket_id: id }, dedupeKey: `ticket_status:${id}:${status}:${uid}`,
      });
    }
  }
  await auditService.record({ actorId: actor.id, action: 'support.ticket.update', resourceType: 'support_ticket', resourceId: id, metadata: patch, req });
  return format(updated);
}

export async function assign(actor, id, assigneeId, req) {
  const ticket = await supportRepo.findTicket(id);
  if (!ticket) throw AppError.notFound('Case not found');
  const perms = await permissionsForRoles(await userRepo.getRoles(assigneeId));
  if (!CASE_STAFF.some((p) => perms.includes(p))) throw AppError.badRequest('Assignee must be a support or dispute staff member', 'INVALID_ASSIGNEE');
  if ([ticket.user_id, ticket.respondent_user_id].includes(assigneeId)) throw AppError.badRequest('A party to the case cannot handle it', 'INVALID_ASSIGNEE');
  await supportRepo.assign(id, assigneeId, actor.id);
  if (ticket.status === 'open') await supportRepo.updateTicket(id, { status: 'in_progress' });
  await caseEvent(id, actor.id, 'assigned', { assignee_id: assigneeId });
  await auditService.record({ actorId: actor.id, action: 'support.ticket.assign', resourceType: 'support_ticket', resourceId: id, metadata: { assigneeId }, req });
}
