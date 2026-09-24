import { useState } from 'react';
import { Alert, Button, KeyValue, Modal, PageHeader, Select, StatusBadge, Textarea } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';
import { formatDateTime } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';

const REASONS = {
  post_payout_default: 'Missed contributions after receiving payout',
  payment_overdue: 'Payment overdue',
  amount_mismatch: 'Payment amount mismatch',
  duplicate_payment: 'Duplicate payment',
  large_transaction: 'Unusually large transaction',
  repeated_failed_payments: 'Repeated failed payments',
  early_return_request: 'Collector-initiated early return',
  repeated_complaints: 'Repeated complaints',
  manual: 'Manual review',
};

export default function AdminRisk() {
  const { can } = useAuth();
  const isFinanceStaff = can('risk.review');
  const toast = useToast();
  const [flag, setFlag] = useState(null);
  const [form, setForm] = useState({ status: 'resolved', note: '' });
  const [pending, setPending] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const save = async () => {
    setPending(true);
    try {
      await api.patch(`/admin/risk/${flag.id}`, form);
      toast.success('Review updated');
      setFlag(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="stack-lg">
      <PageHeader title="Risk & review" subtitle="Automated monitoring flags. Statuses are neutral indicators for review, not findings of wrongdoing." />
      <AdminTable
        endpoint="/admin/risk"
        reloadKey={reloadKey}
        onRowClick={(f) => { setFlag(f); setForm({ status: 'resolved', note: '' }); }}
        filters={[
          { name: 'status', label: 'All statuses', options: ['review_required', 'risk_review', 'resolved', 'dismissed'], initial: 'review_required' },
          { name: 'context', label: 'All areas', options: ['osusu', 'collector', 'payments', 'account'] },
        ]}
        columns={[
          { key: 'u', label: 'Subject', render: (f) => f.subject?.full_name },
          { key: 'r', label: 'Reason', render: (f) => REASONS[f.reason_code] },
          { key: 'c', label: 'Area', render: (f) => f.context },
          { key: 'g', label: 'Group', render: (f) => f.group?.name || '—' },
          { key: 'sv', label: 'Severity', render: (f) => f.severity },
          { key: 's', label: 'Status', render: (f) => <StatusBadge status={f.status} /> },
          { key: 'd', label: 'Raised', render: (f) => formatDateTime(f.created_at) },
        ]}
      />
      <Modal
        open={Boolean(flag)}
        onClose={() => setFlag(null)}
        title="Review case"
        footer={isFinanceStaff && <Button onClick={save} loading={pending}>Save</Button>}
      >
        {flag && (
          <div className="stack">
            <KeyValue
              items={[
                ['Subject', `${flag.subject?.full_name} · ${flag.subject?.email}`],
                ['Reason', REASONS[flag.reason_code]],
                ['Severity', flag.severity],
                ['Status', <StatusBadge key="s" status={flag.status} />],
                ['Details', <code key="d" className="xsmall">{JSON.stringify(flag.details)}</code>],
                flag.resolution_note && ['Resolution', flag.resolution_note],
              ]}
            />
            {isFinanceStaff ? (
              <>
                <Select label="Update status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={['review_required', 'risk_review', 'resolved', 'dismissed'].map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
                <Textarea label="Note" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </>
            ) : (
              <Alert tone="info">Only platform admins can change review status.</Alert>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
