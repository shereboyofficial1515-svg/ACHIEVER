import { ROLES } from '../config/constants.js';
import * as osusuRepo from '../repositories/osusuRepository.js';
import * as paymentRepo from '../repositories/paymentRepository.js';
import * as collectorRepo from '../repositories/collectorRepository.js';
import * as collectorService from './collectorService.js';
import * as onboardingService from './onboardingService.js';
import * as referralRepo from '../repositories/referralRepository.js';
import * as storageService from './storageService.js';
import { BUCKETS } from '../config/constants.js';

/**
 * Role-aware home dashboard. Every figure is computed on the server from the
 * ledger and cycle tables — the client only renders.
 */
export async function forUser(user) {
  const roles = user.roles;
  // Independent reads run concurrently: each is a network round-trip to Supabase.
  const adminGroupsPromise = roles.includes(ROLES.OSUSU_ADMIN)
    ? osusuRepo.listGroups({ adminId: user.id, page: 1, pageSize: 50 })
    : Promise.resolve({ rows: [] });
  // Group summaries depend only on the admin group list; start them as soon as it arrives.
  const summariesPromise = adminGroupsPromise.then((g) =>
    Promise.all(g.rows.filter((x) => x.status === 'active').map((x) => osusuRepo.groupSummary(x.id))));
  const [memberships, adminGroups, recent, pendingContribs, upcomingPayouts, totalContributed, totalReceived, plans, collectorDash, onboarding, summaries] = await Promise.all([
    osusuRepo.listMemberships(user.id),
    adminGroupsPromise,
    paymentRepo.listTransactions({ userId: user.id, page: 1, pageSize: 6 }),
    osusuRepo.listContributions({ userId: user.id, statuses: ['pending', 'overdue'], page: 1, pageSize: 100 }),
    osusuRepo.upcomingPayoutsForUser(user.id),
    paymentRepo.sumTransactions({ userId: user.id, types: ['osusu_contribution', 'collector_savings'] }),
    paymentRepo.sumTransactions({ userId: user.id, types: ['osusu_payout', 'saver_return'] }),
    roles.includes(ROLES.SAVER) ? collectorRepo.listPlans({ saverId: user.id, page: 1, pageSize: 50 }) : Promise.resolve({ rows: [] }),
    roles.includes(ROLES.COLLECTOR) ? collectorService.dashboard(user) : Promise.resolve(null),
    onboardingService.getStatus(user.id),
    summariesPromise,
  ]);

  const openContributions = pendingContribs.rows.filter((c) => c.status !== 'paid');
  const nextDue = [...openContributions].sort((a, b) => a.due_date.localeCompare(b.due_date))[0] || null;

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
    result.collector = collectorDash;
  }
  result.onboarding = { operators: onboarding.operators, phoneVerified: onboarding.phoneVerified, phoneVerification: onboarding.phoneVerification, identity: onboarding.identity };
  return result;
}


/**
 * Everything My Profile shows, in ONE request (instead of a request per card):
 * statistics, verification and up to five OSUSU groups. Four reads run concurrently.
 * The wallet balance is NOT included: it comes from GET /wallet (never cached, server-authoritative).
 */
export async function profileSummary(user) {
  const { trustProfile } = await import('./profileService.js');
  const [trust, memberships, adminGroups, referrals] = await Promise.all([
    trustProfile(user.id),
    osusuRepo.listMemberships(user.id),
    osusuRepo.listGroups({ adminId: user.id, page: 1, pageSize: 50 }),
    referralRepo.countForReferrer(user.id),
  ]);
  const ids = [...new Set([...memberships.map((m) => m.group_id), ...adminGroups.rows.map((g) => g.id)])];
  const groups = ids.length ? (await osusuRepo.listGroups({ ids, page: 1, pageSize: 5 })).rows : [];
  const total = ids.length;
  return {
    stats: {
      groups: total,
      completedGroups: trust.completedGroups,
      contributions: trust.contributionsPaid,
      onTimeRate: trust.onTimeRate,
      referrals,
    },
    verification: trust.verification,
    memberSince: trust.memberSince,
    location: trust.location,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      imageUrl: storageService.publicUrl(BUCKETS.groupImages, g.image_path),
      contributionAmount: Number(g.contribution_amount),
      frequency: g.frequency,
      status: g.status,
      isAdmin: g.admin_id === user.id,
    })),
  };
}
