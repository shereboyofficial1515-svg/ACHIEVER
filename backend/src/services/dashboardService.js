import { ROLES } from '../config/constants.js';
import * as osusuRepo from '../repositories/osusuRepository.js';
import * as paymentRepo from '../repositories/paymentRepository.js';
import * as collectorRepo from '../repositories/collectorRepository.js';
import * as collectorService from './collectorService.js';
import * as onboardingService from './onboardingService.js';

/**
 * Role-aware home dashboard. Every figure is computed on the server from the
 * ledger and cycle tables — the client only renders.
 */
export async function forUser(user) {
  const roles = user.roles;
  const [memberships, adminGroups, recent, pendingContribs, upcomingPayouts] = await Promise.all([
    osusuRepo.listMemberships(user.id),
    roles.includes(ROLES.OSUSU_ADMIN) ? osusuRepo.listGroups({ adminId: user.id, page: 1, pageSize: 50 }) : { rows: [] },
    paymentRepo.listTransactions({ userId: user.id, page: 1, pageSize: 6 }),
    osusuRepo.listContributions({ userId: user.id, statuses: ['pending', 'overdue'], page: 1, pageSize: 100 }),
    osusuRepo.upcomingPayoutsForUser(user.id),
  ]);

  const openContributions = pendingContribs.rows.filter((c) => c.status !== 'paid');
  const nextDue = [...openContributions].sort((a, b) => a.due_date.localeCompare(b.due_date))[0] || null;

  const totalContributed = await paymentRepo.sumTransactions({ userId: user.id, types: ['osusu_contribution', 'collector_savings'] });
  const totalReceived = await paymentRepo.sumTransactions({ userId: user.id, types: ['osusu_payout', 'saver_return'] });

  const plans = roles.includes(ROLES.SAVER) ? await collectorRepo.listPlans({ saverId: user.id, page: 1, pageSize: 50 }) : { rows: [] };
  const savingsBalance = plans.rows
    .filter((p) => ['active', 'matured', 'return_requested', 'return_processing'].includes(p.status))
    .reduce((s, p) => s + Number(p.balance), 0);

  const result = {
    member: {
      totalContributed,
      totalReceived,
      savingsBalance,
      activeGroups: memberships.filter((m) => m.status === 'active').length,
      overdueCount: openContributions.filter((c) => c.status === 'overdue').length,
      nextDue: nextDue
        ? { contributionId: nextDue.id, groupId: nextDue.group_id, groupName: nextDue.group?.name, amount: Number(nextDue.amount), dueDate: nextDue.due_date, status: nextDue.status, cycleNumber: nextDue.cycle_number }
        : null,
      upcomingPayout: upcomingPayouts[0]
        ? {
            groupId: upcomingPayouts[0].group_id,
            groupName: upcomingPayouts[0].group?.name,
            cycleNumber: upcomingPayouts[0].cycle_number,
            amount: Number(upcomingPayouts[0].amount),
            dueDate: upcomingPayouts[0].cycle?.due_date,
            status: upcomingPayouts[0].status,
          }
        : null,
      openContributions: openContributions.slice(0, 5).map((c) => ({
        id: c.id, groupId: c.group_id, groupName: c.group?.name, amount: Number(c.amount), dueDate: c.due_date, status: c.status, cycleNumber: c.cycle_number,
      })),
      plans: plans.rows.slice(0, 5).map((p) => collectorService.formatPlan(p, user.id)),
    },
    recentTransactions: recent.rows.map((t) => ({
      id: t.id, reference: t.reference, type: t.type, direction: t.direction, amount: Number(t.amount), status: t.status, description: t.description, createdAt: t.created_at,
    })),
  };

  if (roles.includes(ROLES.OSUSU_ADMIN)) {
    const active = adminGroups.rows.filter((g) => g.status === 'active');
    const summaries = await Promise.all(active.map((g) => osusuRepo.groupSummary(g.id)));
    result.organiser = {
      groups: adminGroups.rows.length,
      activeGroups: active.length,
      totalMembers: summaries.reduce((s, x) => s + Number(x?.active_members || 0), 0),
      expected: summaries.reduce((s, x) => s + Number(x?.current_cycle?.expected_amount || 0), 0),
      collected: summaries.reduce((s, x) => s + Number(x?.current_cycle?.collected_amount || 0), 0),
      outstanding: summaries.reduce((s, x) => s + Number(x?.current_cycle?.outstanding_amount || 0), 0),
      membersUnderReview: summaries.reduce((s, x) => s + Number(x?.members_under_review || 0), 0),
      groupsSummary: active.map((g, i) => ({
        id: g.id,
        name: g.name,
        currentCycle: summaries[i]?.current_cycle,
        nextCycle: summaries[i]?.next_cycle,
        overdue: summaries[i]?.overdue_contributions,
      })),
    };
  }
  if (roles.includes(ROLES.COLLECTOR)) {
    result.collector = await collectorService.dashboard(user);
  }
  const onboarding = await onboardingService.getStatus(user.id);
  result.onboarding = { operators: onboarding.operators, phoneVerified: onboarding.phoneVerified, identity: onboarding.identity };
  return result;
}
