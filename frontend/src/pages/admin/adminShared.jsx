import { useState } from 'react';
import { AsyncContent, Card, DataTable, EmptyState, Pagination } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { api } from '../../services/api.js';

/**
 * Server-side filtered, paginated admin table. `filters` describe the inputs;
 * values are sent as query parameters so large datasets never load in full.
 */
export function AdminTable({ endpoint, columns, filters = [], onRowClick, emptyTitle = 'No records', reloadKey, pageSize = 25 }) {
  const [values, setValues] = useState(() => Object.fromEntries(filters.map((f) => [f.name, f.initial ?? ''])));
  const [page, setPage] = useState(1);
  const search = useDebounce(values.search);
  const params = { ...values, search, page, pageSize };
  const list = useAsync(() => api.get(endpoint, params), [endpoint, JSON.stringify({ ...values, search: undefined }), search, page, reloadKey]);

  const set = (name) => (e) => {
    setValues({ ...values, [name]: e.target.value });
    setPage(1);
  };

  return (
    <Card flush>
      {filters.length > 0 && (
        <div className="filters">
          {filters.map((f) =>
            f.options ? (
              <select key={f.name} className="select" value={values[f.name]} onChange={set(f.name)} aria-label={f.label}>
                <option value="">{f.label}</option>
                {f.options.map((o) => (
                  <option key={o.value ?? o} value={o.value ?? o}>
                    {o.label ?? String(o).replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            ) : (
              <input key={f.name} className="input" type={f.type || 'search'} placeholder={f.label} value={values[f.name]} onChange={set(f.name)} aria-label={f.label} />
            ),
          )}
        </div>
      )}
      <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.data?.length} emptyState={<EmptyState title={emptyTitle} />}>
        <DataTable rows={list.data || []} columns={typeof columns === 'function' ? columns(list.reload) : columns} onRowClick={onRowClick} />
        <Pagination meta={list.meta} onPage={setPage} />
      </AsyncContent>
    </Card>
  );
}
