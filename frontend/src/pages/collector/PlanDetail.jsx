import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MessageSquare, PiggyBank, Undo2 } from 'lucide-react';
import {
  Alert, AsyncContent, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, KeyValue, Modal, MoneyInput, PageHeader, Pagination,
  ProgressBar, SkeletonCards, StatCard, StatusBadge, Textarea,
} from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { commissionLabel, daysUntil, FREQUENCY_LABEL, formatDate, formatDateTime, koboToNairaInput, naira, parseNairaToKobo } from '../../utils/format.js';

function ContributeModal({ plan, onClose }) {
  const toast = useToast();
  const [amount, setAmount] = useState(plan.expectedAmount ? koboToNairaInput(plan.expectedAmount) : '');
  const [pending, setPending] = useState(false);
  const kobo = parseNairaToKobo(amount);
  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    try {
      const { data } = await api.post('/collector/contributions', { planId: plan.id, amount: kobo });
      window.location.assign(data.authorizationUrl);
    } catch (err) {
      toast.error(err);
      setPending(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Save into this plan">
      <form className="stack" onSubmit={submit}>
        <p className="small muted">Save any amount you can afford. Your balance updates as soon as the payment provider confirms the payment.</p>
        <MoneyInput label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} error={amount && !kobo ? 'Enter a valid amount' : undefined} hint="Minimum ₦100" autoFocus />
        <Button type="submit" loading={pending} loadingText="Opening secure checkout..." disabled={!kobo || kobo < 10000}>
          Continue to payment {kobo ? `· ${naira(kobo)}` : ''}
        </Button>
      </form>
    </Modal>
  );
}

