import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/ui/index.js';
import { formatDateTime } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';

export default function AdminDataAccess() {
  return (
    <div className="stack-lg">
      <PageHeader title="Sensitive data access log" subtitle="Every time staff open private profile data, identity documents or dispute evidence: who, what, when and why. Append-only." />
      <AdminTable
        endpoint="/admin/data-access-logs"
        pageSize={50}
        filters={[
          { name: 'actorId', label: 'Staff user ID' },
          { name: 'subjectUserId', label: 'Subject user ID' },
        ]}
        columns={[
          { key: 't', label: 'Time', render: (r) => formatDateTime(r.created_at) },
          { key: 'a', label: 'Staff member', render: (r) => r.actor?.full_name || r.actor_id },
          { key: 's', label: 'About', render: (r) => (r.subject_user_id ? <Link to={`/app/admin/users/${r.subject_user_id}`}>{r.subject?.full_name || r.subject_user_id.slice(0, 8)}</Link> : '—') },
          { key: 'r', label: 'Record', render: (r) => <span className="xsmall">{r.resource_type.replace(/_/g, ' ')}{r.resource_id ? ` · ${String(r.resource_id).slice(0, 8)}` : ''}</span> },
          { key: 'f', label: 'Fields', render: (r) => <span className="xsmall">{(r.fields || []).join(', ') || '—'}</span> },
          { key: 'w', label: 'Reason given', render: (r) => <span className="small">{r.reason}</span> },
          { key: 'i', label: 'IP', render: (r) => <span className="mono xsmall">{r.ip_address || '—'}</span> },
        ]}
      />
    </div>
  );
}
