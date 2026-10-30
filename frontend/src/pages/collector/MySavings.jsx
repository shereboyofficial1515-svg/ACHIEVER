import { Link } from 'react-router-dom';
import { CalendarClock, PiggyBank } from 'lucide-react';
import { AsyncContent, EmptyState, PageHeader, ProgressBar, Skeleton, StatusBadge } from '../../components/ui/index.js';
import PullToRefresh, { reloadAll } from '../../components/PullToRefresh.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { FREQUENCY_LABEL, formatDate, naira } from '../../utils/format.js';

const LIVE = ['active', 'matured', 'return_requested', 'return_processing'];

/** Share of the plan's term that has passed (dates only; says nothing about returns). */
function termProgress(p) {
  const start = Date.parse(p.startDate);
  const end = Date.parse(p.endDate);
  if (!start || !end || end <= start) return null;
  const total = Math.round((end - start) / 86400000);
  return { done: Math.min(total, Math.max(0, total - (p.daysRemaining ?? 0))), total };
}

function PlanCard({ p }) {
  const term = termProgress(p);
  return (
    <Link to={`/app/collector/plans/${p.id}`} className="group-card">
      <div className="group-card-head">
        <span className="list-icon"><PiggyBank size={18} aria-hidden /></span>
        <div className="grow">
          <p className="group-card-name">{p.planName}</p>
          <p className="xsmall muted truncate">{p.businessName || p.collector?.name} · {FREQUENCY_LABEL[p.frequency]}</p>
        </div>
        <StatusBadge status={p.status} />
      </div>
      <div className="group-card-terms">
        <div>
          <span className="eyebrow">Balance</span>
          <p className="group-card-amount">{naira(p.balance)}</p>
          <span className="xsmall muted">{naira(p.totalContributed)} saved in total</span>
        </div>
        <div>
          <span className="eyebrow">Expected return</span>
          <p className="group-card-amount">{naira(p.expectedReturn)}</p>
          <span className="xsmall muted">After the agreed commission</span>
        </div>
      </div>
      {term && p.status === 'active' ? (
        <div className="group-card-progress">
          <div className="row-between xsmall muted">
            <span>Term: {p.daysRemaining} day{p.daysRemaining === 1 ? '' : 's'} left</span>
            <span>Matures {formatDate(p.endDate)}</span>
          </div>
          <ProgressBar value={term.done} max={term.total} label={`${p.planName} term progress`} />
        </div>
      ) : (
        <p className="group-card-foot xsmall muted"><CalendarClock size={14} aria-hidden /> {p.status === 'matured' ? 'Matured: you can request your return' : `Ends ${formatDate(p.endDate)}`}</p>
      )}
    </Link>
  );
}

export default function MySavings() {
  const plans = useAsync(() => api.get('/collector/plans/mine', { pageSize: 50 }), []);
  const live = (plans.data || []).filter((p) => LIVE.includes(p.status));
  const ended = (plans.data || []).filter((p) => !LIVE.includes(p.status));
  return (
    <PullToRefresh onRefresh={() => reloadAll(plans)}>
      <div className="stack-lg">
        <PageHeader title="My savings" subtitle="Individual savings plans you hold with approved collectors. Separate from your Osusu groups and your wallet." />
        {plans.data && live.length > 0 && (
          <section className="card overview" aria-label="Savings summary">
            <div className="overview-grid">
              <div className="overview-cell">
                <span className="overview-label">Total balance</span>
                <span className="overview-value">{naira(live.reduce((s, p) => s + p.balance, 0))}</span>
                <span className="overview-sub">{live.length} open plan{live.length === 1 ? '' : 's'}</span>
              </div>
              <div className="overview-cell">
                <span className="overview-label">Expected return</span>
                <span className="overview-value">{naira(live.reduce((s, p) => s + p.expectedReturn, 0))}</span>
                <span className="overview-sub">After agreed commission</span>
              </div>
              <div className="overview-cell">
                <span className="overview-label">Matured</span>
                <span className="overview-value">{live.filter((p) => p.status === 'matured').length}</span>
                <span className="overview-sub">Ready to request a return</span>
              </div>
            </div>
          </section>
        )}
        <AsyncContent
          loading={plans.loading}
          error={plans.error}
          onRetry={plans.reload}
          empty={!plans.data?.length}
          skeleton={<div className="group-grid">{[0, 1].map((i) => <Skeleton key={i} height={200} style={{ borderRadius: 14 }} />)}</div>}
          emptyState={<div className="card"><EmptyState icon={PiggyBank} title="No savings plans yet" message="Ask a collector to send you an invitation. You will review the term and commission before accepting." /></div>}
        >
          {live.length > 0 && <div className="group-grid">{live.map((p) => <PlanCard key={p.id} p={p} />)}</div>}
          {ended.length > 0 && (
            <section className="stack" aria-labelledby="ended-plans">
              <h2 id="ended-plans" className="section-label">Closed plans</h2>
              <div className="group-grid">{ended.map((p) => <PlanCard key={p.id} p={p} />)}</div>
            </section>
          )}
        </AsyncContent>
      </div>
    </PullToRefresh>
  );
}
