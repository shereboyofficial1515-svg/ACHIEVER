import { useState } from 'react';
import { FileSearch } from 'lucide-react';
import { Alert, Button, KeyValue, Modal, PageHeader, StatusBadge, Textarea } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';
import ReasonDialog from '../../components/domain/ReasonDialog.jsx';

export default function AdminVerification() {
  const toast = useToast();
  const [record, setRecord] = useState(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [askReason, setAskReason] = useState(false);
  // Opening an identity document is logged with the reviewer's stated reason.
  const viewDocument = () => setAskReason(true);
  const openDocument = async (reason) => {
    const { data } = await api.get(`/admin/verification/${record.id}/document`, { reason });
    setAskReason(false);
    window.open(data.url, '_blank', 'noopener,noreferrer');
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
      <PageHeader title="Identity verification" subtitle="Review identity documents. Full document numbers are never stored or shown; every document view is logged with a reason." />
      <ReasonDialog
        open={askReason}
        title="Open identity document"
        description="Identity documents are highly sensitive. Your reason is written to the data access log before the document opens."
        confirmLabel="Open document"
        onClose={() => setAskReason(false)}
        onSubmit={openDocument}
      />
      <AdminTable
        endpoint="/admin/verification"
        reloadKey={reloadKey}
        onRowClick={setRecord}
        filters={[{ name: 'status', label: 'All statuses', options: ['manual_review', 'pending', 'verified', 'failed'], initial: 'manual_review' }]}
        columns={[
          { key: 'u', label: 'User', render: (r) => `${r.user?.full_name} · ${r.user?.email}` },
          { key: 't', label: 'ID', render: (r) => `${r.id_type.replace('_', ' ').toUpperCase()} ••${r.id_last4}` },
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
                ['ID type', record.id_type.replace('_', ' ').toUpperCase()],
                ['Document number', record.document_number_masked || `••••${record.id_last4}`],
                record.issuing_country && ['Issuing country', record.issuing_country],
                record.issue_date && ['Issued', formatDate(record.issue_date)],
                record.expiry_date && ['Expires', formatDate(record.expiry_date)],
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
