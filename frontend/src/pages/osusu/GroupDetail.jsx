import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDown, ArrowUp, CalendarPlus, CheckCircle2, Copy, Download, MessageSquare, Phone, Play, ShieldAlert, UserPlus, UsersRound, XCircle,
} from 'lucide-react';
import {
  Alert, AsyncContent, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Input, KeyValue, Loader, Modal, PageHeader,
  Pagination, ProgressBar, Select, SkeletonCards, StatCard, StatusBadge, Tabs, UserAvatar, fieldErrors,
} from '../../components/ui/index.js';
import { MeetingList, ScheduleMeetingModal } from '../app/Meetings.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useCalls } from '../../contexts/CallContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { FREQUENCY_LABEL, formatDate, formatDateTime, naira } from '../../utils/format.js';
import { TX_TYPE_LABEL } from '../../utils/status.js';

async function startCheckout(contributionId, toast, setPaying) {
  setPaying(contributionId);
  try {
    const { data } = await api.post(`/osusu/contributions/${contributionId}/pay`);
    window.location.assign(data.authorizationUrl);
  } catch (err) {
    toast.error(err);
    setPaying(null);
  }
}

// ---------------------------------------------------------------------------
function Overview({ group, onChanged, conversationId }) {
  const s = group.summary;
  const toast = useToast();
  const calls = useCalls();
  const navigate = useNavigate();
  const [paying, setPaying] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [pending, setPending] = useState(false);
  const mine = useAsync(() => (group.membership?.status === 'active' ? api.get(`/osusu/groups/${group.id}/contributions`, { pageSize: 5 }) : Promise.resolve({ data: [] })), [group.id]);
  const openMine = (mine.data || []).filter((c) => c.status !== 'paid');

  const act = async () => {
    setPending(true);
    try {
      if (confirm === 'start') await api.post(`/osusu/groups/${group.id}/start`);
      if (confirm === 'cancel') await api.post(`/osusu/groups/${group.id}/cancel`);
      if (confirm === 'leave') {
        await api.post(`/osusu/groups/${group.id}/leave`);
        navigate('/app/osusu');
        return;
      }
      if (confirm === 'payout') await api.post(`/osusu/cycles/${s.current_cycle.id}/payout/approve`);
      toast.success({ start: 'Group started. Cycle 1 is open.', cancel: 'Group cancelled', payout: 'Payout approved and sent for processing' }[confirm]);
      setConfirm(null);
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };

  const cc = s?.current_cycle;
  return (
    <div className="stack-lg">
      {group.status === 'recruiting' && (
        <Alert tone="info">
          This group is recruiting ({s?.active_members ?? 0} of {group.maxMembers} members{s?.pending_members ? `, ${s.pending_members} awaiting approval` : ''}).{' '}
          {group.permissions.isAdmin ? 'Start the group once everyone has joined; the payout order is fixed at that point.' : 'Contributions begin when the organiser starts the group.'}
        </Alert>
      )}
      {group.membership?.riskStatus && group.membership.riskStatus !== 'good' && (
        <Alert tone="danger" icon={ShieldAlert}>
          You have overdue contributions in this group. {group.membership.hasReceivedPayout ? 'You have already received your payout, so please bring your contributions up to date for the members still waiting.' : 'Please pay as soon as possible.'}
        </Alert>
      )}

      {openMine.length > 0 && (
        <Card title="Your contributions due" flush>
          <ul className="list">
            {openMine.map((c) => (
              <li key={c.id} className="contribution-card">
                <div className="grow">
                  <p style={{ fontWeight: 500 }}>Cycle {c.cycleNumber}</p>
                  <p className="xsmall muted">Due {formatDate(c.dueDate)}</p>
                </div>
                <StatusBadge status={c.status} />
                <span className="money">{naira(c.amount)}</span>
                <Button size="sm" variant={c.status === 'overdue' ? 'danger' : 'gold'} onClick={() => startCheckout(c.id, toast, setPaying)} loading={paying === c.id}>
                  Pay now
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {cc && (
        <Card title={`Cycle ${cc.cycle_number} of ${s.total_cycles}`} actions={<StatusBadge status={cc.status} />}>
          <div className="stack">
            <div className="row-between small">
              <span>
                {naira(cc.collected_amount)} collected of {naira(cc.expected_amount)}
              </span>
              <span className="muted">
                {cc.paid_count} paid · {cc.unpaid_count} unpaid
              </span>
            </div>
            <ProgressBar value={cc.collected_amount} max={cc.expected_amount} label="Cycle collection progress" />
            <KeyValue
              items={[
                ['Due date', formatDate(cc.due_date)],
                ['Payout recipient', cc.recipient_name],
                ['Payout status', <StatusBadge key="ps" status={cc.payout_status} />],
                ['Outstanding', naira(cc.outstanding_amount)],
                s.next_cycle && ['Next recipient', `${s.next_cycle.recipient_name} · ${formatDate(s.next_cycle.due_date)}`],
              ]}
            />
            {group.permissions.isAdmin && cc.status === 'funded' && cc.payout_status === 'scheduled' && (
              <Button variant="success" icon={CheckCircle2} onClick={() => setConfirm('payout')}>
                Approve payout of {naira(cc.expected_amount)}
              </Button>
            )}
          </div>
        </Card>
      )}

      {s && (
        <div className="grid-4">
          <StatCard label="Members" value={s.active_members} sub={`${naira(group.contributionAmount)} ${FREQUENCY_LABEL[group.frequency].toLowerCase()}`} />
          <StatCard label="Pool per cycle" value={naira(s.pool_per_cycle)} />
          <StatCard label="Cycles completed" value={`${s.completed_cycles}${s.total_cycles ? ` / ${s.total_cycles}` : ''}`} sub={s.total_cycles ? `${s.remaining_cycles} remaining` : 'Not started'} />
          <StatCard label="Total collected" value={naira(s.total_collected)} sub={`${naira(s.total_outstanding)} outstanding · ${s.overdue_contributions} overdue`} />
        </div>
      )}

      <Card title="Group">
        <div className="stack">
          {group.description && <p className="small">{group.description}</p>}
          <KeyValue
            items={[
              ['Organiser', group.admin?.name],
              ['Contribution', `${naira(group.contributionAmount)} · ${FREQUENCY_LABEL[group.frequency]}`],
              ['Start date', formatDate(group.startDate)],
              ['Grace period', `${group.gracePeriodDays} day(s)`],
              ['Payout order', { join_order: 'Join order', random: 'Random draw', manual: 'Set by organiser' }[group.payoutOrderMethod]],
              group.meetingSchedule && ['Meetings', group.meetingSchedule],
              group.membership?.payoutPosition && ['Your payout position', group.membership.payoutPosition],
            ]}
          />
          {group.joinCode && (
            <div className="row-wrap">
              <span className="small muted">Group code</span>
              <span className="join-code">{group.joinCode}</span>
              <Button size="sm" variant="ghost" icon={Copy} onClick={() => navigator.clipboard?.writeText(group.joinCode).then(() => toast.success('Code copied'))}>
                Copy
              </Button>
            </div>
          )}
          <div className="row-wrap">
            {conversationId && (
              <>
                <Button variant="secondary" icon={MessageSquare} to={`/app/messages/${conversationId}`}>
                  Group chat
                </Button>
                <Button variant="secondary" icon={Phone} onClick={() => calls.startCall(conversationId, 'voice')} disabled={calls.busy || calls.inCall}>
                  Group call
                </Button>
              </>
            )}
            {group.permissions.isAdmin && group.status === 'recruiting' && (
              <>
                <Button icon={Play} onClick={() => setConfirm('start')}>
                  Start group
                </Button>
                <Button variant="ghost" icon={XCircle} onClick={() => setConfirm('cancel')}>
                  Cancel group
                </Button>
              </>
            )}
            {!group.permissions.isAdmin && group.status === 'recruiting' && group.membership && (
              <Button variant="ghost" onClick={() => setConfirm('leave')}>
                Leave group
              </Button>
            )}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={act}
        pending={pending}
        tone={confirm === 'cancel' || confirm === 'leave' ? 'danger' : 'primary'}
        title={{ start: 'Start this group?', cancel: 'Cancel this group?', leave: 'Leave this group?', payout: 'Approve this payout?' }[confirm] || ''}
        confirmLabel={{ start: 'Start group', cancel: 'Cancel group', leave: 'Leave', payout: 'Approve payout' }[confirm]}
        message={
          {
            start: 'The payout order will be fixed, cycle 1 contributions will open, and pending join requests will be declined. Members cannot leave after this.',
            cancel: 'No contributions have been collected. All members will be notified.',
            leave: 'You can leave because the group has not started yet.',
            payout: cc ? `${naira(cc.expected_amount)} will be released to ${cc.recipient_name}. The payout is recorded as paid only after the transfer is confirmed.` : '',
          }[confirm]
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
function InviteModal({ groupId, open, onClose, onSent }) {
  const toast = useToast();
  const [form, setForm] = useState({ email: '', phone: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [link, setLink] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post(`/osusu/groups/${groupId}/invites`, { email: form.email || undefined, phone: form.phone || undefined });
      setLink(data.link);
      toast.success('Invitation sent');
      onSent();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const fe = fieldErrors(error);
  return (
    <Modal open={open} onClose={onClose} title="Invite a member">
      {link ? (
        <div className="stack">
          <Alert tone="success">Invitation sent. You can also share this personal link directly — it only works for the invited email or phone.</Alert>
          <Input label="Invitation link" readOnly value={link} onFocus={(e) => e.target.select()} />
          <Button onClick={() => { setLink(null); setForm({ email: '', phone: '' }); }}>Invite another</Button>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          {error && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
          <Input label="Email address" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={fe.email} />
          <Input label="or phone number" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={fe.phone} />
          <Button type="submit" loading={pending} disabled={!form.email && !form.phone}>
            Send invitation
          </Button>
        </form>
      )}
    </Modal>
  );
}

function PayoutOrderModal({ groupId, members, open, onClose, onSaved }) {
  const toast = useToast();
  const [order, setOrder] = useState(() => [...members].sort((a, b) => (a.payoutPosition || 999) - (b.payoutPosition || 999)));
  const [pending, setPending] = useState(false);
  const move = (i, d) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setOrder(next);
  };
  const save = async () => {
    setPending(true);
    try {
      await api.put(`/osusu/groups/${groupId}/payout-order`, { memberIds: order.map((m) => m.id) });
      toast.success('Payout order saved');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Set payout order" footer={<Button onClick={save} loading={pending}>Save order</Button>}>
      <div className="stack-sm">
        <p className="small muted">Position 1 receives the first payout. The order is locked when the group starts.</p>
        {order.map((m, i) => (
          <div key={m.id} className="reorder-item">
            <span className="position-pill">{i + 1}</span>
            <span className="grow">{m.name}</span>
            <button type="button" className="icon-button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${m.name} up`}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="icon-button" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${m.name} down`}>
              <ArrowDown size={16} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Members({ group }) {
  const toast = useToast();
  const members = useAsync(() => api.get(`/osusu/groups/${group.id}/members`), [group.id]);
  const invites = useAsync(() => (group.permissions.isAdmin ? api.get(`/osusu/groups/${group.id}/invites`) : Promise.resolve({ data: [] })), [group.id]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [remove, setRemove] = useState(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(null);
  const isAdmin = group.permissions.isAdmin;
  const recruiting = group.status === 'recruiting';

  const approve = async (m) => {
    setPending(m.id);
    try {
      await api.post(`/osusu/members/${m.id}/approve`);
      toast.success(`${m.name} approved`);
      members.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(null);
    }
  };
  const doRemove = async () => {
    setPending(remove.id);
    try {
      await api.post(`/osusu/members/${remove.id}/remove`, { reason: reason || null });
      toast.info('Member removed');
      setRemove(null);
      setReason('');
      members.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(null);
    }
  };
  const revoke = async (id) => {
    try {
      await api.del(`/invites/manage/${id}`);
      invites.reload();
    } catch (err) {
      toast.error(err);
    }
  };

  const active = (members.data || []).filter((m) => m.status === 'active');
  const pendingList = (members.data || []).filter((m) => m.status === 'pending_approval');

  return (
    <div className="stack-lg">
      {isAdmin && recruiting && (
        <div className="row-wrap">
          <Button icon={UserPlus} onClick={() => setInviteOpen(true)}>
            Invite member
          </Button>
          {group.payoutOrderMethod === 'manual' && active.length >= 2 && (
            <Button variant="secondary" onClick={() => setOrderOpen(true)}>
              Set payout order
            </Button>
          )}
        </div>
      )}
      {pendingList.length > 0 && isAdmin && (
        <Card title={`Join requests (${pendingList.length})`} flush>
          <ul className="list">
            {pendingList.map((m) => (
              <li key={m.id} className="list-item">
                <UserAvatar name={m.name} src={m.avatarUrl} />
                <span className="grow">{m.name}</span>
                <Button size="sm" onClick={() => approve(m)} loading={pending === m.id}>
                  Approve
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRemove(m)}>
                  Decline
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={`Members (${active.length})`} flush>
        <AsyncContent loading={members.loading} error={members.error} onRetry={members.reload} empty={!active.length} emptyState={<EmptyState icon={UsersRound} title="No members yet" message="Invite people or share the group code." />}>
          <DataTable
            rows={active}
            columns={[
              { key: 'pos', label: 'Position', render: (m) => (m.payoutPosition ? <span className="position-pill">{m.payoutPosition}</span> : '—') },
              {
                key: 'name',
                label: 'Member',
                render: (m) => (
                  <span className="row">
                    <UserAvatar name={m.name} src={m.avatarUrl} size={30} /> {m.name} {m.isOrganiser && <span className="chip">Organiser</span>}
                  </span>
                ),
              },
              { key: 'payout', label: 'Payout', render: (m) => (m.hasReceivedPayout ? <StatusBadge status="paid_out" label={`Received (cycle ${m.payoutReceivedCycle})`} /> : <StatusBadge status="scheduled" label="Waiting" />) },
              ...(isAdmin || group.permissions.isStaff ? [{ key: 'risk', label: 'Standing', render: (m) => <StatusBadge status={m.riskStatus} /> }] : []),
              ...(isAdmin && recruiting
                ? [{ key: 'actions', label: '', render: (m) => (!m.isOrganiser ? <Button size="sm" variant="ghost" onClick={() => setRemove(m)}>Remove</Button> : null) }]
                : []),
            ]}
          />
        </AsyncContent>
      </Card>
      {isAdmin && (invites.data || []).length > 0 && (
        <Card title="Invitations" flush>
          <DataTable
            rows={invites.data}
            columns={[
              { key: 'to', label: 'Sent to', render: (i) => i.email || i.phone },
              { key: 'status', label: 'Status', render: (i) => <StatusBadge status={i.status} /> },
              { key: 'exp', label: 'Expires', render: (i) => formatDate(i.expiresAt) },
              { key: 'x', label: '', render: (i) => (i.status === 'pending' ? <Button size="sm" variant="ghost" onClick={() => revoke(i.id)}>Revoke</Button> : null) },
            ]}
          />
        </Card>
      )}
      {inviteOpen && <InviteModal groupId={group.id} open onClose={() => setInviteOpen(false)} onSent={invites.reload} />}
      {orderOpen && <PayoutOrderModal groupId={group.id} members={active} open onClose={() => setOrderOpen(false)} onSaved={members.reload} />}
      <ConfirmDialog open={Boolean(remove)} onClose={() => setRemove(null)} onConfirm={doRemove} pending={Boolean(pending)} tone="danger" title={remove?.status === 'pending_approval' ? 'Decline request?' : `Remove ${remove?.name}?`} confirmLabel={remove?.status === 'pending_approval' ? 'Decline' : 'Remove'}>
        <Input label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
function CycleModal({ cycleId, onClose, onChanged }) {
  const toast = useToast();
  const cycle = useAsync(() => api.get(`/osusu/cycles/${cycleId}`), [cycleId]);
  const [paying, setPaying] = useState(null);
  const [pending, setPending] = useState(false);
  const approve = async () => {
    setPending(true);
    try {
      await api.post(`/osusu/cycles/${cycleId}/payout/approve`);
      toast.success('Payout approved');
      cycle.reload();
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  const c = cycle.data;
  return (
    <Modal open onClose={onClose} title={c ? `Cycle ${c.cycleNumber}` : 'Cycle'} wide>
      <AsyncContent loading={cycle.loading} error={cycle.error} onRetry={cycle.reload}>
        {c && (
          <div className="stack">
            <KeyValue
              items={[
                ['Status', <StatusBadge key="s" status={c.status} />],
                ['Due date', formatDate(c.dueDate)],
                ['Collected', `${naira(c.collectedAmount)} of ${naira(c.expectedAmount)}`],
                ['Paid / unpaid', `${c.paidCount} / ${c.unpaidCount}`],
                ['Recipient', c.recipient.name],
                c.payout && ['Payout', <StatusBadge key="p" status={c.payout.status} />],
                c.payout?.reference && ['Payout reference', <span key="r" className="mono">{c.payout.reference}</span>],
                c.payout?.failureReason && ['Failure reason', c.payout.failureReason],
              ]}
            />
            <ProgressBar value={c.collectedAmount} max={c.expectedAmount} />
            <DataTable
              rows={c.contributions}
              columns={[
                { key: 'name', label: 'Member', render: (x) => (x.isMine ? `${x.name} (you)` : x.name) },
                { key: 'amount', label: 'Amount', align: 'right', render: (x) => <span className="money">{naira(x.amount)}</span> },
                { key: 'status', label: 'Status', render: (x) => <span className="row-wrap"><StatusBadge status={x.status} />{x.isLate && <span className="chip">Late</span>}</span> },
                { key: 'paid', label: 'Paid at', render: (x) => formatDateTime(x.paidAt) },
                { key: 'act', label: '', render: (x) => (x.isMine && x.status !== 'paid' ? <Button size="sm" variant="gold" onClick={() => startCheckout(x.id, toast, setPaying)} loading={paying === x.id}>Pay</Button> : null) },
              ]}
            />
            {c.canApprovePayout && (
              <Button variant="success" onClick={approve} loading={pending}>
                Approve payout to {c.recipient.name}
              </Button>
            )}
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
}

function Cycles({ group, onChanged }) {
  const cycles = useAsync(() => api.get(`/osusu/groups/${group.id}/cycles`), [group.id]);
  const [openId, setOpenId] = useState(null);
  return (
    <Card title="Payout cycles" flush>
      <AsyncContent loading={cycles.loading} error={cycles.error} onRetry={cycles.reload} empty={!cycles.data?.length} emptyState={<EmptyState title="No cycles yet" message="Cycles are created when the organiser starts the group." />}>
        <div className="card-body">
          <div className="cycle-strip" aria-hidden>
            {cycles.data?.map((c) => (
              <span key={c.id} className={`cycle-dot ${c.status}`} title={`Cycle ${c.cycleNumber}: ${c.status}`}>
                {c.cycleNumber}
              </span>
            ))}
          </div>
        </div>
        <DataTable
          rows={cycles.data || []}
          onRowClick={(c) => setOpenId(c.id)}
          columns={[
            { key: 'n', label: 'Cycle', render: (c) => c.cycleNumber },
            { key: 'due', label: 'Due', render: (c) => formatDate(c.dueDate) },
            { key: 'rec', label: 'Recipient', render: (c) => c.recipient.name },
            { key: 'col', label: 'Collected', align: 'right', render: (c) => `${naira(c.collectedAmount)} / ${naira(c.expectedAmount)}` },
            { key: 'paid', label: 'Paid', render: (c) => `${c.paidCount}/${c.memberCount}` },
            { key: 'st', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
          ]}
        />
      </AsyncContent>
      {openId && <CycleModal cycleId={openId} onClose={() => setOpenId(null)} onChanged={() => { cycles.reload(); onChanged(); }} />}
    </Card>
  );
}

function Payouts({ group }) {
  const payouts = useAsync(() => api.get(`/osusu/groups/${group.id}/payouts`), [group.id]);
  return (
    <Card title="Payouts" flush>
      <AsyncContent loading={payouts.loading} error={payouts.error} onRetry={payouts.reload} empty={!payouts.data?.length} emptyState={<EmptyState title="No payouts scheduled" message="Payouts are scheduled when the group starts." />}>
        <DataTable
          rows={payouts.data || []}
          columns={[
            { key: 'c', label: 'Cycle', render: (p) => p.cycleNumber },
            { key: 'r', label: 'Recipient', render: (p) => (p.isMine ? `${p.recipientName} (you)` : p.recipientName) },
            { key: 'a', label: 'Amount', align: 'right', render: (p) => <span className="money">{naira(p.amount)}</span> },
            { key: 's', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
            { key: 'd', label: 'Paid on', render: (p) => formatDate(p.paidAt) },
          ]}
        />
      </AsyncContent>
    </Card>
  );
}

function Contributions({ group }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useAsync(() => api.get(`/osusu/groups/${group.id}/contributions`, { status, page, pageSize: 20 }), [group.id, status, page]);
  const isAdmin = group.permissions.isAdmin || group.permissions.isStaff;
  return (
    <Card title={isAdmin ? 'All contributions' : 'Your contribution history'} flush>
      <div className="filters">
        <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status filter">
          <option value="">All statuses</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>
      <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.data?.length} emptyState={<EmptyState title="No contributions" />}>
        <DataTable
          rows={list.data || []}
          columns={[
            { key: 'c', label: 'Cycle', render: (c) => c.cycleNumber },
            ...(isAdmin ? [{ key: 'm', label: 'Member', render: (c) => c.memberName }] : []),
            { key: 'a', label: 'Amount', align: 'right', render: (c) => <span className="money">{naira(c.amount)}</span> },
            { key: 'd', label: 'Due', render: (c) => formatDate(c.dueDate) },
            { key: 's', label: 'Status', render: (c) => <span className="row-wrap"><StatusBadge status={c.status} />{c.isLate && <span className="chip">Late</span>}</span> },
            { key: 'p', label: 'Paid at', render: (c) => formatDateTime(c.paidAt) },
          ]}
        />
        <Pagination meta={list.meta} onPage={setPage} />
      </AsyncContent>
    </Card>
  );
}

function GroupMeetings({ group }) {
  const meetings = useAsync(() => api.get('/meetings', { groupId: group.id, upcomingOnly: 'false' }), [group.id]);
  const [open, setOpen] = useState(false);
  return (
    <Card title="Meetings" actions={group.permissions.isAdmin && ['recruiting', 'active'].includes(group.status) && <Button size="sm" icon={CalendarPlus} onClick={() => setOpen(true)}>Schedule</Button>} flush>
      <AsyncContent loading={meetings.loading} error={meetings.error} onRetry={meetings.reload} empty={!meetings.data?.length} emptyState={<EmptyState title="No meetings scheduled" />}>
        <MeetingList meetings={meetings.data || []} onChange={meetings.reload} />
      </AsyncContent>
      {open && <ScheduleMeetingModal open onClose={() => setOpen(false)} groups={[group]} defaultGroupId={group.id} onCreated={meetings.reload} />}
    </Card>
  );
}

const REPORTS = [
  { value: 'contributions', label: 'Group contribution report' },
  { value: 'members', label: 'Member payment report' },
  { value: 'defaults', label: 'Default report' },
  { value: 'payouts', label: 'Payout report' },
  { value: 'cycles', label: 'Cycle report' },
];

function Insights({ group }) {
  const toast = useToast();
  const [type, setType] = useState('contributions');
  const [downloading, setDownloading] = useState(false);
  const activity = useAsync(() => api.get(`/osusu/groups/${group.id}/activity`), [group.id]);
  const risk = useAsync(() => api.get(`/osusu/groups/${group.id}/risk`), [group.id]);
  const download = async () => {
    setDownloading(true);
    try {
      await api.download(`/reports/osusu/${group.id}`, { type, format: 'csv' }, `${type}.csv`);
    } catch (err) {
      toast.error(err);
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className="stack-lg">
      <Card title="Reports">
        <div className="row-wrap">
          <Select className="grow" value={type} onChange={(e) => setType(e.target.value)} options={REPORTS} aria-label="Report type" />
          <Button icon={Download} onClick={download} loading={downloading} style={{ alignSelf: 'flex-end' }}>
            Export CSV
          </Button>
        </div>
      </Card>
      <Card title="Default and review" flush>
        <AsyncContent loading={risk.loading} error={risk.error} onRetry={risk.reload} empty={!risk.data?.members?.length} emptyState={<EmptyState icon={CheckCircle2} title="Every member is in good standing" />}>
          <DataTable
            rowKey="memberId"
            rows={risk.data?.members || []}
            columns={[
              { key: 'n', label: 'Member', render: (m) => m.name },
              { key: 's', label: 'Standing', render: (m) => <StatusBadge status={m.riskStatus} /> },
              { key: 'p', label: 'Received payout', render: (m) => (m.hasReceivedPayout ? `Yes (cycle ${m.payoutReceivedCycle})` : 'No') },
            ]}
          />
          <p className="xsmall muted" style={{ padding: '8px 20px' }}>
            Members who received a payout and then fall behind are placed under review for the platform team. Statuses are neutral and are not an accusation.
          </p>
        </AsyncContent>
      </Card>
      <Card title="Recent activity" flush>
        <AsyncContent loading={activity.loading} error={activity.error} onRetry={activity.reload} empty={!activity.data?.length} emptyState={<EmptyState title="No activity yet" />}>
          <DataTable
            rows={activity.data || []}
            columns={[
              { key: 'd', label: 'Date', render: (t) => formatDateTime(t.createdAt) },
              { key: 'm', label: 'Member', render: (t) => t.memberName },
              { key: 't', label: 'Type', render: (t) => TX_TYPE_LABEL[t.type] },
              { key: 'a', label: 'Amount', align: 'right', render: (t) => <span className="money">{naira(t.amount)}</span> },
              { key: 's', label: 'Status', render: (t) => <StatusBadge status={t.status} /> },
            ]}
          />
        </AsyncContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function GroupDetail() {
  const { groupId } = useParams();
  const { isStaff } = useAuth();
  const [tab, setTab] = useState('overview');
  const group = useAsync(() => api.get(`/osusu/groups/${groupId}`), [groupId]);
  const conversations = useAsync(() => api.get('/messages/conversations'), [groupId]);
  const conversationId = useMemo(() => conversations.data?.find((c) => c.groupId === groupId)?.id, [conversations.data, groupId]);

  if (group.loading && !group.data) return <SkeletonCards count={4} />;
  if (group.error) return <ErrorState error={group.error} onRetry={group.reload} />;
  const g = group.data;
  if (!g) return <Loader />;

  const pendingOnly = g.membership?.status === 'pending_approval' && !g.permissions.isAdmin && !isStaff;
  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'members', label: 'Members' },
    { value: 'cycles', label: 'Cycles' },
    { value: 'payouts', label: 'Payouts' },
    { value: 'contributions', label: 'Contributions' },
    { value: 'meetings', label: 'Meetings' },
    ...(g.permissions.isAdmin || isStaff ? [{ value: 'insights', label: 'Reports & risk' }] : []),
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        back={{ to: '/app/osusu', label: 'Groups' }}
        title={
          <span className="group-hero">
            <span className="gimg">{g.imageUrl ? <img src={g.imageUrl} alt="" /> : <UsersRound size={26} />}</span>
            <span>
              {g.name}
              <span className="row-wrap" style={{ marginTop: 4 }}>
                <StatusBadge status={g.status} />
                {g.permissions.isAdmin && <span className="chip">You organise this group</span>}
              </span>
            </span>
          </span>
        }
      />
      {pendingOnly ? (
        <Alert tone="info">Your request to join is awaiting the organiser&apos;s approval. You will be notified.</Alert>
      ) : (
        <>
          <Tabs tabs={tabs} value={tab} onChange={setTab} />
          {tab === 'overview' && <Overview group={g} onChanged={group.reload} conversationId={conversationId} />}
          {tab === 'members' && <Members group={g} />}
          {tab === 'cycles' && <Cycles group={g} onChanged={group.reload} />}
          {tab === 'payouts' && <Payouts group={g} />}
          {tab === 'contributions' && <Contributions group={g} />}
          {tab === 'meetings' && <GroupMeetings group={g} />}
          {tab === 'insights' && <Insights group={g} />}
        </>
      )}
    </div>
  );
}
