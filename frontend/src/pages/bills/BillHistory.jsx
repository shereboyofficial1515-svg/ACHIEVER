import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AsyncContent, Card, DataTable, EmptyState, Input, PageHeader, Pagination, Select } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { BillStatus } from './Bills.jsx';
import { CATEGORY, CATEGORY_ORDER, STATUS_TEXT } from './billsShared.js';

/** Bills → Transaction History, filterable by service and status. */
export default function BillHistory() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ category: '', status: '', search: '' });
  const [page, setPage] = useState(1);
  const list = useAsync(
    () => api.get('/bills/history', { page, pageSize: 20, category: filters.category || undefined, status: filters.status || undefined, search: filters.search.trim() || undefined }),
    [page, filters.category, filters.status, filters.search],
  );
  const set = (k) => (e) => { setPage(1); setFilters({ ...filters, [k]: e.target.value }); };

  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/bills', label: 'Bills & Services' }} title="Transaction history" subtitle="Every bill purchase, with its status and references" />
      <Card>
        <div className="grid-3">
          <Select label="Service" value={filters.category} onChange={set('category')}
            options={[{ value: '', label: 'All services' }, ...CATEGORY_ORDER.map((k) => ({ value: k, label: CATEGORY[k].label }))]} />
          <Select label="Status" value={filters.status} onChange={set('status')}
            options={[{ value: '', label: 'Any status' }, ...Object.entries(STATUS_TEXT).filter(([k]) => k !== 'UNKNOWN').map(([k, [label]]) => ({ value: k, label }))]} />
          <Input label="Reference" value={filters.search} onChange={set('search')} placeholder="ACH-BILL-…" />
        </div>
      </Card>
      <Card flush>
        <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.data?.length}
          emptyState={<EmptyState title="No transactions found" message="Try another filter." />}>
          <DataTable
            rows={list.data || []}
            onRowClick={(b) => navigate(`/app/bills/history/${b.id}`)}
            columns={[
              { key: 'd', label: 'Date', render: (b) => formatDateTime(b.createdAt) },
              { key: 's', label: 'Service', render: (b) => <span>{b.categoryLabel}<br /><span className="xsmall muted">{b.service}</span></span> },
              { key: 'a', label: 'Amount', align: 'right', render: (b) => <span className="money">{naira(b.amount)}</span> },
              { key: 'f', label: 'Fee', align: 'right', render: (b) => <span className="money">{naira(b.fee)}</span> },
              { key: 't', label: 'Total', align: 'right', render: (b) => <strong className="money">{naira(b.total)}</strong> },
              { key: 'st', label: 'Status', render: (b) => <BillStatus status={b.status} /> },
              { key: 'r', label: 'Reference', render: (b) => <span className="mono xsmall">{b.reference}</span> },
            ]}
          />
          <Pagination meta={list.meta} onPage={setPage} />
        </AsyncContent>
      </Card>
    </div>
  );
}
