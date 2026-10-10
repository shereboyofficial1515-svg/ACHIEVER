import { Link, useNavigate } from 'react-router-dom';
import PullToRefresh, { reloadAll } from '../../components/PullToRefresh.jsx';
import { ChevronRight, History, Info, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react';
import { Alert, AsyncContent, Card, EmptyState } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { CATEGORY, CATEGORY_ORDER, UNAVAILABLE_REASON } from './billsShared.js';
import { BillStatus, CategoryIcon } from './billsUi.jsx';

export { BillStatus } from './billsUi.jsx';

function CategorySkeleton() {
  return (
    <div className="bill-grid" aria-busy="true" aria-label="Loading services">
      {CATEGORY_ORDER.map((k) => <div key={k} className="bill-tile is-skeleton"><span className="skeleton-block" /></div>)}
    </div>
  );
}

/** One purchase in a compact, tappable row (works at every screen width, unlike a wide table). */
export function BillRow({ b, onOpen }) {
  // The server stores "Provider — Plan"; show the plan first (it is what the member recognises).
  const [provider, product] = String(b.service || '').split(' — ');
  return (
    <li>
      <button type="button" className="bill-row" onClick={() => onOpen(b)}>
        <CategoryIcon category={b.category} size={40} />
        <span className="bill-row-main">
          <strong>{product || provider}</strong>
          <span className="xsmall muted">{[product ? provider : b.categoryLabel, b.recipient, formatDateTime(b.createdAt)].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="bill-row-side">
          <strong className="money">{naira(b.total)}</strong>
          <BillStatus status={b.status} />
        </span>
        <ChevronRight size={16} className="bill-row-chev" aria-hidden />
      </button>
    </li>
  );
}

/** Bills & Services hub: what can be bought right now, and recent purchases. */
export default function Bills() {
  const navigate = useNavigate();
  const overview = useAsync(() => api.get('/bills/overview'), []);
  const recent = useAsync(() => api.get('/bills/history', { page: 1, pageSize: 5 }), []);
  const byKey = Object.fromEntries((overview.data?.categories || []).map((c) => [c.key, c]));
  const open = (b) => navigate(`/app/bills/history/${b.id}`);

  return (
    <PullToRefresh onRefresh={() => reloadAll(overview, recent)}>
      <div className="stack-lg bills-hub">
        <section className="bills-hero" aria-labelledby="bills-title">
          <div className="bills-hero-text">
            <h1 id="bills-title">Bills &amp; Services</h1>
            <p>Airtime, data, electricity, TV and exam PINs, approved by you and delivered by a licensed provider.</p>
          </div>
          <Link to="/app/bills/history" className="bills-hero-action"><History size={16} aria-hidden /> History</Link>
          <ul className="bills-hero-points">
            <li><ShieldCheck size={14} aria-hidden /> PIN or biometric approval</li>
            <li><Undo2 size={14} aria-hidden /> Refund if not delivered</li>
          </ul>
        </section>

        <AsyncContent loading={overview.loading && !overview.data} skeleton={<CategorySkeleton />} error={overview.error} onRetry={overview.reload}>
          {overview.data && !overview.data.configured && (
            <Alert tone="info" icon={Info}>Bill payment is temporarily unavailable. Please try again shortly. You have not been charged.</Alert>
          )}
          {/* Shown only when the BACKEND reports its VTpass environment is sandbox; the app cannot switch modes. */}
          {overview.data?.testMode && (
            <Alert tone="warning">Test mode: purchases use the provider’s sandbox. No real airtime, data or tokens are delivered.</Alert>
          )}
          <section aria-labelledby="bills-services">
            <h2 id="bills-services" className="section-label">Services</h2>
            <div className="bill-grid">
              {CATEGORY_ORDER.map((key) => {
                const meta = CATEGORY[key];
                const c = byKey[key];
                const available = Boolean(c?.available);
                const body = (
                  <>
                    <CategoryIcon category={key} size={44} />
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
          </section>
        </AsyncContent>

        <Card title="Recent purchases" flush actions={<Link to="/app/bills/history" className="small">See all</Link>}>
          <AsyncContent loading={recent.loading} error={recent.error} onRetry={recent.reload} empty={!recent.data?.length}
            emptyState={<EmptyState icon={RotateCcw} title="No purchases yet" message="Your airtime, data and bill receipts will appear here." />}>
            <ul className="bill-rows">{(recent.data || []).map((b) => <BillRow key={b.id} b={b} onOpen={open} />)}</ul>
          </AsyncContent>
        </Card>
        <p className="xsmall muted bills-footnote">
          ACHIEVER never stores your card details. A purchase is sent to the provider only after your payment is confirmed; if delivery fails you are refunded.
        </p>
      </div>
    </PullToRefresh>
  );
}
