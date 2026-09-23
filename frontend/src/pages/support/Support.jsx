import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LifeBuoy, Plus } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, StatusBadge, Textarea, fieldErrors } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime, naira } from '../../utils/format.js';

export const TICKET_CATEGORIES = [
  { value: 'incorrect_payment', label: 'Incorrect payment' },
  { value: 'missing_contribution', label: 'Missing contribution' },
  { value: 'incorrect_balance', label: 'Incorrect balance' },
  { value: 'payout_issue', label: 'Payout issue' },
  { value: 'collector_issue', label: 'Collector issue' },
  { value: 'bill_payment_issue', label: 'Bill-payment issue' },
  { value: 'unauthorized_activity', label: 'Unauthorised activity' },
  { value: 'other', label: 'Something else' },
];

function NewTicket({ onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ category: 'incorrect_payment', subject: '', description: '', relatedTransactionId: '', relatedGroupId: '', relatedPlanId: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const txs = useAsync(() => api.get('/payments/transactions', { pageSize: 30 }), []);
  const groups = useAsync(() => api.get('/osusu/groups', { pageSize: 50 }).catch(() => ({ data: [] })), []);
  const plans = useAsync(() => api.get('/collector/plans/mine', { pageSize: 50 }).catch(() => ({ data: [] })), []);
  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post('/support/tickets', {
        category: form.category,
        subject: form.subject,
        description: form.description,
        relatedTransactionId: form.relatedTransactionId || null,
        relatedGroupId: form.relatedGroupId || null,
        relatedPlanId: form.relatedPlanId || null,
      });
      toast.success(`Case ${data.reference} opened`);
      onCreated(data.id);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const fe = fieldErrors(error);
  return (
    <Modal open onClose={onClose} title="Report a problem" wide>
      <form className="stack" onSubmit={submit}>
        {error && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
        {form.category === 'unauthorized_activity' && <Alert tone="danger">If you think someone else accessed your account, change your password now from Profile → Security.</Alert>}
        <Select label="What is the problem about?" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={TICKET_CATEGORIES} />
        <Input label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} error={fe.subject} />
        <Textarea label="What happened?" rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={fe.description} hint="Include dates, amounts and references where possible. Never share your password or OTP." />
        <div className="grid-3">
          <Select label="Related transaction" placeholder="None" value={form.relatedTransactionId} onChange={(e) => setForm({ ...form, relatedTransactionId: e.target.value })} options={(txs.data || []).map((t) => ({ value: t.id, label: `${t.reference} · ${naira(t.amount)}` }))} />
          <Select label="Related group" placeholder="None" value={form.relatedGroupId} onChange={(e) => setForm({ ...form, relatedGroupId: e.target.value })} options={(groups.data || []).map((g) => ({ value: g.id, label: g.name }))} />
          <Select label="Related savings plan" placeholder="None" value={form.relatedPlanId} onChange={(e) => setForm({ ...form, relatedPlanId: e.target.value })} options={(plans.data || []).map((p) => ({ value: p.id, label: `${p.planName} · ${p.businessName}` }))} />
        </div>
        <Button type="submit" loading={pending}>
          Open case
        </Button>
      </form>
    </Modal>
  );
}

export default function Support() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const tickets = useAsync(() => api.get('/support/tickets', { page, pageSize: 20 }), [page]);
  return (
    <div className="stack-lg">
      <PageHeader title="Help & disputes" subtitle="Report incorrect payments, missing contributions, payout or collector issues." actions={<Button icon={Plus} onClick={() => setOpen(true)}>New case</Button>} />
      <Card flush>
        <AsyncContent loading={tickets.loading} error={tickets.error} onRetry={tickets.reload} empty={!tickets.data?.length} emptyState={<EmptyState icon={LifeBuoy} title="No support cases" message="If something looks wrong with your money, open a case and our team will investigate." />}>
          <DataTable
            rows={tickets.data || []}
            onRowClick={(t) => navigate(`/app/support/${t.id}`)}
            columns={[
              { key: 'r', label: 'Reference', render: (t) => <span className="mono">{t.reference}</span> },
              { key: 's', label: 'Subject', render: (t) => t.subject },
              { key: 'c', label: 'Category', render: (t) => TICKET_CATEGORIES.find((c) => c.value === t.category)?.label },
              { key: 'st', label: 'Status', render: (t) => <StatusBadge status={t.status} /> },
              { key: 'u', label: 'Updated', render: (t) => formatDateTime(t.updatedAt) },
            ]}
          />
          <Pagination meta={tickets.meta} onPage={setPage} />
        </AsyncContent>
      </Card>
      {open && <NewTicket onClose={() => setOpen(false)} onCreated={(id) => navigate(`/app/support/${id}`)} />}
    </div>
  );
}
