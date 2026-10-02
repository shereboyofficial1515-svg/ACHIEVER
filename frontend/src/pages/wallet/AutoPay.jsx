import { useState } from 'react';
import { CalendarClock, Pause, Play, XCircle } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, EmptyState, KeyValue, PageHeader, StatusBadge } from '../../components/ui/index.js';
import TransactionApproval from '../../components/domain/TransactionApproval.jsx';
import { useConfirm } from '../../components/ui/ConfirmProvider.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDate, formatDateTime, naira } from '../../utils/format.js';

const STATUS_TEXT = { PENDING_AUTHORIZATION: 'Awaiting approval', ACTIVE: 'Active', PAUSED: 'Paused', CANCELLED: 'Cancelled', EXPIRED: 'Expired', COMPLETED: 'Completed' };
const RUN_TEXT = { SUCCESS: 'Paid', INSUFFICIENT_FUNDS: 'Not paid: wallet balance too low', FAILED: 'Not paid', SKIPPED: 'Skipped: above your limit' };

/** Set up automatic OSUSU contributions for a group (explicit approval). Used from the group page. */
export function AutoPaySetup({ groupId, groupName, onDone, onCancel }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/wallet/mandates', { groupId });
      setDraft(data);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  if (!draft) {
    return (
      <div className="stack">
        {error && <Alert tone="danger">{error.message}</Alert>}
        <p className="small">Pay each {groupName} contribution automatically from your ACHIEVER Wallet when it is due. You approve once and can pause or cancel at any time.</p>
        <div className="row-wrap">
          <Button icon={CalendarClock} onClick={start} loading={busy}>Review automatic payments</Button>
          <Button variant="secondary" onClick={onCancel}>Not now</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="stack">
      <KeyValue items={[['Group', draft.groupName], ['Amount each time', naira(draft.amount)], ['When', 'When each contribution is due'], ['From', 'Your ACHIEVER Wallet']]} />
      <Alert tone="info">{draft.terms}</Alert>
      <TransactionApproval
        amount={draft.amount}
        title="Automatic payments"
        subtitle={`${draft.groupName} · each contribution`}
        authorizeUrl={`/wallet/mandates/${draft.id}/authorize`}
        confirmUrl={`/wallet/mandates/${draft.id}/confirm`}
        options={draft.approval}
        confirmLabel="Setting up"
        footnote="Nothing is paid now. Each payment happens only when a contribution is due and your balance is enough."
        onCancel={() => { api.post(`/wallet/mandates/${draft.id}/state`, { action: 'cancel' }).catch(() => {}); onCancel(); }}
        onApproved={onDone}
      />
    </div>
  );
}

export default function AutoPay() {
  const toast = useToast();
  const confirm = useConfirm();
  const list = useAsync(() => api.get('/wallet/mandates'), []);

  const act = async (m, action) => {
    if (action === 'cancel') {
      const ok = await confirm({ title: 'Cancel automatic payments?', message: `${m.groupName || 'This group'}: contributions will no longer be paid automatically.`, confirmLabel: 'Cancel automatic payments', severity: 'danger' });
      if (ok !== true) return;
    }
    try {
      await api.post(`/wallet/mandates/${m.id}/state`, { action });
      toast.success({ pause: 'Paused', resume: 'Resumed', cancel: 'Cancelled' }[action]);
      list.reload();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/wallet', label: 'Wallet' }} title="Automatic payments" subtitle="OSUSU contributions paid from your wallet when due" />
      <AsyncContent
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        empty={!list.data?.length}
        emptyState={<EmptyState icon={CalendarClock} title="No automatic payments" message="Open an OSUSU group you belong to and choose “Pay automatically from wallet”." action={<Button to="/app/osusu">My OSUSU groups</Button>} />}
      >
        <div className="stack">
          {(list.data || []).map((m) => (
            <Card key={m.id} title={m.groupName || 'OSUSU group'} actions={<StatusBadge status={m.status.toLowerCase()} label={STATUS_TEXT[m.status]} />}>
              <div className="stack">
                <KeyValue items={[
                  ['Amount each time', naira(m.amount)],
                  ['Paid so far', naira(m.totalPaid)],
                  m.endDate && ['Ends', formatDate(m.endDate)],
                  m.authorizedAt && ['Approved', formatDateTime(m.authorizedAt)],
                ].filter(Boolean)}
                />
                {m.runs?.length > 0 && (
                  <ul className="list xsmall">
                    {m.runs.map((r) => <li key={`${r.at}-${r.status}`}>{formatDateTime(r.at)} · {RUN_TEXT[r.status] || r.status}{r.amount ? ` · ${naira(r.amount)}` : ''}</li>)}
                  </ul>
                )}
                <div className="row-wrap">
                  {m.status === 'ACTIVE' && <Button size="sm" variant="secondary" icon={Pause} onClick={() => act(m, 'pause')}>Pause</Button>}
                  {m.status === 'PAUSED' && <Button size="sm" variant="secondary" icon={Play} onClick={() => act(m, 'resume')}>Resume</Button>}
                  {['ACTIVE', 'PAUSED', 'PENDING_AUTHORIZATION'].includes(m.status) && <Button size="sm" variant="danger" icon={XCircle} onClick={() => act(m, 'cancel')}>Cancel</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </AsyncContent>
    </div>
  );
}
