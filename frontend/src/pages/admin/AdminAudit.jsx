import { PageHeader, StatusBadge } from '../../components/ui/index.js';
import { formatDateTime } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';

export default function AdminAudit() {
  return (
    <div className="stack-lg">
      <PageHeader title="Audit logs" subtitle="Append-only record of sensitive actions" />
      <AdminTable
        endpoint="/admin/audit-logs"
        pageSize={50}
        filters={[
          { name: 'action', label: 'Action prefix (e.g. osusu.payout)' },
          { name: 'resourceType', label: 'Resource type' },
          { name: 'resourceId', label: 'Resource ID' },
          { name: 'from', label: 'From', type: 'date' },
          { name: 'to', label: 'To', type: 'date' },
        ]}
        columns={[
          { key: 't', label: 'Time', render: (a) => formatDateTime(a.created_at) },
          { key: 'a', label: 'Actor', render: (a) => a.profiles?.full_name || 'System' },
          { key: 'x', label: 'Action', render: (a) => <span className="mono xsmall">{a.action}</span> },
          { key: 'r', label: 'Resource', render: (a) => <span className="xsmall">{a.resource_type} {a.resource_id ? `· ${String(a.resource_id).slice(0, 8)}` : ''}</span> },
          { key: 's', label: 'Result', render: (a) => <StatusBadge status={a.result === 'success' ? 'success' : a.result === 'denied' ? 'failed' : 'pending'} label={a.result} /> },
          { key: 'i', label: 'IP', render: (a) => <span className="mono xsmall">{a.ip_address || '—'}</span> },
          { key: 'm', label: 'Details', render: (a) => <code className="xsmall" style={{ maxWidth: 280, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(a.metadata)}>{JSON.stringify(a.metadata)}</code> },
        ]}
      />
    </div>
  );
}
