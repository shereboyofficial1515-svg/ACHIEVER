import { useEffect, useState } from 'react';
import { Banknote } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, StatusBadge, Tabs, Textarea } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime, naira } from '../../utils/format.js';

const KINDS = [
  { value: 'osusu_payout', label: 'Osusu payouts' },
  { value: 'saver_return', label: 'Saver returns' },
  { value: 'commission', label: 'Collector commissions' },
];

export default function AdminPayouts() {
  const toast = useToast();
  const [kind, setKind] = useState('osusu_payout');
  const queue = useAsync(() => api.get('/admin/payouts'), []);
  const [action, setAction] = useState(null); // { type: 'confirm'|'fail', item }
  const [form, setForm] = useState({ externalReference: '', note: '', reason: '', overrideReason: '' });
  const [pending, setPending] = useState(false);
  const [approval, setApproval] = useState(null);
  const [error, setError] = useState(null);

  // A large payout needs a second person's approval; attach it automatically when one exists.
  useEffect(() => {
    setApproval(null);
    setError(null);
    if (action?.type !== 'confirm') return;
    api.get('/admin/approvals', { status: 'approved', action: 'large_payout_confirm', pageSize: 100 })
      .then(({ data }) => setApproval((data || []).find((r) => r.targetId === action.item.id) || null))
      .catch(() => setApproval(null));
  }, [action]);

  const run = async () => {
    setPending(true);
    try {
      const { item, type } = action;
      if (type === 'confirm') {
        await api.post(`/admin/payouts/${item.kind}/${item.id}/confirm`, {
          externalReference: form.externalReference,
          note: form.note || null,
          overrideReason: form.overrideReason.trim() || undefined,
          approvalRequestId: approval?.id,
        });
      }
      if (type === 'fail') await api.post(`/admin/payouts/${item.kind}/${item.id}/fail`, { reason: form.reason });
      toast.success(type === 'confirm' ? 'Recorded as paid' : 'Marked as failed');
      setAction(null);
      setForm({ externalReference: '', note: '', reason: '', overrideReason: '' });
      queue.reload();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const retry = async (item) => {
    try {
      await api.post(`/admin/payouts/${item.kind}/${item.id}/retry`);
      toast.success('Payout re-queued');
      queue.reload();
    } catch (err) {
      toast.error(err);
    }
  };

  const items = queue.data?.[kind] || [];
  return (
    <div className="stack-lg">
      <PageHeader title="Payout execution" subtitle="Approved payout instructions awaiting fund movement" />
      <Alert tone="info" icon={Banknote}>
        Approval by an organiser or collector is only an instruction. Record a payout as paid only after the funds have left the custody account; the bank or
        transfer reference is kept in the ledger and audit log.
      </Alert>
      <Tabs value={kind} onChange={setKind} tabs={KINDS.map((k) => ({ ...k, label: `${k.label} (${queue.data?.[k.value]?.length ?? 0})` }))} />
      <Card flush>
        <AsyncContent loading={queue.loading} error={queue.error} onRetry={queue.reload} empty={!items.length} emptyState={<EmptyState title="Nothing waiting" message="Approved payouts appear here until they are confirmed." />}>
          <DataTable
            rows={items}
            columns={[
              { key: 'r', label: 'Recipient', render: (i) => `${i.recipient.name} · ${i.recipient.phone}` },
              { key: 'b', label: 'Bank account', render: (i) => (i.payoutAccount ? `${i.payoutAccount.bankName} ••${i.payoutAccount.last4} (${i.payoutAccount.accountName})` : <StatusBadge status="pending" label="No account on file" />) },
              { key: 'a', label: 'Amount', align: 'right', render: (i) => <span className="money">{naira(i.amount)}</span> },
              { key: 'ref', label: 'Reference', render: (i) => <span className="mono xsmall">{i.reference}</span> },
              { key: 'm', label: 'Mode', render: (i) => i.executionMode?.replace('_', ' ') },
              { key: 'h', label: 'Review', render: (i) => (i.holdReason ? <span className="stack-sm"><StatusBadge status="review_required" label="Held" /><span className="xsmall muted">{i.holdReason}</span></span> : '—') },
              { key: 's', label: 'Status', render: (i) => <span className="stack-sm"><StatusBadge status={i.status} />{i.failureReason && <span className="xsmall muted">{i.failureReason}</span>}</span> },
              { key: 'u', label: 'Updated', render: (i) => formatDateTime(i.updatedAt) },
              {
                key: 'x',
                label: '',
                render: (i) =>
                  i.status === 'failed' ? (
                    <Button size="sm" variant="secondary" onClick={() => retry(i)}>Retry</Button>
                  ) : (
                    <span className="row-wrap">
                      <Button size="sm" variant="success" onClick={() => setAction({ type: 'confirm', item: i })}>Record paid</Button>
                      <Button size="sm" variant="ghost" onClick={() => setAction({ type: 'fail', item: i })}>Failed</Button>
                    </span>
                  ),
              },
            ]}
          />
        </AsyncContent>
      </Card>
      <Modal
        open={Boolean(action)}
        onClose={() => !pending && setAction(null)}
        title={action?.type === 'confirm' ? 'Record payout as paid' : 'Mark payout as failed'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAction(null)} disabled={pending}>Cancel</Button>
            <Button variant={action?.type === 'confirm' ? 'success' : 'danger'} onClick={run} loading={pending} disabled={action?.type === 'confirm' ? form.externalReference.trim().length < 3 : form.reason.trim().length < 3}>
              {action?.type === 'confirm' ? 'Confirm payment' : 'Mark failed'}
            </Button>
          </>
        }
      >
        {action && (
          <div className="stack">
            <p>
              {naira(action.item.amount)} to <strong>{action.item.recipient.name}</strong>
            </p>
            {error && <Alert tone="danger">{error.message}</Alert>}
            {action.type === 'confirm' ? (
              <>
                {(action.item.holdReason || error?.code === 'PAYOUT_HELD') && (
                  <>
                    <Alert tone="warning">Held for review: {action.item.holdReason || error.message}</Alert>
                    <Textarea label="Override reason (required, audited)" rows={2} value={form.overrideReason} onChange={(e) => setForm({ ...form, overrideReason: e.target.value })} />
                  </>
                )}
                {approval && <Alert tone="success">Second approval attached: approved by {approval.decidedBy?.name}.</Alert>}
                {error?.code === 'APPROVAL_REQUIRED' && !approval && (
                  <Alert tone="info">Create a “Confirm a large payout” request in Approvals for payout ID {action.item.id}, and have another authorised person approve it.</Alert>
                )}
                <Input label="Bank / transfer reference" value={form.externalReference} onChange={(e) => setForm({ ...form, externalReference: e.target.value })} />
                <Textarea label="Note (optional)" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </>
            ) : (
              <Textarea label="Reason" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
