/**
 * Schema/query consistency check against the configured Supabase project.
 * Runs every repository READ query (and read-only RPCs) with placeholder IDs
 * and reports PostgREST/Postgres errors such as unknown columns, ambiguous
 * embeddings or missing privileges. Performs no writes.
 *
 *   npm run check:queries
 */
import * as userRepo from '../src/repositories/userRepository.js';
import * as osusuRepo from '../src/repositories/osusuRepository.js';
import * as collectorRepo from '../src/repositories/collectorRepository.js';
import * as paymentRepo from '../src/repositories/paymentRepository.js';
import * as notificationRepo from '../src/repositories/notificationRepository.js';
import * as messageRepo from '../src/repositories/messageRepository.js';
import * as callRepo from '../src/repositories/callRepository.js';
import * as meetingRepo from '../src/repositories/meetingRepository.js';
import * as billRepo from '../src/repositories/billRepository.js';
import * as verificationRepo from '../src/repositories/verificationRepository.js';
import * as supportRepo from '../src/repositories/supportRepository.js';
import * as inviteRepo from '../src/repositories/inviteRepository.js';
import * as disbursementRepo from '../src/repositories/disbursementRepository.js';
import * as riskRepo from '../src/repositories/riskRepository.js';
import * as auditRepo from '../src/repositories/auditRepository.js';
import * as settingsRepo from '../src/repositories/settingsRepository.js';
import * as securityRepo from '../src/repositories/securityRepository.js';
import * as complianceRepo from '../src/repositories/complianceRepository.js';
import { rpc } from '../src/integrations/supabase/db.js';

const ID = '00000000-0000-0000-0000-000000000000';
const P = { page: 1, pageSize: 5 };

