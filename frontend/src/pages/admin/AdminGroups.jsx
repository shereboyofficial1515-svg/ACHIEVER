import { useNavigate } from 'react-router-dom';
import { PageHeader, StatusBadge } from '../../components/ui/index.js';
import { FREQUENCY_LABEL, formatDate, naira } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';

export default function AdminGroups() {
  const navigate = useNavigate();
  return (
    <div className="stack-lg">
      <PageHeader title="Osusu groups" />
      <AdminTable
        endpoint="/admin/osusu/groups"
        onRowClick={(g) => navigate(`/app/osusu/${g.id}`)}
        filters={[
          { name: 'search', label: 'Search group name' },
          { name: 'status', label: 'All statuses', options: ['recruiting', 'active', 'completed', 'cancelled'] },
        ]}
        columns={[
          { key: 'n', label: 'Group', render: (g) => g.name },
          { key: 'o', label: 'Organiser', render: (g) => g.admin?.name },
          { key: 'c', label: 'Contribution', render: (g) => `${naira(g.contributionAmount)} · ${FREQUENCY_LABEL[g.frequency]}` },
          { key: 'cy', label: 'Cycle', render: (g) => (g.totalCycles ? `${g.currentCycle}/${g.totalCycles}` : '—') },
          { key: 's', label: 'Status', render: (g) => <StatusBadge status={g.status} /> },
          { key: 'd', label: 'Created', render: (g) => formatDate(g.createdAt) },
        ]}
      />
    </div>
  );
}
