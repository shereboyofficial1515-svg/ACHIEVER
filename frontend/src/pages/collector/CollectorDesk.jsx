import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, CalendarClock, Download, HandCoins, TrendingUp, UserPlus, Users } from 'lucide-react';
import {
  Alert, AsyncContent, Button, Card, DataTable, EmptyState, Input, Modal, MoneyInput, PageHeader, Pagination, Select, SkeletonCards,
  StatCard, StatusBadge, Tabs, Textarea, fieldErrors,
} from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { api } from '../../services/api.js';
import { commissionLabel, FREQUENCY_LABEL, formatDate, koboToNairaInput, naira, parseNairaToKobo, todayLagos } from '../../utils/format.js';

function commissionToApi(type, input) {
  if (type === 'percentage') {
    const pct = Number(input);
    return Number.isFinite(pct) ? Math.round(pct * 100) : null; // basis points
  }
  return parseNairaToKobo(input);
}

function AccountForm({ account, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    businessName: account?.businessName || '',
    description: account?.description || '',
    operatingArea: account?.operatingArea || '',
    type: account?.defaultCommissionType || 'percentage',
    value: account ? (account.defaultCommissionType === 'percentage' ? String(account.defaultCommissionValue / 100) : koboToNairaInput(account.defaultCommissionValue)) : '3.33',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    const value = commissionToApi(form.type, form.value);
    if (value === null) {
      setError({ fields: { defaultCommissionValue: 'Enter a valid commission' } });
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body = { businessName: form.businessName, description: form.description || null, operatingArea: form.operatingArea || null, defaultCommissionType: form.type, defaultCommissionValue: value };
      if (account) await api.patch('/collector/account', body);
      else await api.post('/collector/account', body);
      toast.success(account ? 'Account updated' : 'Collector account created');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const fe = fieldErrors(error);
  return (
    <form className="stack" onSubmit={submit}>
      {error?.message && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
      <Input label="Business name" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} error={fe.businessName} />
      <Input label="Operating area" placeholder="e.g. Oshodi, Lagos" value={form.operatingArea} onChange={(e) => setForm({ ...form, operatingArea: e.target.value })} error={fe.operatingArea} />
      <Textarea label="Description (optional)" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <div className="grid-2">
        <Select label="Default commission" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={[{ value: 'percentage', label: 'Percentage of savings' }, { value: 'fixed', label: 'Fixed amount' }]} />
        {form.type === 'percentage' ? (
          <Input label="Percentage (max 20%)" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} error={fe.defaultCommissionValue} hint="3.33% is roughly one day's savings a month" />
        ) : (
          <MoneyInput label="Fixed amount" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} error={fe.defaultCommissionValue} />
        )}
      </div>
      <p className="xsmall muted">Defaults apply to new plans only. Existing savers keep the terms they agreed to.</p>
      <div>
        <Button type="submit" loading={pending}>
          {account ? 'Save changes' : 'Create collector account'}
        </Button>
      </div>
    </form>
  );
}

function InviteSaverModal({ account, open, onClose, onSent }) {
  const toast = useToast();
  const [form, setForm] = useState({
    email: '', phone: '', planName: 'Savings plan', frequency: 'daily', expected: '', startDate: todayLagos(), endDate: '',
    type: account.defaultCommissionType,
    value: account.defaultCommissionType === 'percentage' ? String(account.defaultCommissionValue / 100) : koboToNairaInput(account.defaultCommissionValue),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [link, setLink] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post('/collector/savers/invite', {
        email: form.email || undefined,
        phone: form.phone || undefined,
        planName: form.planName,
        frequency: form.frequency,
        expectedAmount: form.expected ? parseNairaToKobo(form.expected) : null,
        startDate: form.startDate,
        endDate: form.endDate,
        commissionType: form.type,
        commissionValue: commissionToApi(form.type, form.value),
      });
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
    <Modal open={open} onClose={onClose} title="Invite a saver" wide>
      {link ? (
        <div className="stack">
          <Alert tone="success">Invitation sent. The saver reviews the term and commission before accepting.</Alert>
          <Input label="Personal invitation link" readOnly value={link} onFocus={(e) => e.target.select()} />
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          {error?.message && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
          <div className="grid-2">
            <Input label="Saver's email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={fe.email} />
            <Input label="or phone number" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={fe.phone} />
            <Input label="Plan name" value={form.planName} onChange={(e) => setForm({ ...form, planName: e.target.value })} error={fe.planName} />
            <Select label="Saving frequency" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} options={['daily', 'weekly', 'monthly', 'flexible'].map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))} />
            <MoneyInput label="Suggested amount (optional)" value={form.expected} onChange={(e) => setForm({ ...form, expected: e.target.value })} hint="Savers can always pay what they can afford" />
            <div />
            <Input label="Start date" type="date" min={todayLagos()} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} error={fe.startDate} />
            <Input label="End date (maturity)" type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} error={fe.endDate} />
            <Select label="Commission" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={[{ value: 'percentage', label: 'Percentage of savings' }, { value: 'fixed', label: 'Fixed amount' }]} />
            {form.type === 'percentage' ? (
              <Input label="Percentage" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} error={fe.commissionValue} />
            ) : (
              <MoneyInput label="Fixed amount" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} error={fe.commissionValue} />
            )}
          </div>
          <Button type="submit" loading={pending} disabled={(!form.email && !form.phone) || !form.endDate}>
            Send invitation
          </Button>
        </form>
      )}
    </Modal>
  );
}

