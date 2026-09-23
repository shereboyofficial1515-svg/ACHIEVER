import { Button, PageHeader, StatusBadge } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';
import { commissionLabel, formatDate } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';

export default function AdminCollectors() {
  const { isFinanceStaff } = useAuth();
  const toast = useToast();
  const setStatus = async (a, status, reload) => {
    try {
      await api.patch(`/admin/collectors/${a.id}/status`, { status, reason: `Set by platform admin` });
      toast.success('Collector updated');
      reload();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div className="stack-lg">
      <PageHeader title="Collectors" />
      <AdminTable
        endpoint="/admin/collectors"
        filters={[
          { name: 'search', label: 'Search business name' },
          { name: 'status', label: 'All statuses', options: ['active', 'suspended'] },
        ]}
        columns={(reload) => [
          { key: 'b', label: 'Business', render: (a) => a.businessName },
          { key: 'c', label: 'Collector', render: (a) => `${a.collector?.name} · ${a.collector?.email}` },
          { key: 'a', label: 'Area', render: (a) => a.operatingArea || '—' },
          { key: 'm', label: 'Default commission', render: (a) => commissionLabel(a.defaultCommissionType, a.defaultCommissionValue) },
          { key: 's', label: 'Status', render: (a) => <StatusBadge status={a.status} /> },
          { key: 'd', label: 'Since', render: (a) => formatDate(a.createdAt) },
          ...(isFinanceStaff
            ? [{
                key: 'x',
                label: '',
                render: (a) =>
                  a.status === 'active' ? (
                    <Button size="sm" variant="ghost" onClick={() => setStatus(a, 'suspended', reload)}>Suspend</Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setStatus(a, 'active', reload)}>Reactivate</Button>
                  ),
              }]
            : []),
        ]}
      />
    </div>
  );
}
