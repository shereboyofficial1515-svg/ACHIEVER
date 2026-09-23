import { Link } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, Banknote, HandCoins, LifeBuoy, Receipt, ShieldAlert, TrendingUp, Users, UsersRound, Zap } from 'lucide-react';
import { Alert, AsyncContent, PageHeader, SkeletonCards, StatCard } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { naira } from '../../utils/format.js';

export default function AdminOverview() {
  const o = useAsync(() => api.get('/admin/overview'), []);
  const d = o.data;
  return (
    <div className="stack-lg">
      <PageHeader title="Platform overview" subtitle="Live figures from the ledger and operational queues" />
      <AsyncContent loading={o.loading} error={o.error} onRetry={o.reload} skeleton={<SkeletonCards count={8} />}>
        {d && (
          <>
            {(d.payouts_pending > 0 || d.pending_verifications > 0 || d.open_risk_flags > 0 || d.pending_refunds > 0) && (
              <Alert tone="warning" icon={AlertTriangle}>
                Needs attention: <Link to="/app/admin/payouts">{d.payouts_pending} payout(s)</Link> · <Link to="/app/admin/verification">{d.pending_verifications} verification(s)</Link> ·{' '}
                <Link to="/app/admin/risk">{d.open_risk_flags} review case(s)</Link> · {d.pending_refunds} refund(s) in progress
              </Alert>
            )}
            <div className="grid-4">
              <StatCard accent icon={Users} label="Total users" value={d.total_users} sub={`${d.active_users_30d} active in 30 days · ${d.suspended_users} suspended`} />
              <StatCard icon={UsersRound} label="Osusu groups" value={d.osusu_groups_total} sub={`${d.osusu_groups_active} active`} />
              <StatCard icon={HandCoins} label="Active collectors" value={d.collector_accounts_active} sub={`${d.savings_plans_active} live savings plans`} />
              <StatCard icon={TrendingUp} label="Contributions" value={naira(d.contributions_total)} sub="Verified, all time" />
              <StatCard icon={Banknote} label="Payouts & returns" value={naira(d.payouts_total)} sub={`${d.payouts_pending} pending execution`} />
              <StatCard icon={Zap} label="Bill payments" value={naira(d.bill_payments_total)} sub={`${d.bill_payments_count} delivered · ${d.failed_bills_7d} failed (7d)`} />
              <StatCard icon={Receipt} label="Failed payments (7d)" value={d.failed_payments_7d} />
              <StatCard icon={TrendingUp} label="Collector commissions" value={naira(d.commission_total)} />
              <StatCard icon={BadgeCheck} label="Pending verification" value={d.pending_verifications} />
              <StatCard icon={LifeBuoy} label="Open support cases" value={d.open_tickets} />
              <StatCard icon={ShieldAlert} label="Risk / review cases" value={d.open_risk_flags} />
            </div>
          </>
        )}
      </AsyncContent>
    </div>
  );
}
