import * as paymentRepo from '../repositories/paymentRepository.js';
import * as supportRepo from '../repositories/supportRepository.js';
import * as securityRepo from '../repositories/securityRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as auditRepo from '../repositories/auditRepository.js';
import * as collectorRepo from '../repositories/collectorRepository.js';
import * as osusuRepo from '../repositories/osusuRepository.js';
import * as disbursementRepo from '../repositories/disbursementRepository.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { maskIp } from './sessionService.js';

/**
 * Traceability graph: reconstructs who / what / when / how / where-to for a
 * ledger entry or a dispute case, from records that already exist. Nothing is
 * inferred; each node carries the id of the record it came from.
 */
const DISBURSEMENT_KEYS = { osusu_payout: 'payout_id', saver_return: 'return_id', commission: 'commission_id' };

function person(p) {
  return p ? { id: p.id, name: p.full_name, email: p.email } : null;
}

async function sessionNode(sessionId) {
  if (!sessionId) return null;
  const s = await securityRepo.findSession(sessionId);
  return s ? { id: s.id, createdAt: s.created_at, deviceId: s.device_id, revokedAt: s.revoked_at } : null;
}

export async function transactionTrace(actor, id, req) {
  const tx = await paymentRepo.findTransaction(id);
  if (!tx) throw AppError.notFound('Transaction not found');

  const [owner, related, attempt, cases, events, audit] = await Promise.all([
    userRepo.findById(tx.user_id),
    paymentRepo.relatedTransactions(tx.id),
    paymentRepo.findAttemptForTransaction(tx),
    supportRepo.casesForTransaction(tx.id),
    securityRepo.listSecurityEvents({ relatedTransactionId: tx.id, page: 1, pageSize: 50 }).then((r) => r.rows),
    auditRepo.list({ resourceType: 'transaction', resourceId: tx.id, page: 1, pageSize: 50 }).then((r) => r.rows),
  ]);
  const original = tx.related_transaction_id ? await paymentRepo.findTransaction(tx.related_transaction_id) : null;
  const [collector, counterparty, createdBy, session] = await Promise.all([
    tx.collector_id ? userRepo.findById(tx.collector_id) : null,
    tx.counterparty_user_id ? userRepo.findById(tx.counterparty_user_id) : null,
    tx.created_by ? userRepo.findById(tx.created_by) : null,
    sessionNode(tx.session_id ?? attempt?.session_id),
  ]);
  const group = tx.group_id ? await osusuRepo.findGroup(tx.group_id) : null;
  const plan = tx.collector_saver_id ? await collectorRepo.findPlan(tx.collector_saver_id) : null;
  const disbursementKey = DISBURSEMENT_KEYS[tx.type];
  const disbursement = disbursementKey && tx.metadata?.[disbursementKey] ? await disbursementRepo.find(tx.type, tx.metadata[disbursementKey]) : null;

  await auditService.record({ actorId: actor.id, action: 'trace.transaction', resourceType: 'transaction', resourceId: tx.id, req });
  return {
    transaction: tx,
    who: { owner: person(owner), collector: person(collector), counterparty: person(counterparty), createdBy: person(createdBy) },
    how: {
      provider: tx.provider,
      channel: tx.channel ?? attempt?.channel ?? null,
      paymentAttempt: attempt,
      session,
    },
    context: {
      group: group ? { id: group.id, name: group.name } : null,
      plan: plan ? { id: plan.id, name: plan.plan_name, collectorAccountId: plan.collector_account_id } : null,
    },
    destination: tx.destination_last4
      ? { bankName: tx.destination_bank_name, last4: tx.destination_last4 }
      : disbursement?.destination ?? null,
    disbursement: disbursement ? { kind: disbursement.kind, id: disbursement.id, status: disbursement.status, reference: disbursement.reference, holdReason: disbursement.holdReason } : null,
    corrections: { original, related },
    disputes: cases,
    securityEvents: events,
    auditTrail: audit,
  };
}

export async function caseTrace(actor, caseId, req) {
  const ticket = await supportRepo.findTicket(caseId);
  if (!ticket) throw AppError.notFound('Case not found');
  const [linked, events, evidence] = await Promise.all([
    supportRepo.caseTransactions(caseId),
    supportRepo.caseEvents(caseId),
    supportRepo.listEvidence(caseId),
  ]);
  const txIds = new Set(linked.map((l) => l.transaction_id));
  if (ticket.related_transaction_id) txIds.add(ticket.related_transaction_id);
  const transactions = [];
  for (const id of txIds) {
    const tx = await paymentRepo.findTransaction(id);
    if (tx) transactions.push(tx);
  }
  const [respondent, collector] = await Promise.all([
    ticket.respondent_user_id ? userRepo.findById(ticket.respondent_user_id) : null,
    ticket.collector_id ? userRepo.findById(ticket.collector_id) : null,
  ]);
  await auditService.record({ actorId: actor.id, action: 'trace.case', resourceType: 'support_ticket', resourceId: caseId, req });
  return {
    case: {
      id: ticket.id, caseNumber: ticket.case_number, category: ticket.category, status: ticket.status,
      amount: ticket.amount, resolutionOutcome: ticket.resolution_outcome, createdAt: ticket.created_at,
    },
    complainant: ticket.user ? { id: ticket.user.id, name: ticket.user.full_name, email: ticket.user.email } : null,
    respondent: person(respondent),
    collector: person(collector),
    transactions,
    timeline: events,
    evidence: evidence.map(({ storage_path: path, ...e }) => ({ ...e, hasFile: Boolean(path) })),
  };
}

export async function userSessionsForStaff(userId) {
  const rows = await securityRepo.listSessions(userId, { activeOnly: false, limit: 100 });
  return rows.map((s) => ({ ...s, ip_address: maskIp(s.ip_address) }));
}
