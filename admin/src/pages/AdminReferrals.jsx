import { useState } from 'react';
import { Alert, AsyncContent, Button, DataTable, Input, KeyValue, Modal, PageHeader, Tabs, Textarea } from '../components/ui/index.js';
import { useConfirm } from '../components/ui/ConfirmProvider.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api, newIdempotencyKey } from '../services/api.js';
import { formatDate, formatDateTime, naira } from '../utils/format.js';
import { AdminTable } from './adminShared.jsx';

const TONE = {
  REGISTERED: 'neutral', QUALIFYING: 'info', QUALIFIED: 'success', DISQUALIFIED: 'neutral',
  PENDING_REVIEW: 'warning', SUSPICIOUS: 'warning', UNDER_REVIEW: 'info', APPROVED: 'success', REJECTED: 'danger',
  ELIGIBLE: 'info', PAID: 'success', REVERSED: 'warning',
};
const Badge = ({ v }) => (v ? <span className={`badge badge-${TONE[v] || 'neutral'}`}>{v.replace('_', ' ')}</span> : null);

/** Reason (+ payment reference) → confirmation → authenticator code (asked by the API) → audited action. */
function ActionDialog({ title, confirmType, needsReference, onSubmit, onClose }) {
  const confirmAction = useConfirm();
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    if (!(await confirmAction({ type: confirmType }))) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit({ reason: reason.trim(), paymentReference: reference.trim() || undefined });
      onClose(true);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open onClose={() => onClose(false)} title={title}
      footer={<Button onClick={go} loading={pending} disabled={reason.trim().length < 5 || (needsReference && !reference.trim())}>Continue</Button>}>
      <div className="stack">
        {error && <Alert tone="danger">{error.message}</Alert>}
        {needsReference && <Input label="Payment / transfer reference" value={reference} onChange={(e) => setReference(e.target.value)} />}
        <Textarea label="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

function ReferralEvents({ id, onClose }) {
  const ev = useAsync(() => api.get(`/admin/referrals/${id}/events`), [id]);
  return (
    <Modal open onClose={onClose} title="Referral history" wide>
      <AsyncContent loading={ev.loading} error={ev.error} onRetry={ev.reload}>
        <DataTable rows={ev.data || []} columns={[
          { key: 't', label: 'When', render: (e) => formatDateTime(e.created_at) },
          { key: 'e', label: 'Event', render: (e) => e.event },
          { key: 's', label: 'Change', render: (e) => (e.to_status ? `${e.from_status || '—'} → ${e.to_status}` : '') },
          { key: 'r', label: 'Reason', render: (e) => <span className="xsmall">{e.reason || JSON.stringify(e.metadata)}</span> },
        ]} />
      </AsyncContent>
    </Modal>
  );
}

function Referrals() {
  const { can } = useAuth();
  const toast = useToast();
  const [view, setView] = useState('all');
  const [reloadKey, setReloadKey] = useState(0);
  const [events, setEvents] = useState(null);
  const [deciding, setDeciding] = useState(null);
  return (
    <>
      <Tabs value={view} onChange={setView} tabs={[
        ['all', 'All'], ['pending', 'Pending'], ['qualifying', 'Qualifying'], ['eligible', 'Qualified'], ['suspicious', 'Flagged'],
        ['under_review', 'Under review'], ['rejected', 'Rejected'], ['disqualified', 'Not eligible'],
      ].map(([value, label]) => ({ value, label }))} />
      <AdminTable
        key={view}
        endpoint="/admin/referrals"
        extraParams={{ view }}
        reloadKey={reloadKey}
        filters={[{ name: 'search', label: 'User ID, email, phone, referral code or bill reference' }]}
        columns={[
          { key: 'r', label: 'Referrer', render: (r) => <span>{r.referrer?.name}<br /><span className="xsmall muted">{r.referrer?.email}</span><br /><span className="mono xsmall">{r.code}</span></span> },
          { key: 'u', label: 'Referred user', render: (r) => <span>{r.referred?.name}<br /><span className="xsmall muted">{r.referred?.email} · {r.referred?.phone}</span></span> },
          { key: 'd', label: 'Registered', render: (r) => formatDate(r.registeredAt) },
          { key: 'v', label: 'Verified / Osusu', render: (r) => `${r.verified ? 'Yes' : 'No'} / ${r.osusuActive ? 'Active' : 'No'}` },
          { key: 'q', label: '3-week period / activity', render: (r) => `${Math.min(r.daysActive, r.requiredDays ?? r.daysActive)}/${r.requiredDays ?? '—'} days · ${r.qualifyingActivities}/${r.requiredActivities ?? '—'}` },
          { key: 'a', label: 'Last activity', render: (r) => (r.lastActivity ? formatDateTime(r.lastActivity) : '—') },
          { key: 's', label: 'Status', render: (r) => <span className="stack-sm"><Badge v={r.status} /><Badge v={r.flagStatus} />{r.flagReasons?.length > 0 && <span className="xsmall muted">{r.flagReasons.join(', ')}</span>}</span> },
          { key: 'w', label: 'Reward', render: (r) => (r.reward ? <span><Badge v={r.reward.status} /> {naira(r.reward.amount)}</span> : '—') },
          {
            key: 'x', label: '', render: (r) => (
              <span className="row-wrap">
                <Button variant="ghost" onClick={() => setEvents(r.id)}>History</Button>
                {can('referrals.review') && !r.reward && ['SUSPICIOUS', 'PENDING_REVIEW', 'UNDER_REVIEW'].includes(r.flagStatus) && (
                  <>
                    <Button variant="ghost" onClick={() => setDeciding({ id: r.id, decision: 'APPROVED' })}>Clear</Button>
                    <Button variant="ghost" onClick={() => setDeciding({ id: r.id, decision: 'REJECTED' })}>Reject</Button>
                  </>
                )}
              </span>
            ),
          },
        ]}
      />
      <p className="xsmall muted">Contact details are masked unless your role includes access to sensitive user data. A flag is a hold for review, not proof of wrongdoing.</p>
      {events && <ReferralEvents id={events} onClose={() => setEvents(null)} />}
      {deciding && (
        <ActionDialog
          title={deciding.decision === 'APPROVED' ? 'Clear this referral (it will count)' : 'Reject this referral (it will not count)'}
          confirmType="referral_flag"
          onSubmit={({ reason }) => api.post(`/admin/referrals/${deciding.id}/flag`, { decision: deciding.decision, reason })}
          onClose={(done) => { setDeciding(null); if (done) { toast.success('Decision recorded'); setReloadKey((k) => k + 1); } }}
        />
      )}
    </>
  );
}

const ACTIONS = {
  start_review: { label: 'Start review', perm: 'referrals.review', confirm: 'reward_start_review', from: ['ELIGIBLE'] },
  approve: { label: 'Approve', perm: 'referrals.review', confirm: 'reward_approve', from: ['ELIGIBLE', 'UNDER_REVIEW'] },
  reject: { label: 'Reject', perm: 'referrals.review', confirm: 'reward_reject', from: ['ELIGIBLE', 'UNDER_REVIEW', 'APPROVED'] },
  mark_paid: { label: 'Record payment', perm: 'referrals.pay', confirm: 'reward_mark_paid', from: ['APPROVED'], reference: true },
  reverse: { label: 'Reverse', perm: 'referrals.pay', confirm: 'reward_reverse', from: ['PAID'] },
};

function RewardDetail({ id, onClose }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const d = useAsync(() => api.get(`/admin/referral-rewards/${id}`), [id]);
  const [action, setAction] = useState(null);
  const w = d.data?.reward;
  return (
    <Modal open onClose={onClose} title="Referral reward" wide>
      <AsyncContent loading={d.loading} error={d.error} onRetry={d.reload}>
        {w && (
          <div className="stack">
            <KeyValue items={[
              ['Amount', naira(w.amount)], ['Status', <Badge key="s" v={w.status} />], ['Qualifying referrals', w.required_referrals],
              w.status_reason && ['Note', w.status_reason],
              w.approved_at && ['Approved', `${formatDateTime(w.approved_at)} — ${w.approval_reason || ''}`],
              w.payment_reference && ['Payment reference', <span key="p" className="mono">{w.payment_reference}</span>],
              w.paid_at && ['Paid', formatDateTime(w.paid_at)],
            ].filter(Boolean)} />
            {w.status === 'APPROVED' && w.approved_by === user?.id && <Alert tone="info">You approved this reward, so a different administrator must record the payment.</Alert>}
            <h3 className="small">Referrals in this reward</h3>
            <DataTable rows={d.data.referrals} columns={[
              { key: 'n', label: 'Referred user', render: (r) => r.name },
              { key: 's', label: 'Status', render: (r) => <span><Badge v={r.status} /> <Badge v={r.flagStatus} /></span> },
              { key: 'a', label: 'Account', render: (r) => r.accountStatus },
              { key: 'q', label: 'Qualified', render: (r) => formatDate(r.qualifiedAt) },
            ]} />
            <h3 className="small">History</h3>
            <DataTable rows={d.data.events} columns={[
              { key: 't', label: 'When', render: (e) => formatDateTime(e.created_at) },
              { key: 'e', label: 'Event', render: (e) => e.event },
              { key: 'r', label: 'Reason', render: (e) => <span className="xsmall">{e.reason || ''}</span> },
            ]} />
            <div className="row-wrap">
              {Object.entries(ACTIONS).filter(([, a]) => a.from.includes(w.status) && can(a.perm)).map(([key, a]) => (
                <Button key={key} variant={['reject', 'reverse'].includes(key) ? 'danger' : 'secondary'} onClick={() => setAction(key)}>{a.label}</Button>
              ))}
            </div>
          </div>
        )}
      </AsyncContent>
      {action && (
        <ActionDialog
          title={`${ACTIONS[action].label} — ${naira(w.amount)}`}
          confirmType={ACTIONS[action].confirm}
          needsReference={ACTIONS[action].reference}
          onSubmit={({ reason, paymentReference }) => api.post(`/admin/referral-rewards/${id}/transition`, { action, reason, paymentReference }, { idempotencyKey: newIdempotencyKey() })}
          onClose={(done) => { setAction(null); if (done) { toast.success('Reward updated'); d.reload(); } }}
        />
      )}
    </Modal>
  );
}

function Rewards() {
  const [detail, setDetail] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <>
      <AdminTable
        endpoint="/admin/referral-rewards"
        reloadKey={reloadKey}
        onRowClick={(w) => setDetail(w.id)}
        filters={[{ name: 'status', label: 'All reward statuses', options: ['ELIGIBLE', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PAID', 'REVERSED'] }]}
        columns={[
          { key: 'r', label: 'Referrer', render: (w) => w.referrer?.name },
          { key: 'a', label: 'Amount', align: 'right', render: (w) => <span className="money">{naira(w.amount)}</span> },
          { key: 's', label: 'Status', render: (w) => <Badge v={w.status} /> },
          { key: 'c', label: 'Created', render: (w) => formatDate(w.createdAt) },
          { key: 'ap', label: 'Approved', render: (w) => (w.approvedAt ? formatDate(w.approvedAt) : '—') },
          { key: 'p', label: 'Paid', render: (w) => (w.paidAt ? `${formatDate(w.paidAt)} · ${w.paymentReference}` : '—') },
        ]}
      />
      {detail && <RewardDetail id={detail} onClose={() => { setDetail(null); setReloadKey((k) => k + 1); }} />}
    </>
  );
}

export default function AdminReferrals() {
  const [tab, setTab] = useState('referrals');
  return (
    <div className="stack-lg">
      <PageHeader title="Referral management" subtitle="Qualification is computed by the server. Rewards need a reviewer’s approval and a different administrator to record payment." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'referrals', label: 'Referrals' }, { value: 'rewards', label: 'Rewards' }]} />
      {tab === 'referrals' ? <Referrals /> : <Rewards />}
    </div>
  );
}
