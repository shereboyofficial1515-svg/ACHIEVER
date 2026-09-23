import { useNavigate } from 'react-router-dom';
import { PiggyBank } from 'lucide-react';
import { AsyncContent, Card, EmptyState, PageHeader, SkeletonList, StatCard, StatusBadge } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { FREQUENCY_LABEL, formatDate, naira } from '../../utils/format.js';

export default function MySavings() {
  const navigate = useNavigate();
  const plans = useAsync(() => api.get('/collector/plans/mine', { pageSize: 50 }), []);
  const live = (plans.data || []).filter((p) => ['active', 'matured', 'return_requested', 'return_processing'].includes(p.status));
  return (
    <div className="stack-lg">
      <PageHeader title="My savings" subtitle="Savings plans you hold with collectors" />
      {plans.data && (
        <div className="grid-3">
          <StatCard accent label="Total balance" value={naira(live.reduce((s, p) => s + p.balance, 0))} sub={`${live.length} active plan(s)`} />
          <StatCard label="Expected return" value={naira(live.reduce((s, p) => s + p.expectedReturn, 0))} sub="After agreed commission" />
          <StatCard label="Matured" value={live.filter((p) => p.status === 'matured').length} sub="Ready to request a return" />
        </div>
      )}
      <Card flush>
        <AsyncContent
          loading={plans.loading}
          error={plans.error}
          onRetry={plans.reload}
          empty={!plans.data?.length}
          skeleton={<SkeletonList />}
          emptyState={<EmptyState icon={PiggyBank} title="No savings plans yet" message="Ask a collector to send you an invitation. You will review the term and commission before accepting." />}
        >
          <ul className="list">
            {plans.data?.map((p) => (
              <li key={p.id} className="list-item clickable" onClick={() => navigate(`/app/collector/plans/${p.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/app/collector/plans/${p.id}`)}>
                <span className="list-icon">
                  <PiggyBank size={18} />
                </span>
                <div className="grow">
                  <p style={{ fontWeight: 600 }}>{p.planName}</p>
                  <p className="xsmall muted">
                    {p.businessName} · {FREQUENCY_LABEL[p.frequency]} · matures {formatDate(p.endDate)}
                  </p>
                </div>
                <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
                  <span className="money">{naira(p.balance)}</span>
                  <StatusBadge status={p.status} />
                </div>
              </li>
            ))}
          </ul>
        </AsyncContent>
      </Card>
    </div>
  );
}
