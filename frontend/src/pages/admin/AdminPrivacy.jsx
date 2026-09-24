import { useState } from 'react';
import { Alert, Button, Modal, PageHeader, Select, StatusBadge, Textarea } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';
import { formatDateTime } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';

/** Compliance review of account / personal-data deletion requests. */
export default function AdminPrivacy() {
  const toast = useToast();
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState('complete');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const decide = async () => {
    setPending(true);
    setError(null);
    try {
      await api.post(`/admin/privacy/requests/${selected.id}/decision`, { decision, note: note || undefined });
      toast.success('Request updated');
      setSelected(null);
      setNote('');
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const coolingOff = selected && new Date(selected.cancellableUntil) > new Date();
  return (
    <div className="stack-lg">
      <PageHeader title="Deletion requests" subtitle="Account and personal-data deletion. Legally required records are always retained." />
      <AdminTable
        endpoint="/admin/privacy/requests"
        reloadKey={reloadKey}
        onRowClick={(r) => { setSelected(r); setDecision('complete'); setError(null); }}
        filters={[{ name: 'status', label: 'All statuses', initial: 'pending', options: ['pending', 'in_review', 'completed', 'rejected', 'cancelled'] }]}
        columns={[
          { key: 'u', label: 'User', render: (r) => (r.user ? `${r.user.name} · ${r.user.email}` : '—') },
          { key: 't', label: 'Type', render: (r) => (r.type === 'account' ? 'Account deletion' : 'Personal data') },
          { key: 's', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'c', label: 'Requested', render: (r) => formatDateTime(r.createdAt) },
          { key: 'w', label: 'User can cancel until', render: (r) => formatDateTime(r.cancellableUntil) },
        ]}
      />
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Review deletion request"
        footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Close</Button><Button onClick={decide} loading={pending} disabled={!['pending', 'in_review'].includes(selected?.status)}>Save decision</Button></>}
      >
        {selected && (
          <div className="stack">
            <p className="small"><strong>{selected.user?.name}</strong> asked to {selected.type === 'account' ? 'delete their account' : 'delete optional personal data'} on {formatDateTime(selected.createdAt)}.</p>
            {selected.reason && <p className="small">Reason: {selected.reason}</p>}
            {coolingOff && <Alert tone="warning">The user can still cancel until {formatDateTime(selected.cancellableUntil)}. It can be completed after that.</Alert>}
            <Alert tone="info">Completing erases optional profile data{selected.type === 'account' ? ' and closes the account' : ''}. Identity/KYC, ledger, contribution, payout, dispute, audit and security records are retained. Accounts with open groups, plans or payouts cannot be closed.</Alert>
            {error && <Alert tone="danger">{error.message}</Alert>}
            <Select label="Decision" value={decision} onChange={(e) => setDecision(e.target.value)} options={[{ value: 'complete', label: 'Complete' }, { value: 'in_review', label: 'Mark in review' }, { value: 'reject', label: 'Reject (explain why)' }]} />
            <Textarea label="Note to the user" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
      </Modal>
    </div>
  );
}
