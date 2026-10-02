import { useMemo, useState } from 'react';
import { History, Plus, Trash2 } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, Checkbox, DataTable, Input, KeyValue, Modal, PageHeader, Select, StatCard, Tabs, Textarea } from '../components/ui/index.js';
import { useConfirm } from '../components/ui/ConfirmProvider.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api, newIdempotencyKey } from '../services/api.js';
import { formatDateTime, naira, parseNairaToKobo } from '../utils/format.js';
import { describeFee, exampleFee } from '../utils/fees.js';

const TYPE_LABEL = { FIXED: 'Fixed', PERCENTAGE: 'Percentage', FIXED_PLUS_PERCENTAGE: 'Fixed + percentage', TIERED: 'Tiered' };
const MODE_LABEL = { FEE_ADDED: 'Fee added', FEE_INCLUDED: 'Fee included' };
const STATUS_TONE = { APPROVED: 'success', PENDING_APPROVAL: 'warning', REJECTED: 'danger', CANCELLED: 'neutral' };
const k2n = (k) => (k == null ? '' : String(k / 100));

function ProposeFee({ row, onClose, onDone }) {
  const toast = useToast();
  const confirmAction = useConfirm();
  const c = row.current;
  const [f, setF] = useState({
    feeType: c?.feeType || 'FIXED', fixed: k2n(c?.fixedAmount ?? 0), percentage: String(c?.percentage ?? 0),
    minimumFee: k2n(c?.minimumFee), maximumFee: k2n(c?.maximumFee), minTx: k2n(c?.minimumTransactionAmount), maxTx: k2n(c?.maximumTransactionAmount),
    feeBearingMode: c?.feeBearingMode || 'FEE_ADDED', enabled: c?.enabled ?? true, effectiveFrom: '', reason: '',
    tiers: (c?.tiers?.length ? c.tiers : [{ min: 0, max: 1_000_000, fixed: 5_000 }]).map((t) => ({ min: k2n(t.min), max: k2n(t.max), fixed: k2n(t.fixed), percentage: String(t.percentage ?? 0) })),
  });
  const [sample, setSample] = useState('10000');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const kobo = (v) => (v === '' || v == null ? null : parseNairaToKobo(String(v)));
  const payload = useMemo(() => ({
    service: row.service, feeType: f.feeType, fixedAmount: kobo(f.fixed) ?? 0, percentage: Number(f.percentage || 0),
    tiers: f.feeType === 'TIERED' ? f.tiers.map((t) => ({ min: kobo(t.min) ?? 0, max: kobo(t.max), fixed: kobo(t.fixed) ?? 0, percentage: Number(t.percentage || 0) })) : undefined,
    minimumFee: kobo(f.minimumFee), maximumFee: kobo(f.maximumFee), minimumTransactionAmount: kobo(f.minTx), maximumTransactionAmount: kobo(f.maxTx),
    feeBearingMode: f.feeBearingMode, enabled: f.enabled, effectiveFrom: f.effectiveFrom ? new Date(f.effectiveFrom).toISOString() : null, reason: f.reason,
  }), [f]); // eslint-disable-line react-hooks/exhaustive-deps
  const ex = exampleFee({ ...payload, tiers: payload.tiers || [] }, parseNairaToKobo(sample));

  const submit = async () => {
    if (!(await confirmAction({ type: 'fee_propose' }))) return;
    setPending(true);
    setError(null);
    try {
      await api.post('/admin/fees', payload, { idempotencyKey: newIdempotencyKey() });
      toast.success('Fee change proposed. A second administrator must approve it.');
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const showFixed = ['FIXED', 'FIXED_PLUS_PERCENTAGE'].includes(f.feeType);
  const showPct = ['PERCENTAGE', 'FIXED_PLUS_PERCENTAGE'].includes(f.feeType);
  return (
    <Modal open onClose={onClose} title={`New fee version: ${row.label}`} wide>
      <div className="stack">
        {error && <Alert tone="danger">{error.message}</Alert>}
        <Alert tone="info">A change never edits the current fee: it creates version {((c?.version) || 0) + 1}, which applies only after a different administrator approves it. Past transactions keep the fee they were charged.</Alert>
        <div className="form-grid">
          <Select label="Fee type" value={f.feeType} onChange={set('feeType')} options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
          <Select label="Who bears the fee" value={f.feeBearingMode} onChange={set('feeBearingMode')}
            options={row.allowedModes.map((m) => ({ value: m, label: m === 'FEE_ADDED' ? 'Fee added (member pays amount + fee)' : 'Fee included (recipient gets amount − fee)' }))} />
          {showFixed && <Input label="Fixed fee (₦)" inputMode="decimal" value={f.fixed} onChange={set('fixed')} />}
          {showPct && <Input label="Percentage (%)" inputMode="decimal" value={f.percentage} onChange={set('percentage')} />}
          <Input label="Minimum fee (₦, optional)" inputMode="decimal" value={f.minimumFee} onChange={set('minimumFee')} />
          <Input label="Maximum fee / cap (₦, optional)" inputMode="decimal" value={f.maximumFee} onChange={set('maximumFee')} />
          <Input label="Minimum transaction (₦, optional)" inputMode="decimal" value={f.minTx} onChange={set('minTx')} />
          <Input label="Maximum transaction (₦, optional)" inputMode="decimal" value={f.maxTx} onChange={set('maxTx')} />
          <Input label="Effective from (optional, schedules it)" type="datetime-local" value={f.effectiveFrom} onChange={set('effectiveFrom')} />
        </div>
        {f.feeType === 'TIERED' && (
          <Card title="Tiers">
            <div className="stack">
              {f.tiers.map((t, i) => (
                <div key={i} className="form-grid">
                  {['min', 'max', 'fixed', 'percentage'].map((k) => (
                    <Input key={k} label={{ min: 'From (₦)', max: 'To (₦, empty = no limit)', fixed: 'Fee (₦)', percentage: 'Plus %' }[k]} inputMode="decimal" value={t[k]}
                      onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
                  ))}
                  <Button variant="ghost" icon={Trash2} onClick={() => setF({ ...f, tiers: f.tiers.filter((_, j) => j !== i) })} disabled={f.tiers.length === 1}>Remove</Button>
                </div>
              ))}
              <div><Button variant="secondary" icon={Plus} onClick={() => setF({ ...f, tiers: [...f.tiers, { min: '', max: '', fixed: '', percentage: '0' }] })}>Add tier</Button></div>
            </div>
          </Card>
        )}
        <Checkbox label="Charge this fee (untick to make the service free)" checked={f.enabled} onChange={set('enabled')} />
        <div className="form-grid">
          <Input label="Example amount (₦)" inputMode="decimal" value={sample} onChange={(e) => setSample(e.target.value)} />
          <div className="fee-example small">
            {ex?.error ? <span className="text-red">{ex.error}</span> : ex && (
              <span>Fee <strong>{naira(ex.fee)}</strong> · member pays <strong>{naira(ex.total)}</strong> · recipient gets <strong>{naira(ex.receives)}</strong><br />
                <span className="xsmall muted">Example only — members are always charged by the server.</span></span>
            )}
          </div>
        </div>
        <Textarea label="Reason (recorded in the audit log)" value={f.reason} onChange={set('reason')} rows={2} />
        <div className="row-wrap">
          <Button onClick={submit} loading={pending} disabled={f.reason.trim().length < 5}>Propose change</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

function FeeHistory({ row, onClose }) {
  const h = useAsync(() => api.get(`/admin/fees/services/${row.service}/history`), [row.service]);
  return (
    <Modal open onClose={onClose} title={`Fee history: ${row.label}`} wide>
      <AsyncContent loading={h.loading} error={h.error} onRetry={h.reload} empty={!h.data?.length}>
        <DataTable rows={h.data || []} columns={[
          { key: 'v', label: 'Version', render: (c) => `v${c.version} · ${c.code}` },
          { key: 'f', label: 'Fee', render: (c) => `${describeFee(c)} · ${MODE_LABEL[c.feeBearingMode]}` },
          { key: 'l', label: 'Min / max fee', render: (c) => `${c.minimumFee != null ? naira(c.minimumFee) : '—'} / ${c.maximumFee != null ? naira(c.maximumFee) : '—'}` },
          { key: 's', label: 'Status', render: (c) => <span className={`badge badge-${STATUS_TONE[c.status] || 'neutral'}`}>{c.status.replace('_', ' ')}</span> },
          { key: 'e', label: 'Effective', render: (c) => formatDateTime(c.effectiveFrom) },
          { key: 'b', label: 'Changed by / approved by', render: (c) => `${c.createdBy || 'System'} / ${c.approvedBy || '—'}` },
          { key: 'r', label: 'Reason', render: (c) => <span className="xsmall">{c.reason}{c.decisionReason ? ` — ${c.decisionReason}` : ''}</span> },
        ]} />
      </AsyncContent>
    </Modal>
  );
}

function Decide({ c, label, onClose, onDone }) {
  const toast = useToast();
  const confirmAction = useConfirm();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const decide = async (approve) => {
    if (!(await confirmAction({ type: approve ? 'fee_approve' : 'fee_reject' }))) return;
    setPending(true);
    try {
      await api.post(`/admin/fees/${c.id}/decide`, { approve, reason }, { idempotencyKey: newIdempotencyKey() });
      toast.success(approve ? 'Fee change approved' : 'Fee change rejected');
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Approve fee change: ${label}`}>
      <div className="stack">
        <KeyValue items={[
          ['New fee', `${describeFee(c)} · ${MODE_LABEL[c.feeBearingMode]}`],
          ['Min / max fee', `${c.minimumFee != null ? naira(c.minimumFee) : '—'} / ${c.maximumFee != null ? naira(c.maximumFee) : '—'}`],
          ['Transaction limits', `${c.minimumTransactionAmount != null ? naira(c.minimumTransactionAmount) : '—'} – ${c.maximumTransactionAmount != null ? naira(c.maximumTransactionAmount) : '—'}`],
          ['Effective', formatDateTime(c.effectiveFrom)],
          ['Proposed by', c.createdBy],
          ['Reason', c.reason],
        ]} />
        <Textarea label="Your reason (recorded)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        <div className="row-wrap">
          <Button onClick={() => decide(true)} loading={pending} disabled={reason.trim().length < 5}>Approve</Button>
          <Button variant="danger" onClick={() => decide(false)} loading={pending} disabled={reason.trim().length < 5}>Reject</Button>
        </div>
        <p className="xsmall muted">You cannot approve a change you proposed.</p>
      </div>
    </Modal>
  );
}

function Services() {
  const { can } = useAuth();
  const toast = useToast();
  const list = useAsync(() => api.get('/admin/fees'), []);
  const [edit, setEdit] = useState(null);
  const [history, setHistory] = useState(null);
  const [decide, setDecide] = useState(null);
  const cancel = async (c) => {
    try {
      await api.post(`/admin/fees/${c.id}/cancel`, {});
      toast.success('Proposal withdrawn');
      list.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Card flush>
      <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload}>
        <DataTable rows={list.data || []} rowKey="service" columns={[
          { key: 's', label: 'Service', render: (r) => <span><strong>{r.label}</strong><br /><span className="xsmall muted">{r.group}{r.live ? '' : ' · applied when this service launches'}</span></span> },
          { key: 't', label: 'Fee type', render: (r) => (r.current ? TYPE_LABEL[r.current.feeType] : '—') },
          { key: 'f', label: 'Current fee', render: (r) => describeFee(r.current) },
          { key: 'mn', label: 'Min', render: (r) => (r.current?.minimumFee != null ? naira(r.current.minimumFee) : '—') },
          { key: 'mx', label: 'Max', render: (r) => (r.current?.maximumFee != null ? naira(r.current.maximumFee) : '—') },
          { key: 'm', label: 'Fee mode', render: (r) => (r.current ? MODE_LABEL[r.current.feeBearingMode] : '—') },
          { key: 'st', label: 'Status', render: (r) => (
            <span className="stack-sm">
              <span className={`badge badge-${r.current?.enabled ? 'success' : 'neutral'}`}>{r.current?.enabled ? 'Active' : 'No fee'}</span>
              {r.scheduled && <span className="badge badge-info">Scheduled {formatDateTime(r.scheduled.effectiveFrom)}</span>}
              {r.pending && <span className="badge badge-warning">Change awaiting approval</span>}
            </span>
          ) },
          { key: 'e', label: 'Effective', render: (r) => (r.current ? `v${r.current.version} · ${formatDateTime(r.current.effectiveFrom)}` : '—') },
          { key: 'a', label: '', render: (r) => (
            <span className="row-wrap">
              {can('fees.manage') && !r.pending && <Button size="sm" onClick={() => setEdit(r)}>Edit / schedule</Button>}
              {can('fees.approve') && r.pending && <Button size="sm" onClick={() => setDecide(r)}>Review change</Button>}
              {can('fees.manage') && r.pending && <Button size="sm" variant="ghost" onClick={() => cancel(r.pending)}>Withdraw</Button>}
              <Button size="sm" variant="ghost" icon={History} onClick={() => setHistory(r)}>History</Button>
            </span>
          ) },
        ]} />
      </AsyncContent>
      {edit && <ProposeFee row={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); list.reload(); }} />}
      {history && <FeeHistory row={history} onClose={() => setHistory(null)} />}
      {decide && <Decide c={decide.pending} label={decide.label} onClose={() => setDecide(null)} onDone={() => { setDecide(null); list.reload(); }} />}
    </Card>
  );
}

const RANGES = [
  { value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: 'custom', label: 'Custom range' },
];
const CATEGORY_LABEL = { bank_transfer: 'Bank transfer fees', bills: 'Bill fees', wallet_transfer: 'Wallet transfer fees', wallet_topup: 'Wallet top-up fees', osusu: 'OSUSU & savings fees', other: 'Other fees' };

function Revenue() {
  const [range, setRange] = useState('30d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = useMemo(() => {
    const now = new Date();
    if (range === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return { from: d.toISOString() }; }
    if (range === '7d') return { from: new Date(now - 7 * 864e5).toISOString() };
    if (range === '30d') return { from: new Date(now - 30 * 864e5).toISOString() };
    return { ...(from ? { from: new Date(from).toISOString() } : {}), ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}) };
  }, [range, from, to]);
  const r = useAsync(() => api.get('/admin/fees/revenue', params), [JSON.stringify(params)]);
  const d = r.data;
  return (
    <div className="stack-lg">
      <div className="row-wrap">
        <Select aria-label="Period" value={range} onChange={(e) => setRange(e.target.value)} options={RANGES} />
        {range === 'custom' && <><Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} /></>}
      </div>
      <AsyncContent loading={r.loading} error={r.error} onRetry={r.reload}>
        {d && (
          <>
            <div className="stat-grid">
              <StatCard label="Gross transaction volume" value={naira(d.grossVolume)} />
              <StatCard label="Fees collected" value={naira(d.feesCollected)} />
              <StatCard label="Refunded / reversed fees" value={naira(d.feesRefunded)} />
              <StatCard label="Net fees" value={naira(d.netFees)} sub={`${naira(d.netAfterProviderCost)} after ${naira(d.bankProviderCost)} bank transfer cost`} />
            </div>
            <Card title="By service" flush>
              <DataTable rows={Object.entries(d.byCategory).map(([k, v]) => ({ k, ...v }))} rowKey="k" columns={[
                { key: 'c', label: 'Service', render: (x) => CATEGORY_LABEL[x.k] || x.k },
                { key: 'v', label: 'Volume', align: 'right', render: (x) => `${naira(x.volume)} (${x.count})` },
                { key: 'f', label: 'Collected', align: 'right', render: (x) => naira(x.collected) },
                { key: 'r', label: 'Refunded', align: 'right', render: (x) => naira(x.refunded) },
                { key: 'n', label: 'Net', align: 'right', render: (x) => <strong>{naira(x.net)}</strong> },
              ]} />
            </Card>
            <p className="xsmall muted">Fees refunded with a failed or reversed transaction are not revenue. VTpass commissions are on the Bills & Services revenue page; provider costs are shown separately from ACHIEVER fees.</p>
          </>
        )}
      </AsyncContent>
    </div>
  );
}

export default function AdminFees() {
  const [tab, setTab] = useState('services');
  return (
    <div className="stack-lg">
      <PageHeader title="Fees & Charges" subtitle="One fee engine for every ACHIEVER service. Changes are versioned and need a second administrator." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'services', label: 'Services' }, { value: 'revenue', label: 'Fee revenue' }]} />
      {tab === 'services' ? <Services /> : <Revenue />}
    </div>
  );
}
