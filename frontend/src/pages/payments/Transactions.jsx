import { useState } from 'react';
import { Receipt } from 'lucide-react';
import { AsyncContent, Card, EmptyState, Input, KeyValue, Modal, PageHeader, Pagination, SkeletonList, StatusBadge } from '../../components/ui/index.js';
import { TransactionList } from '../../components/domain/TransactionList.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { api } from '../../services/api.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { TX_TYPE_LABEL } from '../../utils/status.js';

export default function Transactions() {
  const [filters, setFilters] = useState({ type: '', status: '', search: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const search = useDebounce(filters.search);
  const list = useAsync(
    () => api.get('/payments/transactions', { page, pageSize: 20, type: filters.type, status: filters.status, search, from: filters.from, to: filters.to }),
    [page, filters.type, filters.status, search, filters.from, filters.to],
  );
  const set = (k) => (e) => {
    setFilters({ ...filters, [k]: e.target.value });
    setPage(1);
  };

  return (
    <div className="stack-lg">
      <PageHeader title="Transactions" subtitle="Your permanent record of verified contributions, payouts, returns, refunds and bills." />
      <Card flush>
        <div className="filters">
          <input className="input" type="search" placeholder="Search reference or description" value={filters.search} onChange={set('search')} aria-label="Search transactions" />
          <select className="select" value={filters.type} onChange={set('type')} aria-label="Type">
            <option value="">All types</option>
            {Object.entries(TX_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select className="select" value={filters.status} onChange={set('status')} aria-label="Status">
            <option value="">All statuses</option>
            {['success', 'pending', 'processing', 'failed', 'reversed'].map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <input className="input" type="date" value={filters.from} onChange={set('from')} aria-label="From date" />
          <input className="input" type="date" value={filters.to} onChange={set('to')} aria-label="To date" />
        </div>
        <AsyncContent
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={!list.data?.length}
          skeleton={<SkeletonList rows={8} />}
          emptyState={<EmptyState icon={Receipt} title="No transactions found" message="Only payments verified with our payment provider are recorded here." />}
        >
          <TransactionList
            items={(list.data || []).map((t) => ({ ...t, createdAt: t.created_at }))}
            onSelect={setSelected}
          />
          <Pagination meta={list.meta} onPage={setPage} />
        </AsyncContent>
      </Card>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Transaction receipt">
        {selected && (
          <div className="receipt stack">
            <p className="amount">
              {selected.direction === 'credit' ? '+' : '−'}
              {naira(selected.amount)}
            </p>
            <p style={{ textAlign: 'center' }}>
              <StatusBadge status={selected.status} />
            </p>
            <KeyValue
              items={[
                ['Type', TX_TYPE_LABEL[selected.type]],
                ['Description', selected.description],
                ['Reference', <span className="mono" key="r">{selected.reference}</span>],
                ['Provider reference', selected.provider_reference ? <span className="mono" key="p">{selected.provider_reference}</span> : '—'],
                ['Channel', selected.provider],
                ['Created', formatDateTime(selected.created_at)],
                ['Completed', formatDateTime(selected.completed_at)],
              ]}
            />
            <button type="button" className="btn btn-secondary no-print" onClick={() => window.print()}>
              Print receipt
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
