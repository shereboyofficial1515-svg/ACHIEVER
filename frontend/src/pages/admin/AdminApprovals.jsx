import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Alert, Button, Checkbox, Input, Modal, MoneyInput, PageHeader, Select, StatusBadge, Textarea, fieldErrors } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';
import { formatDateTime, parseNairaToKobo } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';

const ACTIONS = [
  { value: 'transaction_reversal', label: 'Reverse a transaction', target: 'Transaction ID', perm: 'finance.reversal.request' },
  { value: 'transaction_adjustment', label: 'Ledger adjustment', target: 'Related transaction ID', perm: 'finance.reversal.request' },
  { value: 'collector_revoke', label: 'Revoke a collector', target: 'Collector account ID', perm: 'collectors.status' },
  { value: 'risk_restriction_lift', label: 'Lift an account restriction', target: 'User ID', perm: 'risk.review' },
  { value: 'large_payout_confirm', label: 'Confirm a large payout', target: 'Payout ID', perm: 'finance.payouts.execute' },
];
const label = (a) => ACTIONS.find((x) => x.value === a)?.label || a;

function NewRequest({ onClose, onCreated }) {
  const { can } = useAuth();
  const allowed = ACTIONS.filter((a) => can(a.perm));
  const [form, setForm] = useState({ action: allowed[0]?.value || '', targetId: '', reason: '', refund: false, amount: '', direction: 'credit', description: '', kind: 'osusu_payout', status: 'normal' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const def = ACTIONS.find((a) => a.value === form.action);

  const submit = async () => {
    setPending(true);
    setError(null);
    const payload = {};
    if (form.action === 'transaction_reversal') payload.refund = form.refund;
    if (form.action === 'transaction_adjustment') Object.assign(payload, { amount: parseNairaToKobo(form.amount), direction: form.direction, description: form.description || undefined });
    if (form.action === 'large_payout_confirm') payload.kind = form.kind;
    if (form.action === 'risk_restriction_lift') payload.status = form.status;
    try {
      await api.post('/admin/approvals', { action: form.action, targetId: form.targetId.trim(), reason: form.reason, payload });
      onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const fe = fieldErrors(error);
  return (
    <Modal open onClose={onClose} title="Request a sensitive action" footer={<Button onClick={submit} loading={pending}>Submit for approval</Button>}>
      <div className="stack">
        <Alert tone="info">A different authorised person must approve this before it can be executed. Requests expire after 48 hours.</Alert>
        {error && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
        <Select label="Action" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} options={allowed} />
        <Input label={def?.target || 'Target ID'} value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })} error={fe.targetId} />
        {form.action === 'transaction_reversal' && <Checkbox label="Also refund the payer through Paystack" checked={form.refund} onChange={(e) => setForm({ ...form, refund: e.target.checked })} />}
        {form.action === 'transaction_adjustment' && (
          <div className="grid-2">
            <MoneyInput label="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <Select label="Direction" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} options={[{ value: 'credit', label: 'Credit' }, { value: 'debit', label: 'Debit' }]} />
            <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        )}
        {form.action === 'large_payout_confirm' && (
          <Select label="Payout type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} options={[{ value: 'osusu_payout', label: 'Osusu payout' }, { value: 'saver_return', label: 'Saver return' }, { value: 'commission', label: 'Commission' }]} />
        )}
        {form.action === 'risk_restriction_lift' && (
          <Select label="New status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[{ value: 'normal', label: 'Normal' }, { value: 'review_required', label: 'Keep under review' }]} />
        )}
        <Textarea label="Reason" rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={fe.reason} hint="At least 10 characters. Visible to the approver and kept in the audit trail." />
      </div>
    </Modal>
  );
}

export default function AdminApprovals() {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  const act = async (path, body, message) => {
    try {
      await api.post(path, body);
      toast.success(message);
      reload();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader
        title="Approvals"
        subtitle="Two-person rule for reversals, adjustments, collector revocation, lifting restrictions and large payouts"
        actions={<Button icon={Plus} onClick={() => setOpen(true)}>New request</Button>}
      />
      <AdminTable
        endpoint="/admin/approvals"
        reloadKey={reloadKey}
        filters={[
          { name: 'status', label: 'Any status', options: ['pending', 'approved', 'rejected', 'executed', 'expired', 'cancelled'] },
          { name: 'action', label: 'Any action', options: ACTIONS.map((a) => ({ value: a.value, label: a.label })) },
        ]}
        columns={[
          { key: 'a', label: 'Action', render: (r) => label(r.action) },
          { key: 't', label: 'Target', render: (r) => <span className="mono xsmall">{r.targetId.slice(0, 8)}</span> },
          { key: 'r', label: 'Reason', render: (r) => <span className="small">{r.reason}</span> },
          { key: 'by', label: 'Requested', render: (r) => <span className="small">{r.requestedBy.name}<br /><span className="xsmall muted">{formatDateTime(r.requestedAt)}</span></span> },
          { key: 'd', label: 'Decision', render: (r) => (r.decidedBy ? <span className="small">{r.decidedBy.name}{r.decisionNote ? `: ${r.decisionNote}` : ''}</span> : '—') },
          { key: 's', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          {
            key: 'x',
            label: '',
            render: (r) => (
              <div className="row-wrap">
                {r.status === 'pending' && r.requestedBy.id !== user.id && (
                  <>
                    <Button size="sm" onClick={() => act(`/admin/approvals/${r.id}/decision`, { decision: 'approve' }, 'Approved')}>Approve</Button>
                    <Button size="sm" variant="secondary" onClick={() => act(`/admin/approvals/${r.id}/decision`, { decision: 'reject' }, 'Rejected')}>Reject</Button>
                  </>
                )}
                {r.status === 'pending' && r.requestedBy.id === user.id && (
                  <>
                    <span className="xsmall muted">Awaiting a second approver</span>
                    <Button size="sm" variant="ghost" onClick={() => act(`/admin/approvals/${r.id}/cancel`, undefined, 'Cancelled')}>Cancel</Button>
                  </>
                )}
                {r.status === 'approved' && r.action !== 'large_payout_confirm' && (
                  <Button size="sm" variant="danger" onClick={() => act(`/admin/approvals/${r.id}/execute`, undefined, 'Action completed')}>Execute</Button>
                )}
                {r.status === 'approved' && r.action === 'large_payout_confirm' && <span className="xsmall muted">Use request ID {r.id.slice(0, 8)} when confirming the payout</span>}
              </div>
            ),
          },
        ]}
      />
      {open && (
        <NewRequest
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            toast.success('Request submitted for a second approval');
            reload();
          }}
        />
      )}
    </div>
  );
}
