import { Link, useNavigate } from 'react-router-dom';
import PullToRefresh, { reloadAll } from '../../components/PullToRefresh.jsx';
import { History, Info } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, DataTable, EmptyState, PageHeader } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { CATEGORY, CATEGORY_ORDER, STATUS_TEXT, UNAVAILABLE_REASON } from './billsShared.js';

export function BillStatus({ status }) {
  const [label, tone] = STATUS_TEXT[status] || [status, 'neutral'];
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

/** Bills & Services hub: what can be bought right now, and recent purchases. */
export default function Bills() {
  const navigate = useNavigate();
  const overview = useAsync(() => api.get('/bills/overview'), []);
  const recent = useAsync(() => api.get('/bills/history', { page: 1, pageSize: 5 }), []);
  const byKey = Object.fromEntries((overview.data?.categories || []).map((c) => [c.key, c]));

  return (
    <PullToRefresh onRefresh={() => reloadAll(overview, recent)}>
    <div className="stack-lg">
      <PageHeader
        title="Bills & Services"
        subtitle="Airtime, data, electricity, TV and more — approved by you, paid securely, delivered by a licensed provider"
        actions={<Button variant="secondary" icon={History} onClick={() => navigate('/app/bills/history')}>Transaction history</Button>}
      />
      <AsyncContent loading={overview.loading} error={overview.error} onRetry={overview.reload}>
        {overview.data && !overview.data.configured && (
          <Alert tone="info" icon={Info}>Bill payment is temporarily unavailable. Please try again shortly. You have not been charged.</Alert>
        )}
        {/* Shown only when the BACKEND reports its VTpass environment is sandbox; the app cannot switch modes. */}
        {overview.data?.testMode && (
          <Alert tone="warning">Test mode: purchases use the provider’s sandbox. No real airtime, data or tokens are delivered.</Alert>
        )}
        <div className="bill-grid">
          {CATEGORY_ORDER.map((key) => {
            const meta = CATEGORY[key];
            const c = byKey[key];
            const available = Boolean(c?.available);
            const Icon = meta.icon;
            const body = (
              <>
                <span className="bill-tile-icon" aria-hidden><Icon size={22} /></span>
                <span className="bill-tile-text">
                  <strong>{meta.label}</strong>
                  <span className="xsmall muted">{available ? meta.blurb : UNAVAILABLE_REASON[c?.reason] || 'Currently unavailable'}</span>
                </span>
              </>
            );
            return available ? (
              <Link key={key} to={`/app/bills/buy/${key}`} className="bill-tile">{body}</Link>
            ) : (
              <div key={key} className="bill-tile is-disabled" aria-disabled="true">{body}</div>
            );
          })}
        </div>
      </AsyncContent>

      <Card title="Recent purchases" flush actions={<Link to="/app/bills/history" className="small">See all</Link>}>
        <AsyncContent loading={recent.loading} error={recent.error} onRetry={recent.reload} empty={!recent.data?.length}
          emptyState={<EmptyState title="No purchases yet" message="Your airtime, data and bill receipts will appear here." />}>
          <DataTable
            rows={recent.data || []}
            onRowClick={(b) => navigate(`/app/bills/history/${b.id}`)}
            columns={[
              { key: 's', label: 'Service', render: (b) => <span>{b.service}<br /><span className="xsmall muted">{b.recipient}</span></span> },
              { key: 't', label: 'Total', align: 'right', render: (b) => <span className="money">{naira(b.total)}</span> },
              { key: 'st', label: 'Status', render: (b) => <BillStatus status={b.status} /> },
              { key: 'd', label: 'Date', render: (b) => formatDateTime(b.createdAt) },
            ]}
          />
        </AsyncContent>
      </Card>
      <p className="xsmall muted">
        ACHIEVER never stores your card details. Purchases are sent to the provider only after Paystack confirms your payment; if delivery fails you are refunded.
      </p>
    </div>
    </PullToRefresh>
  );
}
