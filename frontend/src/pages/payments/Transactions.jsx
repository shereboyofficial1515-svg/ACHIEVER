import { useState } from 'react';
import PullToRefresh, { reloadAll } from '../../components/PullToRefresh.jsx';
import { ArrowDownLeft, ArrowUpRight, Receipt, Search } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, EmptyState, KeyValue, Modal, PageHeader, Pagination, SkeletonList, StatusBadge } from '../../components/ui/index.js';
import { TransactionList } from '../../components/domain/TransactionList.jsx';
import ReceiptShare from '../../components/domain/ReceiptShare.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { api } from '../../services/api.js';
import { paymentReceiptModel, receiptBlocker } from '../../services/receiptExport.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { TX_TYPE_LABEL } from '../../utils/status.js';

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'success', label: 'Successful' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'failed', label: 'Failed' },
  { value: 'reversed', label: 'Reversed' },
];
const EMPTY = { type: '', status: '', search: '', from: '', to: '' };

/** Payment record detail: what moved, its status and references; a PDF or image receipt once successful. */
export function PaymentDetail({ t }) {
  const credit = t.direction === 'credit';
  const label = TX_TYPE_LABEL[t.type] || t.type;
  const blocker = receiptBlocker(t.status);
  return (
    <div className="receipt stack">
      <div className="receipt-head">
        <span className={`receipt-icon ${credit ? 'is-credit' : ''}`} aria-hidden>{credit ? <ArrowDownLeft size={22} /> : <ArrowUpRight size={22} />}</span>
        <span className="small muted">{label}</span>
        <p className="amount">{credit ? '+' : '−'}{naira(t.amount)}</p>
        <StatusBadge status={t.status} />
      </div>
      <KeyValue
        items={[
          ['Type', label],
          ['Description', t.description],
          ['Reference', <span className="mono" key="r">{t.reference}</span>],
          ['Provider reference', t.provider_reference ? <span className="mono" key="p">{t.provider_reference}</span> : '—'],
          ['Channel', t.provider],
          ['Created', formatDateTime(t.created_at)],
          ['Completed', t.completed_at ? formatDateTime(t.completed_at) : '—'],
        ]}
      />
      {blocker ? <Alert tone="info">{blocker} A receipt is available once the payment is successful.</Alert> : <ReceiptShare model={paymentReceiptModel(t, label)} />}
    </div>
  );
}

export default function Transactions() {
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const search = useDebounce(filters.search);
  const list = useAsync(
    () => api.get('/payments/transactions', { page, pageSize: 20, type: filters.type, status: filters.status, search, from: filters.from, to: filters.to }),
    [page, filters.type, filters.status, search, filters.from, filters.to],
  );
  const update = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const set = (k) => (e) => update(k, e.target.value);
  const filtered = Object.values(filters).some(Boolean);

  return (
    <PullToRefresh onRefresh={() => reloadAll(list)}>
    <div className="stack-lg">
      <PageHeader title="Payments" subtitle="Your permanent record of verified contributions, payouts, returns, refunds and bills." />
      <div className="toolbar">
        <div className="toolbar-row">
          <label className="search-field">
            <Search size={16} aria-hidden />
            <input className="input" type="search" placeholder="Search reference or description" value={filters.search} onChange={set('search')} aria-label="Search transactions" />
          </label>
          <div className="segmented" role="group" aria-label="Filter by status">
            {STATUSES.map((s) => (
              <button key={s.value} type="button" aria-pressed={filters.status === s.value} onClick={() => update('status', s.value)}>{s.label}</button>
            ))}
          </div>
        </div>
        <div className="toolbar-row toolbar-fields">
          <select className="select" value={filters.type} onChange={set('type')} aria-label="Type">
            <option value="">All types</option>
            {Object.entries(TX_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="date-field"><span>From</span><input className="input" type="date" value={filters.from} onChange={set('from')} aria-label="From date" /></label>
          <label className="date-field"><span>To</span><input className="input" type="date" value={filters.to} onChange={set('to')} aria-label="To date" /></label>
          {filtered && <Button variant="ghost" size="sm" onClick={() => { setFilters(EMPTY); setPage(1); }}>Clear filters</Button>}
        </div>
      </div>
      <Card flush>
        <AsyncContent
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={!list.data?.length}
          skeleton={<SkeletonList rows={8} />}
          emptyState={filtered
            ? <EmptyState icon={Search} title="No payments match" message="Try a different search, status, type or date range." />
            : <EmptyState icon={Receipt} title="No transactions yet" message="Only payments verified with our payment provider are recorded here." />}
        >
          <TransactionList items={(list.data || []).map((t) => ({ ...t, createdAt: t.created_at }))} onSelect={setSelected} />
          <Pagination meta={list.meta} onPage={setPage} />
        </AsyncContent>
      </Card>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Payment details">
        {selected && <PaymentDetail t={selected} />}
      </Modal>
    </div>
    </PullToRefresh>
  );
}
