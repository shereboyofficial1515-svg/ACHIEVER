import { PageHeader, StatusBadge } from '../../components/ui/index.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';

export default function AdminBills() {
  return (
    <div className="stack-lg">
      <PageHeader title="Bill payments" subtitle="Purchases stuck in processing are re-checked with the provider automatically." />
      <AdminTable
        endpoint="/admin/bills"
        filters={[
          { name: 'search', label: 'Reference or customer number' },
          { name: 'status', label: 'All statuses', options: ['awaiting_payment', 'paid', 'processing', 'delivered', 'refund_pending', 'refunded', 'cancelled'] },
          { name: 'category', label: 'All categories', options: ['airtime', 'data', 'electricity'] },
        ]}
        columns={[
          { key: 'r', label: 'Reference', render: (b) => <span className="mono xsmall">{b.reference}</span> },
          { key: 'u', label: 'User', render: (b) => b.user?.name },
          { key: 'c', label: 'Service', render: (b) => `${b.category} · ${b.serviceId}` },
          { key: 'i', label: 'Customer', render: (b) => b.customerIdentifier },
          { key: 'a', label: 'Amount', align: 'right', render: (b) => <span className="money">{naira(b.amount)}</span> },
          { key: 's', label: 'Status', render: (b) => <span className="stack-sm"><StatusBadge status={b.status} />{b.lastError && <span className="xsmall muted">{b.lastError}</span>}</span> },
          { key: 't', label: 'Attempts', render: (b) => b.attempts },
          { key: 'd', label: 'Created', render: (b) => formatDateTime(b.createdAt) },
        ]}
      />
    </div>
  );
}