function Savers() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounce(search);
  const list = useAsync(() => api.get('/collector/savers', { status, search: q, page, pageSize: 20 }), [status, q, page]);
  return (
    <Card flush>
      <div className="filters">
        <input className="input" type="search" placeholder="Search savers" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search savers" />
        <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All statuses</option>
          {['active', 'matured', 'return_requested', 'return_processing', 'returned'].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>
      <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.data?.length} emptyState={<EmptyState icon={Users} title="No savers yet" message="Invite savers to start collecting." />}>
        <DataTable
          rows={list.data || []}
          onRowClick={(p) => navigate(`/app/collector/plans/${p.id}`)}
          columns={[
            { key: 's', label: 'Saver', render: (p) => p.saver.name },
            { key: 'p', label: 'Plan', render: (p) => p.planName },
            { key: 'b', label: 'Balance', align: 'right', render: (p) => <span className="money">{naira(p.balance)}</span> },
            { key: 'e', label: 'Matures', render: (p) => formatDate(p.endDate) },
            { key: 'c', label: 'Commission', render: (p) => naira(p.estimatedCommission) },
            { key: 'st', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
          ]}
        />
        <Pagination meta={list.meta} onPage={setPage} />
      </AsyncContent>
    </Card>
  );
}

function Returns({ onChanged }) {
  const toast = useToast();
  const [status, setStatus] = useState('requested');
  const list = useAsync(() => api.get('/collector/returns', { status, as: 'collector', pageSize: 50 }), [status]);
  const [pending, setPending] = useState(null);
  const act = async (r, action) => {
    setPending(r.id + action);
    try {
      await api.post(`/collector/returns/${r.id}/${action}`, action === 'reject' ? { reason: 'Declined by collector' } : undefined);
      toast.success(action === 'approve' ? 'Return approved' : 'Request declined');
      list.reload();
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(null);
    }
  };
  return (
    <Card flush>
      <div className="filters">
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Return status">
          {['requested', 'approved', 'processing', 'paid', 'rejected', 'failed'].map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.data?.length} emptyState={<EmptyState title="No return requests" />}>
        <DataTable
          rows={list.data || []}
          columns={[
            { key: 's', label: 'Saver', render: (r) => r.saverName },
            { key: 'p', label: 'Plan', render: (r) => r.planName },
            { key: 'g', label: 'Balance', align: 'right', render: (r) => naira(r.grossAmount) },
            { key: 'c', label: 'Commission', align: 'right', render: (r) => naira(r.commissionAmount) },
            { key: 'n', label: 'To saver', align: 'right', render: (r) => <span className="money">{naira(r.netAmount)}</span> },
            { key: 'e', label: 'Type', render: (r) => (r.isEarly ? <span className="chip">Early</span> : 'At maturity') },
            {
              key: 'a',
              label: '',
              render: (r) =>
                r.status === 'requested' ? (
                  <span className="row-wrap">
                    <Button size="sm" variant="success" onClick={() => act(r, 'approve')} loading={pending === `${r.id}approve`}>
                      Approve
                    </Button>
                    {r.isEarly && (
                      <Button size="sm" variant="ghost" onClick={() => act(r, 'reject')} loading={pending === `${r.id}reject`}>
                        Decline
                      </Button>
                    )}
                  </span>
                ) : (
                  <StatusBadge status={r.status} />
                ),
            },
          ]}
        />
      </AsyncContent>
    </Card>
  );
}

const COLLECTOR_REPORTS = [
  { value: 'contributions', label: 'Saver contribution report' },
  { value: 'balances', label: 'Collector balance report' },
  { value: 'commissions', label: 'Commission report' },
  { value: 'maturity', label: 'Maturity report' },
];

