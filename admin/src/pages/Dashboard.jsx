import { Link } from 'react-router-dom';
import { AsyncContent, Card, PageHeader, SkeletonCards } from '../components/ui/index.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api } from '../services/api.js';
import { naira } from '../utils/format.js';

function Metric({ label, value, to, attention }) {
  const body = (
    <>
      <div className="label">{label}</div>
      <div className="value">{value ?? '—'}</div>
    </>
  );
  const cls = `metric ${attention ? 'attention' : ''}`;
  return to ? <Link className={cls} to={to}>{body}</Link> : <div className={cls}>{body}</div>;
}

/**
 * Operations dashboard. All figures are aggregate counts computed in the
 * database (no personal data, no row downloads).
 */
export default function Dashboard() {
  const { can } = useAuth();
  const d = useAsync(() => api.get('/admin/dashboard'), []);
  const m = d.data?.metrics;
  const o = d.data?.overview;
  return (
    <div className="stack-lg">
      <PageHeader title="Operations dashboard" subtitle="Aggregated figures; open a queue to work on it" />
      <AsyncContent loading={d.loading} error={d.error} onRetry={d.reload} skeleton={<SkeletonCards count={8} />}>
        {m && (
          <>
            <Card title="Queues needing attention">
              <div className="metric-grid">
                <Metric label="KYC reviews" value={m.kyc_review_queue} to={can('kyc.review') ? '/verification' : undefined} attention={m.kyc_review_queue > 0} />
                <Metric label="Payouts queued" value={m.payouts_queued} to={can('finance.payouts.execute') ? '/payouts' : undefined} attention={m.payouts_queued > 0} />
                <Metric label="Pending approvals" value={m.approvals_pending} to="/approvals" attention={m.approvals_pending > 0} />
                <Metric label="Open cases" value={m.tickets_open} to={can('support.tickets', 'disputes.manage') ? '/support' : undefined} />
                <Metric label="Financial disputes" value={m.cases_open} to={can('disputes.manage') ? '/support' : undefined} attention={m.cases_open > 0} />
                <Metric label="Security events" value={m.security_events_open} to={can('security.events.read') ? '/compliance' : undefined} attention={m.security_events_open > 0} />
                <Metric label="Risk reviews" value={m.risk_flags_open} to={can('risk.review') ? '/risk' : undefined} />
                <Metric label="Deletion requests" value={m.deletion_requests_open} to={can('privacy.requests.manage') ? '/privacy' : undefined} />
              </div>
            </Card>
            <Card title="Users">
              <div className="metric-grid">
                <Metric label="Users" value={m.users} to={can('users.read') ? '/users' : undefined} />
                <Metric label="Active (30 days)" value={m.active_users_30d} />
                <Metric label="Pending verification" value={m.pending_verification} />
                <Metric label="KYC verified (level 2+)" value={m.kyc_verified} />
                <Metric label="Restricted / suspended" value={m.restricted_users} />
              </div>
            </Card>
            <Card title="Money">
              <div className="metric-grid">
                <Metric label="Osusu groups (open)" value={m.osusu_groups_active} to="/groups" />
                <Metric label="Active collectors" value={m.collectors_active} to="/collectors" />
                <Metric label="Transactions (24h)" value={m.transactions_24h} to={can('finance.ledger.read') ? '/transactions' : undefined} />
                <Metric label="Volume (30 days)" value={naira(m.volume_30d_kobo)} />
                <Metric label="Payments pending" value={m.payments_pending} />
                <Metric label="Failed payments (24h)" value={m.payments_failed_24h} attention={m.payments_failed_24h > 0} />
                {o && <Metric label="Contributions (all time)" value={naira(o.contributions_total)} />}
                {o && <Metric label="Payouts & returns (all time)" value={naira(o.payouts_total)} />}
              </div>
            </Card>
          </>
        )}
      </AsyncContent>
    </div>
  );
}