const checks = {
  'user.findById': () => userRepo.findById(ID),
  'user.findByEmail': () => userRepo.findByEmail('nobody@example.com'),
  'user.findByPhone': () => userRepo.findByPhone('+2348000000000'),
  'user.findManyBasic': () => userRepo.findManyBasic([ID]),
  'user.getRoles': () => userRepo.getRoles(ID),
  'user.search': () => userRepo.search({ ...P, search: 'a' }),
  'user.search(role)': () => userRepo.search({ ...P, role: 'SAVER' }),
  'user.listByRole': () => userRepo.listByRole('SAVER'),
  'user.listAllIds': () => userRepo.listAllIds({ from: 0, to: 4 }),
  'user.getPayoutAccount': () => userRepo.getPayoutAccount(ID),
  'user.getPreferences': () => userRepo.getPreferences(ID),
  'osusu.findGroup': () => osusuRepo.findGroup(ID),
  'osusu.findGroupByCode': () => osusuRepo.findGroupByCode('ABCDEFGH'),
  'osusu.listGroups(ids)': () => osusuRepo.listGroups({ ...P, ids: [ID], search: 'a', status: 'active' }),
  'osusu.listGroups(admin)': () => osusuRepo.listGroups({ ...P, adminId: ID }),
  'osusu.listAllGroupsForAdmin': () => osusuRepo.listAllGroupsForAdmin({ ...P, search: 'a' }),
  'osusu.findMembership': () => osusuRepo.findMembership(ID, ID),
  'osusu.findMember': () => osusuRepo.findMember(ID),
  'osusu.listMemberships': () => osusuRepo.listMemberships(ID),
  'osusu.listMembers': () => osusuRepo.listMembers(ID, { statuses: ['active'] }),
  'osusu.listCycles': () => osusuRepo.listCycles(ID),
  'osusu.findCycle': () => osusuRepo.findCycle(ID),
  'osusu.listCycleContributions': () => osusuRepo.listCycleContributions(ID),
  'osusu.listContributions': () => osusuRepo.listContributions({ ...P, groupId: ID, userId: ID, statuses: ['pending', 'overdue'] }),
  'osusu.findContribution': () => osusuRepo.findContribution(ID),
  'osusu.listPayouts': () => osusuRepo.listPayouts(ID),
  'osusu.findPayoutByCycle': () => osusuRepo.findPayoutByCycle(ID),
  'osusu.groupTransactions': () => osusuRepo.groupTransactions(ID),
  'osusu.riskMembers': () => osusuRepo.riskMembers(ID),
  'osusu.openRiskFlags': () => osusuRepo.openRiskFlags(ID),
  'osusu.upcomingPayoutsForUser': () => osusuRepo.upcomingPayoutsForUser(ID),
  'rpc.osusu_group_summary': () => osusuRepo.groupSummary(ID),
  'collector.findAccountByCollector': () => collectorRepo.findAccountByCollector(ID),
  'collector.findAccount': () => collectorRepo.findAccount(ID),
  'collector.listAccountsForAdmin': () => collectorRepo.listAccountsForAdmin({ ...P, search: 'a' }),
  'collector.findPlan': () => collectorRepo.findPlan(ID),
  'collector.listPlans': () => collectorRepo.listPlans({ ...P, collectorId: ID }),
  'collector.listPlans(search)': () => collectorRepo.listPlans({ ...P, collectorId: ID, search: 'a' }),
  'collector.collectorStats': () => collectorRepo.collectorStats(ID),
  'collector.listPlanContributions': () => collectorRepo.listPlanContributions(ID, P),
  'collector.listReturns': () => collectorRepo.listReturns({ ...P, collectorId: ID }),
  'collector.findOpenReturn': () => collectorRepo.findOpenReturn(ID),
  'collector.findReturn': () => collectorRepo.findReturn(ID),
  'collector.listCommissions': () => collectorRepo.listCommissions(ID),
  'payment.findAttemptByReference': () => paymentRepo.findAttemptByReference('ACH-PAY-X'),
  'payment.findOpenAttempt': () => paymentRepo.findOpenAttempt({ userId: ID, purpose: 'bill_payment', targetId: ID, amount: 100, since: new Date().toISOString() }),
  'payment.listStaleAttempts': () => paymentRepo.listStaleAttempts({ olderThan: new Date().toISOString(), newerThan: '2020-01-01T00:00:00Z' }),
  'payment.listAttempts': () => paymentRepo.listAttempts({ ...P, search: 'a' }),
  'payment.listRetryableWebhooks': () => paymentRepo.listRetryableWebhooks(),
  'payment.listTransactions': () => paymentRepo.listTransactions({ ...P, userId: ID, search: 'a', withUser: true }),
  'payment.findTransaction': () => paymentRepo.findTransaction(ID),
  'payment.findRefund(provider)': () => paymentRepo.findRefund({ providerReference: '1' }),
  'payment.findRefund(payment)': () => paymentRepo.findRefund({ paymentReference: 'X' }),
  'payment.listPendingRefunds': () => paymentRepo.listPendingRefunds({ olderThan: new Date().toISOString() }),
  'payment.sumTransactions': () => paymentRepo.sumTransactions({ userId: ID, types: ['osusu_contribution'] }),
  'notification.list': () => notificationRepo.list(ID, { ...P, unreadOnly: true }),
  'notification.unreadCount': () => notificationRepo.unreadCount(ID),
  'notification.listOutbox': () => notificationRepo.listOutbox(5),
  'notification.countSmsSentToday': () => notificationRepo.countSmsSentToday(ID, new Date().toISOString()),
  'rpc.conversation_summaries': () => messageRepo.summaries(ID),
  'message.findConversation': () => messageRepo.findConversation(ID),
  'message.findByGroup': () => messageRepo.findByGroup(ID),
  'message.findByPlan': () => messageRepo.findByPlan(ID),
  'message.findByDirectKey': () => messageRepo.findByDirectKey('x'),
  'message.findMembership': () => messageRepo.findMembership(ID, ID),
  'message.listMembers': () => messageRepo.listMembers(ID),
  'message.listMessages': () => messageRepo.listMessages(ID, { limit: 5, before: new Date().toISOString() }),
  'message.findMessage': () => messageRepo.findMessage(ID),
  'message.findAttachment': () => messageRepo.findAttachment(ID),
  'message.contactIds': () => messageRepo.contactIds(ID),
  'call.findCall': () => callRepo.findCall(ID),
  'call.findCallByRoom': () => callRepo.findCallByRoom('x'),
  'call.findLiveCall': () => callRepo.findLiveCall(ID),
  'call.findParticipant': () => callRepo.findParticipant(ID, ID),
  'call.listParticipants': () => callRepo.listParticipants(ID),
  'call.history': () => callRepo.history(ID),
  'meeting.find': () => meetingRepo.find(ID),
  'meeting.listForGroups': () => meetingRepo.listForGroups([ID], { upcomingOnly: true }),
  'meeting.findByCall': () => meetingRepo.findByCall(ID),
  'bill.find': () => billRepo.find(ID),
  'bill.list': () => billRepo.list({ ...P, search: 'a', withUser: true }),
  'bill.listDueForRequery': () => billRepo.listDueForRequery(),
  'bill.listPaidNotDispatched': () => billRepo.listPaidNotDispatched(new Date().toISOString()),
  'verification.latestForUser': () => verificationRepo.latestForUser(ID),
  'verification.identityUsedByOther': () => verificationRepo.identityUsedByOther('nin', 'x', ID),
  'verification.find': () => verificationRepo.find(ID),
  'verification.list': () => verificationRepo.list({ ...P, status: 'manual_review' }),
  'verification.undertakingsForUser': () => verificationRepo.undertakingsForUser(ID),
  'support.findTicket': () => supportRepo.findTicket(ID),
  'support.listTickets': () => supportRepo.listTickets({ ...P, search: 'a' }),
  'support.listTickets(assignee)': () => supportRepo.listTickets({ ...P, assigneeId: ID }),
  'support.listMessages': () => supportRepo.listMessages(ID, { includeInternal: true }),
  'support.recentComplaintsAgainstCollector': () => supportRepo.recentComplaintsAgainstCollector(ID, new Date().toISOString()),
  'invite.findByTokenHash': () => inviteRepo.findByTokenHash('x'),
  'invite.find': () => inviteRepo.find(ID),
  'invite.listForGroup': () => inviteRepo.listForGroup(ID),
  'invite.listForCollectorAccount': () => inviteRepo.listForCollectorAccount(ID),
  'disbursement.osusu_payout': () => disbursementRepo.listByStatus('osusu_payout', ['approved']),
  'disbursement.saver_return': () => disbursementRepo.listByStatus('saver_return', ['approved']),
  'disbursement.commission': () => disbursementRepo.listByStatus('commission', ['accrued']),
  'disbursement.findByReference': () => disbursementRepo.findByReference('osusu_payout', 'ACH-PO-X'),
  'risk.list': () => riskRepo.list(P),
  'risk.find': () => riskRepo.find(ID),
  'risk.openForUser': () => riskRepo.openForUser(ID),
  'audit.list': () => auditRepo.list({ ...P, action: 'auth' }),
  'settings.getAll': () => settingsRepo.getAll(),
  'settings.get': () => settingsRepo.get('platform.maintenance_mode'),
  'rpc.platform_overview': () => rpc('platform_overview'),
  // Identity, security & compliance (migrations 006-007)
  'user.findWithLocation': () => userRepo.findWithLocation(ID),
  'user.openObligations': () => userRepo.openObligations(ID),
  'payment.findAttemptForTransaction': () => paymentRepo.findAttemptForTransaction({ provider: 'paystack', provider_reference: 'X' }),
  'payment.relatedTransactions': () => paymentRepo.relatedTransactions(ID),
  'support.caseTransactions': () => supportRepo.caseTransactions(ID),
  'support.casesForTransaction': () => supportRepo.casesForTransaction(ID),
  'support.caseEvents': () => supportRepo.caseEvents(ID),
  'support.listEvidence': () => supportRepo.listEvidence(ID),
  'support.countCasesAgainst': () => supportRepo.countCasesAgainst(ID, new Date().toISOString()),
  'support.listTickets(party)': () => supportRepo.listTickets({ ...P, partyId: ID, search: 'CASE' }),
  'security.listRolePermissions': () => securityRepo.listRolePermissions(),
  'security.findDevice': () => securityRepo.findDevice(ID, 'x'),
  'security.countDevices': () => securityRepo.countDevices(ID),
  'security.findSession': () => securityRepo.findSession(ID),
  'security.listSessions': () => securityRepo.listSessions(ID, { activeOnly: false }),
  'security.listSecurityEvents': () => securityRepo.listSecurityEvents({ ...P, userId: ID, relatedTransactionId: ID }),
  'security.countRecentSecurityEvents': () => securityRepo.countRecentSecurityEvents(ID, 'new_device', new Date().toISOString()),
  'security.listAccountChanges': () => securityRepo.listAccountChanges(ID),
  'security.listDataAccess': () => securityRepo.listDataAccess({ ...P, actorId: ID }),
  'compliance.listStates': () => complianceRepo.listStates(),
  'compliance.listLgas': () => complianceRepo.listLgas('LA'),
  'compliance.findLga': () => complianceRepo.findLga(1),
  'compliance.getKyc': () => complianceRepo.getKyc(ID),
  'compliance.listKycEvents': () => complianceRepo.listKycEvents(ID),
  'compliance.listKyc': () => complianceRepo.listKyc(P),
  'compliance.getRiskFactors': () => complianceRepo.getRiskFactors(ID),
  'compliance.getRiskProfile': () => complianceRepo.getRiskProfile(ID),
  'compliance.listRiskProfiles': () => complianceRepo.listRiskProfiles(P),
  'compliance.listPaymentAccountChanges': () => complianceRepo.listPaymentAccountChanges(ID),
  'compliance.findApproval': () => complianceRepo.findApproval(ID),
  'compliance.findOpenApproval': () => complianceRepo.findOpenApproval('collector_revoke', ID),
  'compliance.listApprovals': () => complianceRepo.listApprovals(P),
  'compliance.collectorHistory': () => complianceRepo.collectorHistory(ID),
  'compliance.collectorTrustStats': () => complianceRepo.collectorTrustStats(ID),
  'compliance.userTrustProfile': () => complianceRepo.userTrustProfile(ID),
  'compliance.memberStats': () => complianceRepo.memberStats(ID, ID),
  'rpc.compliance_overview': () => complianceRepo.complianceOverview(),
};

let failed = 0;
for (const [name, fn] of Object.entries(checks)) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}: ${err.code || ''} ${err.message}`);
  }
}
console.log(`\n${Object.keys(checks).length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