function Reports() {
  const toast = useToast();
  const [type, setType] = useState('balances');
  const [pending, setPending] = useState(false);
  const commissions = useAsync(() => api.get('/collector/commissions'), []);
  const download = async () => {
    setPending(true);
    try {
      await api.download('/reports/collector', { type, format: 'csv' }, `${type}.csv`);
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="stack-lg">
      <Card title="Export">
        <div className="row-wrap">
          <Select className="grow" value={type} onChange={(e) => setType(e.target.value)} options={COLLECTOR_REPORTS} aria-label="Report type" />
          <Button icon={Download} onClick={download} loading={pending} style={{ alignSelf: 'flex-end' }}>
            Export CSV
          </Button>
        </div>
      </Card>
      <Card title="Commissions" flush>
        <AsyncContent loading={commissions.loading} error={commissions.error} onRetry={commissions.reload} empty={!commissions.data?.length} emptyState={<EmptyState title="No commissions yet" message="Commission is earned when a saver's return is paid." />}>
          <DataTable
            rows={commissions.data || []}
            columns={[
              { key: 'p', label: 'Plan', render: (c) => c.planName },
              { key: 'a', label: 'Amount', align: 'right', render: (c) => <span className="money">{naira(c.amount)}</span> },
              { key: 's', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
              { key: 'd', label: 'Settled', render: (c) => formatDate(c.settledAt) },
            ]}
          />
        </AsyncContent>
      </Card>
    </div>
  );
}

export default function CollectorDesk() {
  const [tab, setTab] = useState('savers');
  const [inviteOpen, setInviteOpen] = useState(false);
  const dash = useAsync(() => api.get('/collector/dashboard'), []);
  const onboarding = useAsync(() => api.get('/verification/status'), []);
  const invites = useAsync(() => api.get('/collector/invites').catch(() => ({ data: [] })), []);
  const operator = onboarding.data?.operators?.find((o) => o.role === 'COLLECTOR');

  if (dash.loading || onboarding.loading) return <SkeletonCards count={4} />;
  const d = dash.data;

  if (!d?.account) {
    return (
      <div className="stack-lg" style={{ maxWidth: 720 }}>
        <PageHeader title="Collector desk" subtitle="Hold savings for savers and earn an agreed commission." />
        {operator && !operator.active ? (
          <Alert tone="warning" icon={BadgeCheck}>
            Complete collector verification (phone, identity and undertaking) before opening your collector account.{' '}
            <Link to="/app/onboarding">Continue verification</Link>
          </Alert>
        ) : (
          <Card title="Set up your collector account">
            <AccountForm onSaved={dash.reload} />
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title={d.account.businessName}
        subtitle={`Collector desk · default commission ${commissionLabel(d.account.defaultCommissionType, d.account.defaultCommissionValue)}`}
        actions={<Button icon={UserPlus} onClick={() => setInviteOpen(true)} disabled={d.account.status !== 'active'}>Invite saver</Button>}
      />
      {d.account.status !== 'active' && <Alert tone="danger">Your collector account is suspended. Contact support.</Alert>}
      <div className="grid-4">
        <StatCard accent icon={HandCoins} label="Total held" value={naira(d.totalHeld)} sub="Across all active plans" />
        <StatCard icon={Users} label="Savers" value={d.totalSavers} />
        <StatCard icon={CalendarClock} label="Maturing in 14 days" value={d.maturingSoon} sub={`${d.matured} matured · ${d.pendingReturns} pending return(s)`} />
        <StatCard icon={TrendingUp} label="Commission earned" value={naira(d.commissionEarned)} sub={`${naira(d.commissionPending)} pending`} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'savers', label: 'Savers' },
          { value: 'returns', label: `Returns${d.pendingReturns ? ` (${d.pendingReturns})` : ''}` },
          { value: 'invites', label: 'Invitations' },
          { value: 'reports', label: 'Reports' },
          { value: 'account', label: 'Account' },
        ]}
      />
      {tab === 'savers' && <Savers />}
      {tab === 'returns' && <Returns onChanged={dash.reload} />}
      {tab === 'invites' && (
        <Card flush>
          <AsyncContent loading={invites.loading} error={invites.error} empty={!invites.data?.length} emptyState={<EmptyState title="No invitations sent" />}>
            <DataTable
              rows={invites.data || []}
              columns={[
                { key: 't', label: 'Sent to', render: (i) => i.email || i.phone },
                { key: 'p', label: 'Plan', render: (i) => i.terms?.plan_name },
                { key: 'e', label: 'Ends', render: (i) => formatDate(i.terms?.end_date) },
                { key: 's', label: 'Status', render: (i) => <StatusBadge status={i.status} /> },
              ]}
            />
          </AsyncContent>
        </Card>
      )}
      {tab === 'reports' && <Reports />}
      {tab === 'account' && (
        <Card title="Collector account">
          <AccountForm account={d.account} onSaved={dash.reload} />
        </Card>
      )}
      {inviteOpen && <InviteSaverModal account={d.account} open onClose={() => setInviteOpen(false)} onSent={invites.reload} />}
    </div>
  );
}
