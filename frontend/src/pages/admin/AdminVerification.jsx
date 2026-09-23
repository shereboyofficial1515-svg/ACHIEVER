import { useState } from 'react';
import { FileSearch } from 'lucide-react';
import { Alert, Button, KeyValue, Modal, PageHeader, StatusBadge, Textarea } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';

export default function AdminVerification() {
  const toast = useToast();
  const [record, setRecord] = useState(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const viewDocument = async () => {
    try {
      const { data } = await api.get(`/admin/verification/${record.id}/document`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err);
    }
  };
  const decide = async (decision) => {
    setPending(decision);
    try {
      await api.post(`/admin/verification/${record.id}/decision`, { decision, note: note || null });
      toast.success(decision === 'verified' ? 'Identity verified' : 'Verification rejected');
      setRecord(null);
      setNote('');
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader title="Identity verification" subtitle="Review operator identity documents. Full BVN/NIN numbers are never stored or shown." />
      <AdminTable
        endpoint="/admin/verification"
        reloadKey={reloadKey}
        onRowClick={setRecord}
        filters={[{ name: 'status', label: 'All statuses', options: ['manual_review', 'pending', 'verified', 'failed'], initial: 'manual_review' }]}
        columns={[
          { key: 'u', label: 'User', render: (r) => `${r.user?.full_name} · ${r.user?.email}` },
          { key: 't', label: 'ID', render: (r) => `${r.id_type.toUpperCase()} ••${r.id_last4}` },
          { key: 'd', label: 'Document', render: (r) => (r.documentUploaded ? 'Uploaded' : 'Missing') },
          { key: 's', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'c', label: 'Submitted', render: (r) => formatDateTime(r.created_at) },
        ]}
      />
      <Modal
        open={Boolean(record)}
        onClose={() => setRecord(null)}
        title="Review identity"
        footer={
          record && ['pending', 'manual_review'].includes(record.status) && (
            <>
              <Button variant="danger" onClick={() => decide('failed')} loading={pending === 'failed'} disabled={Boolean(pending)}>
                Reject
              </Button>
              <Button variant="success" onClick={() => decide('verified')} loading={pending === 'verified'} disabled={Boolean(pending) || !record.documentUploaded}>
                Approve
              </Button>
            </>
          )
        }
      >
        {record && (
          <div className="stack">
            <KeyValue
              items={[
                ['Name', record.user?.full_name],
                ['Email', record.user?.email],
                ['ID type', record.id_type.toUpperCase()],
                ['Last 4 digits', record.id_last4],
                ['Provider', record.provider],
                ['Status', <StatusBadge key="s" status={record.status} />],
                ['Submitted', formatDate(record.created_at)],
              ]}
            />
            <Alert tone="info">Confirm the document is genuine, belongs to this person, and that the name and last four digits match. Document views are audit-logged.</Alert>
            {record.documentUploaded ? (
              <Button variant="secondary" icon={FileSearch} onClick={viewDocument}>
                View document (link expires in 2 minutes)
              </Button>
            ) : (
              <Alert tone="warning">No document uploaded yet — the user has been asked to upload one.</Alert>
            )}
            {['pending', 'manual_review'].includes(record.status) && <Textarea label="Note to user (required when rejecting)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
          </div>
        )}
      </Modal>
    </div>
  );
}