export default function PlanDetail() {
  const { planId } = useParams();
  const toast = useToast();
  const plan = useAsync(() => api.get(`/collector/plans/${planId}`), [planId]);
  const [page, setPage] = useState(1);
  const contributions = useAsync(() => api.get(`/collector/plans/${planId}/contributions`, { page, pageSize: 15 }), [planId, page]);
  const conversations = useAsync(() => api.get('/messages/conversations'), [planId]);
  const conversationId = useMemo(() => conversations.data?.find((c) => c.planId === planId)?.id, [conversations.data, planId]);
  const [contribute, setContribute] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(null);

  if (plan.loading && !plan.data) return <SkeletonCards count={3} />;
  if (plan.error) return <ErrorState error={plan.error} onRetry={plan.reload} />;
  const p = plan.data;
  const isSaver = p.viewerRole === 'saver';
  const isCollector = p.viewerRole === 'collector';
  const days = daysUntil(p.endDate);
  const termDays = Math.max(1, daysUntil(p.endDate) - daysUntil(p.startDate));
  const elapsed = Math.min(termDays, Math.max(0, termDays - Math.max(0, days)));

  const requestReturn = async () => {
    setPending('request');
    try {
      await api.post(`/collector/plans/${planId}/returns`, { reason: reason || null });
      toast.success('Return requested');
      setRequesting(false);
      plan.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(null);
    }
  };
  const decide = async (action) => {
    setPending(action);
    try {
      await api.post(`/collector/returns/${p.openReturn.id}/${action}`, action === 'reject' ? { reason: isSaver ? 'Withdrawn by saver' : 'Declined by collector' } : undefined);
      toast.success(action === 'approve' ? 'Return approved. The payout is now being processed.' : 'Return request closed');
      plan.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader
        back={{ to: isCollector ? '/app/collector' : '/app/savings', label: isCollector ? 'Collector desk' : 'My savings' }}
        title={p.planName}
        subtitle={isCollector ? `Saver: ${p.saver.name}` : `With ${p.businessName} (${p.collector.name})`}
        actions={
          <>
            {conversationId && (
              <Button variant="secondary" icon={MessageSquare} to={`/app/messages/${conversationId}`}>
                Message {isCollector ? 'saver' : 'collector'}
              </Button>
            )}
            {p.canContribute && (
              <Button variant="gold" icon={PiggyBank} onClick={() => setContribute(true)}>
                Save now
              </Button>
            )}
          </>
        }
      />
      <div className="grid-4">
        <StatCard accent label="Balance" value={naira(p.balance)} sub={<StatusBadge status={p.status} />} />
        <StatCard label="Expected return" value={naira(p.expectedReturn)} sub={`After ${naira(p.estimatedCommission)} commission`} />
        <StatCard label="Total saved" value={naira(p.totalContributed)} sub={p.totalReturned ? `${naira(p.totalReturned)} returned` : undefined} />
        <StatCard label={days > 0 ? 'Days remaining' : 'Matured'} value={days > 0 ? days : formatDate(p.endDate)} sub={`Term ends ${formatDate(p.endDate)}`} />
      </div>

      {p.status === 'active' && (
        <Card>
          <div className="stack-sm">
            <div className="row-between small">
              <span>Started {formatDate(p.startDate)}</span>
              <span>Matures {formatDate(p.endDate)}</span>
            </div>
            <ProgressBar value={elapsed} max={termDays} label="Time elapsed in term" />
          </div>
        </Card>
      )}

      {p.openReturn && (
        <Card title="Return in progress" actions={<StatusBadge status={p.openReturn.status} />}>
          <div className="stack">
            <KeyValue
              items={[
                ['Balance', naira(p.openReturn.grossAmount)],
                ['Collector commission', naira(p.openReturn.commissionAmount)],
                ['Paid to saver', naira(p.openReturn.netAmount)],
                ['Type', p.openReturn.isEarly ? 'Early return (before maturity)' : 'At maturity'],
                ['Requested', formatDateTime(p.openReturn.requestedAt)],
              ]}
            />
            {p.openReturn.status === 'requested' && isCollector && (
              <div className="row-wrap">
                <Button variant="success" onClick={() => decide('approve')} loading={pending === 'approve'}>
                  Approve return
                </Button>
                {p.openReturn.isEarly && (
                  <Button variant="ghost" onClick={() => decide('reject')} loading={pending === 'reject'}>
                    Decline early return
                  </Button>
                )}
              </div>
            )}
            {p.openReturn.status === 'requested' && isSaver && (
              <>
                <p className="small muted">Waiting for the collector to approve. Matured savings must be returned.</p>
                {p.openReturn.requestedBy !== p.collector.id && (
                  <div>
                    <Button variant="ghost" size="sm" onClick={() => decide('reject')} loading={pending === 'reject'}>
                      Withdraw request
                    </Button>
                  </div>
                )}
              </>
            )}
            {['approved', 'processing'].includes(p.openReturn.status) && (
              <Alert tone="info">The return has been approved and the transfer is being processed. It will show as paid once the transfer is confirmed.</Alert>
            )}
          </div>
        </Card>
      )}

      {['active', 'matured'].includes(p.status) && p.balance > 0 && !p.openReturn && (
        <Card>
          <div className="row-between" style={{ flexWrap: 'wrap' }}>
            <div>
              <h3>{p.status === 'matured' ? 'Your savings have matured' : 'Need your money early?'}</h3>
              <p className="small muted">
                {p.status === 'matured' ? 'Request your return. The collector must return matured savings.' : 'You can request an early return. The collector reviews early requests.'}
              </p>
            </div>
            <Button variant={p.status === 'matured' ? 'primary' : 'secondary'} icon={Undo2} onClick={() => setRequesting(true)}>
              Request return
            </Button>
          </div>
        </Card>
      )}

      <div className="grid-2">
        <Card title="Plan terms">
          <KeyValue
            items={[
              ['Frequency', FREQUENCY_LABEL[p.frequency]],
              p.expectedAmount && ['Suggested amount', naira(p.expectedAmount)],
              ['Start date', formatDate(p.startDate)],
              ['End date', formatDate(p.endDate)],
              ['Commission', commissionLabel(p.commissionType, p.commissionValue)],
            ]}
          />
        </Card>
        <Card title="Contribution history" flush>
          <AsyncContent loading={contributions.loading} error={contributions.error} onRetry={contributions.reload} empty={!contributions.data?.length} emptyState={<EmptyState title="No savings yet" message="Confirmed deposits will appear here." />}>
            <DataTable
              rows={contributions.data || []}
              columns={[
                { key: 'd', label: 'Date', render: (c) => formatDateTime(c.paidAt) },
                { key: 'a', label: 'Amount', align: 'right', render: (c) => <span className="money">{naira(c.amount)}</span> },
                { key: 's', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
              ]}
            />
            <Pagination meta={contributions.meta} onPage={setPage} />
          </AsyncContent>
        </Card>
      </div>

      {contribute && <ContributeModal plan={p} onClose={() => setContribute(false)} />}
      <ConfirmDialog
        open={requesting}
        onClose={() => setRequesting(false)}
        onConfirm={requestReturn}
        pending={pending === 'request'}
        title="Request a return?"
        confirmLabel="Request return"
        message={`Balance ${naira(p.balance)} − commission ${naira(p.estimatedCommission)} = ${naira(p.expectedReturn)} to you. New deposits pause while the return is processed.`}
      >
        <Textarea label="Reason (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
