import { useState } from 'react';
import PullToRefresh, { reloadAll } from '../../components/PullToRefresh.jsx';
import { useNavigate } from 'react-router-dom';
import { AsyncContent, Card, EmptyState, Input, PageHeader, Pagination, Select } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { BillRow } from './Bills.jsx';
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
    <PullToRefresh onRefresh={() => reloadAll(list)}>
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/bills', label: 'Bills & Services' }} title="Transaction history" subtitle="Every bill purchase, with its status and references" />
      <Card>
        <div className="grid-3">
          <Select label="Service" value={filters.category} onChange={set('category')}
            options={[{ value: '', label: 'All services' }, ...CATEGORY_ORDER.map((k) => ({ value: k, label: CATEGORY[k].label }))]} />
          <Select label="Status" value={filters.status} onChange={set('status')}
            options={[{ value: '', label: 'Any status' }, ...Object.entries(STATUS_TEXT).filter(([k]) => !['UNKNOWN', 'AWAITING_AUTHORIZATION'].includes(k)).map(([k, [label]]) => ({ value: k, label }))]} />
          <Input label="Reference" value={filters.search} onChange={set('search')} placeholder="ACH-BILL-…" />
        </div>
      </Card>
      <Card flush>
        <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.data?.length}
          emptyState={<EmptyState title="No transactions found" message="Try another filter." />}>
          <ul className="bill-rows">{(list.data || []).map((b) => <BillRow key={b.id} b={b} onOpen={(x) => navigate(`/app/bills/history/${x.id}`)} />)}</ul>
          <Pagination meta={list.meta} onPage={setPage} />
        </AsyncContent>
      </Card>
    </div>
    </PullToRefresh>
  );
}
