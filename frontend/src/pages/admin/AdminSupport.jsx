import { useNavigate } from 'react-router-dom';
import { PageHeader, StatusBadge } from '../../components/ui/index.js';
import { formatDateTime } from '../../utils/format.js';
import { TICKET_CATEGORIES } from '../support/Support.jsx';
import { AdminTable } from './adminShared.jsx';

export default function AdminSupport() {
  const navigate = useNavigate();
  return (
    <div className="stack-lg">
      <PageHeader title="Support & disputes" />
      <AdminTable
        endpoint="/admin/support/tickets"
        onRowClick={(t) => navigate(`/app/admin/support/${t.id}`)}
        filters={[
          { name: 'search', label: 'Reference or subject' },
          { name: 'status', label: 'All statuses', options: ['open', 'in_progress', 'awaiting_user', 'resolved', 'closed'] },
          { name: 'priority', label: 'All priorities', options: ['urgent', 'high', 'normal', 'low'] },
          { name: 'category', label: 'All categories', options: TICKET_CATEGORIES },
        ]}
        columns={[
          { key: 'r', label: 'Reference', render: (t) => <span className="mono xsmall">{t.reference}</span> },
          { key: 's', label: 'Subject', render: (t) => t.subject },
          { key: 'u', label: 'Customer', render: (t) => t.user?.name },
          { key: 'p', label: 'Priority', render: (t) => <StatusBadge status={t.priority === 'urgent' ? 'overdue' : t.priority === 'high' ? 'pending' : 'scheduled'} label={t.priority} /> },
          { key: 'st', label: 'Status', render: (t) => <StatusBadge status={t.status} /> },
          { key: 'd', label: 'Updated', render: (t) => formatDateTime(t.updatedAt) },
        ]}
      />
    </div>
  );
}
