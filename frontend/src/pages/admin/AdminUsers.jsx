import { useNavigate } from 'react-router-dom';
import { PageHeader, StatusBadge } from '../../components/ui/index.js';
import { formatDate } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN', 'OSUSU_ADMIN', 'OSUSU_MEMBER', 'COLLECTOR', 'SAVER'];

export default function AdminUsers() {
  const navigate = useNavigate();
  return (
    <div className="stack-lg">
      <PageHeader title="Users" />
      <AdminTable
        endpoint="/admin/users"
        onRowClick={(u) => navigate(`/app/admin/users/${u.id}`)}
        filters={[
          { name: 'search', label: 'Search name, email or phone' },
          { name: 'role', label: 'All roles', options: ROLES },
          { name: 'status', label: 'All statuses', options: ['pending_verification', 'active', 'suspended', 'closed'] },
        ]}
        columns={[
          { key: 'n', label: 'Name', render: (u) => u.fullName },
          { key: 'e', label: 'Email', render: (u) => u.email },
          { key: 'r', label: 'Roles', render: (u) => u.roles.join(', ') },
          { key: 's', label: 'Status', render: (u) => <StatusBadge status={u.status} /> },
          { key: 'v', label: 'Verified', render: (u) => `${u.emailVerified ? 'Email' : ''}${u.phoneVerified ? ' · Phone' : ''}` || '—' },
          { key: 'c', label: 'Joined', render: (u) => formatDate(u.createdAt) },
        ]}
      />
    </div>
  );
}
