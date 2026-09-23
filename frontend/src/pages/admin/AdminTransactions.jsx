import { useState } from 'react';
import { PageHeader, StatusBadge, Tabs } from '../../components/ui/index.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { TX_TYPE_LABEL } from '../../utils/status.js';
import { AdminTable } from './adminShared.jsx';

export default function AdminTransactions() {
  const [tab, setTab] = useState('ledger');
  return (
    <div className="stack-lg">
      <PageHeader title="Transactions" subtitle="The ledger is append-only. Corrections are made with new entries, never edits." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'ledger', label: 'Ledger' }, { value: 'attempts', label: 'Payment attempts' }]} />
      {tab === 'ledger' ? (
        <AdminTable
          key="ledger"
          endpoint="/admin/transactions"
          filters={[
            { name: 'search', label: 'Reference or description' },
            { name: 'type', label: 'All types', options: Object.entries(TX_TYPE_LABEL).map(([value, label]) => ({ value, label })) },
            { name: 'status', label: 'All statuses', options: ['pending', 'processing', 'success', 'failed', 'reversed'] },
            { name: 'from', label: 'From', type: 'date' },
            { name: 'to', label: 'To', type: 'date' },
          ]}
          columns={[
            { key: 'r', label: 'Reference', render: (t) => <span className="mono">{t.reference}</span> },
            { key: 'u', label: 'User', render: (t) => t.user?.full_name },
            { key: 't', label: 'Type', render: (t) => TX_TYPE_LABEL[t.type] },
            { key: 'a', label: 'Amount', align: 'right', render: (t) => <span className="money">{t.direction === 'credit' ? '+' : '−'}{naira(t.amount)}</span> },
            { key: 's', label: 'Status', render: (t) => <StatusBadge status={t.status} /> },
            { key: 'p', label: 'Provider ref', render: (t) => <span className="mono xsmall">{t.provider_reference || '—'}</span> },
            { key: 'd', label: 'Created', render: (t) => formatDateTime(t.created_at) },
          ]}
        />
      ) : (
        <AdminTable
          key="attempts"
          endpoint="/admin/payments"
          filters={[
            { name: 'search', label: 'Payment reference' },
            { name: 'status', label: 'All statuses', options: ['initialized', 'success', 'failed', 'abandoned', 'amount_mismatch', 'duplicate'] },
            { name: 'purpose', label: 'All purposes', options: ['osusu_contribution', 'collector_savings', 'bill_payment'] },
          ]}
          columns={[
            { key: 'r', label: 'Reference', render: (a) => <span className="mono">{a.reference}</span> },
            { key: 'u', label: 'User', render: (a) => a.user?.full_name },
            { key: 'p', label: 'Purpose', render: (a) => a.purpose.replace(/_/g, ' ') },
            { key: 'a', label: 'Amount', align: 'right', render: (a) => <span className="money">{naira(a.amount)}</span> },
            { key: 's', label: 'Status', render: (a) => <StatusBadge status={a.status} /> },
            { key: 'g', label: 'Gateway', render: (a) => a.gateway_response || '—' },
            { key: 'd', label: 'Created', render: (a) => formatDateTime(a.created_at) },
          ]}
        />
      )}
    </div>
  );
}
