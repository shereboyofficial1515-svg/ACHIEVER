import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, Banknote, Building2, Landmark, Lock, RefreshCw, ShieldCheck, Users, Wallet } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, DataTable, Input, KeyValue, Modal, MoneyInput, PageHeader, Select, Textarea } from '../components/ui/index.js';
import { useConfirm } from '../components/ui/ConfirmProvider.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api, newIdempotencyKey } from '../services/api.js';
import { formatDateTime, naira, parseNairaToKobo } from '../utils/format.js';

const W_TONE = { PENDING_APPROVAL: 'warning', PENDING: 'info', PROCESSING: 'info', SUCCESS: 'success', FAILED: 'danger', REVERSED: 'warning', REJECTED: 'neutral', CANCELLED: 'neutral' };
const W_LABEL = { PENDING_APPROVAL: 'Awaiting 2nd approval', PENDING: 'Booked · sending', PROCESSING: 'Processing', SUCCESS: 'Successful', FAILED: 'Failed · returned', REVERSED: 'Reversed · returned', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

/** One money bucket. `kind` colours the card so customer money never looks like revenue. */
function Bucket({ kind, title, amount, note, icon: Icon }) {
  return (
    <div className={`card finance-bucket is-${kind}`}>
      <span className="finance-bucket-title">{Icon && <Icon size={15} aria-hidden />} {title}</span>
      <strong className="finance-bucket-amount">{amount == null ? '—' : naira(amount)}</strong>
      {note && <span className="xsmall muted">{note}</span>}
    </div>
  );
}

function VtpassReport({ report }) {
  if (!report) return null;
  return (
    <div className="stack-sm">
      <KeyValue items={[
        ['Environment', report.environment === 'production' ? 'LIVE' : 'SANDBOX'],
        ['API host', report.baseUrlHost],
        ['Keys', Object.entries(report.credentials).map(([k, v]) => `${k.replace('VTPASS_', '')}: ${v}`).join(' · ')],
        ['Status', report.status.toUpperCase()],
        report.balance != null && ['Wallet balance', naira(report.balance)],
      ].filter(Boolean)} />
      <ul className="check-list">
        {report.checks.map((c) => (
          <li key={c.name} className={c.ok ? 'ok' : 'bad'}>
            <strong>{c.ok ? '✓' : '✗'} {c.name.replace(/_/g, ' ')}</strong>{c.latencyMs != null ? ` (${c.latencyMs} ms)` : ''} — {c.detail}
          </li>
        ))}
      </ul>
      {report.recentPurchaseCodes?.length > 0 && (
        <p className="xsmall muted">Recent purchase responses: {report.recentPurchaseCodes.map((r) => `${r.code} × ${r.count} (${r.meaning})`).join('; ')}</p>
      )}
      <p className="xsmall muted">This check only reads from VTpass. It never buys airtime, data or anything else.</p>
    </div>
  );
}

function WithdrawModal({ o, onClose, onDone }) {
  const toast = useToast();
  const confirmAction = useConfirm();
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [key] = useState(() => newIdempotencyKey());
  const kobo = parseNairaToKobo(value || '0');
  const account = o.account;
  const submit = async () => {
    setError(null);
    const big = kobo >= o.limits.dualApprovalFrom;
    if (!(await confirmAction({
      severity: 'warning', title: `Withdraw ${naira(kobo)} of platform revenue?`,
      message: `${naira(kobo)} goes to ${account.accountName} (${account.bankName} ${account.accountNumber}).${big ? ' A second administrator must approve it first.' : ''}`,
      details: [['From', 'ACHIEVER fee revenue (not customer money)'], ['Reason', reason]],
      confirmLabel: 'Withdraw',
    }))) return;
    setPending(true);
    try {
      await api.post('/admin/finance/withdrawals', { amount: kobo, reason }, { idempotencyKey: key });
      toast.success(big ? 'Sent to a second administrator for approval' : 'Withdrawal submitted');
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Withdraw platform revenue to the company account" footer={(
      <div className="row-wrap"><Button onClick={submit} loading={pending} disabled={!kobo || reason.trim().length < 10}>Review and withdraw</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div>
    )}>
      <div className="stack">
        <Alert tone="info">Only ACHIEVER fee revenue can be withdrawn here. Customer wallets, OSUSU and collector money are never included.</Alert>
        <KeyValue items={[
          ['Withdrawable now', naira(o.business.withdrawable)],
          ['To', `${account.accountName} · ${account.bankName} ${account.accountNumber}`],
          ['Limits', `${naira(o.limits.min)} – ${naira(o.limits.max)} each · ${naira(o.limits.daily)}/day · ${naira(o.limits.monthly)}/month`],
          ['Second approval', `from ${naira(o.limits.dualApprovalFrom)}`],
        ]} />
        <MoneyInput label="Amount (₦)" value={value} onChange={(e) => setValue(e.target.value)} />
        <Textarea label="Reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} hint="Recorded in the audit log" />
        {error && <Alert tone="danger">{error.message}</Alert>}
      </div>
    </Modal>
  );
}

function ProposeAccount({ onClose, onDone }) {
  const toast = useToast();
  const banks = useAsync(() => api.get('/admin/finance/banks'), []);
  const [f, setF] = useState({ bankCode: '', accountNumber: '', reason: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await api.post('/admin/finance/accounts', f);
      toast.success('Verified with the bank and sent to a second administrator');
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Propose the company payout account" footer={(
      <div className="row-wrap"><Button onClick={submit} loading={pending} disabled={!f.bankCode || f.accountNumber.length !== 10 || f.reason.trim().length < 10}>Verify and propose</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div>
    )}>
      <div className="stack">
        <Alert tone="info">The account name comes from the bank. A different administrator must approve it, and it can be used only after the cooling-off period.</Alert>
        <Select label="Bank" placeholder={banks.loading ? 'Loading banks…' : 'Choose bank'} value={f.bankCode} onChange={(e) => setF({ ...f, bankCode: e.target.value })} options={(banks.data || []).map((b) => ({ value: b.code, label: b.name }))} />
        <Input label="Account number" inputMode="numeric" maxLength={10} value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
        <Textarea label="Reason" rows={2} maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        {error && <Alert tone="danger">{error.message}</Alert>}
      </div>
    </Modal>
  );
}

/**
 * Finance: ACHIEVER's money picture with strict separation —
 * customer funds (owed to members) · money in transit · platform revenue (business wallet) · provider float.
 */
export default function AdminFinance() {
  const { user, can } = useAuth();
  const toast = useToast();
  const confirmAction = useConfirm();
  const o = useAsync(() => api.get('/admin/finance/overview'), []);
  const accounts = useAsync(() => api.get('/admin/finance/accounts'), []);
  const withdrawals = useAsync(() => api.get('/admin/finance/withdrawals'), []);
  const [report, setReport] = useState(null);
  const [checking, setChecking] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [proposing, setProposing] = useState(false);

  const reloadAll = () => { o.reload(); accounts.reload(); withdrawals.reload(); };
  const runCheck = async () => {
    setChecking(true);
    try {
      const { data } = await api.post('/admin/finance/vtpass-check');
      setReport(data);
      o.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setChecking(false);
    }
  };
  const decide = async (kind, id, approve) => {
    if (!(await confirmAction({ severity: approve ? 'warning' : 'danger', title: approve ? 'Approve?' : 'Reject?', message: 'Your decision is recorded in the audit log.', confirmLabel: approve ? 'Approve' : 'Reject' }))) return;
    try {
      await api.post(`/admin/finance/${kind}/${id}/decision`, { approve });
      toast.success('Decision recorded');
      reloadAll();
    } catch (err) {
      toast.error(err);
    }
  };

  const data = o.data;
  const active = (accounts.data || []).find((a) => a.status === 'active');
  const pendingAccount = (accounts.data || []).find((a) => a.status === 'pending_approval');
  const obligations = data ? data.customerFunds.total + data.customerFunds.osusuPool + data.customerFunds.collectorPool + data.pending.payoutClearing + data.pending.billSettlement : 0;
  const liquidity = data ? Math.max(0, data.paystackBooks) + (data.vtpass.balance || 0) : 0;

  return (
    <div className="stack-lg">
      <PageHeader title="Finance" subtitle="Business wallet, customer funds, provider float and liquidity. Customer money is shown separately and can never be withdrawn as revenue." />
      <AsyncContent loading={o.loading && !data} error={o.error} onRetry={o.reload}>
        {data && (
          <>
            <div className="finance-grid">
              <Bucket kind="customer" icon={Users} title="Customer funds (owed to members)" amount={data.customerFunds.total} note={`${data.customerFunds.fundedWallets} funded wallets · not company money`} />
              <Bucket kind="customer" icon={Users} title="OSUSU + collector money" amount={data.customerFunds.osusuPool + data.customerFunds.collectorPool} note="Held for members" />
              <Bucket kind="pending" icon={Activity} title="Pending / in transit" amount={data.pending.payoutClearing + data.pending.billSettlement} note={`${data.pending.bankTransfersOpenCount} bank transfer(s) open · bill settlement`} />
              <Bucket kind="revenue" icon={Building2} title="Platform revenue (business wallet)" amount={data.business.revenueBalance} note="ACHIEVER fees earned (net of refunds)" />
              <Bucket kind="revenue" icon={Banknote} title="Withdrawable business funds" amount={data.business.withdrawable} note={data.business.awaitingApproval ? `${naira(data.business.awaitingApproval)} reserved for approval` : 'Revenue minus reserved'} />
              <Bucket kind="provider" icon={Wallet} title="VTpass float" amount={data.vtpass.balance} note={data.vtpass.checkedAt ? `Checked ${formatDateTime(data.vtpass.checkedAt)}` : 'Not checked yet — run the health check'} />
            </div>

            {data.vtpass.lowBalance && <Alert tone="warning"><AlertTriangle size={16} aria-hidden /> LOW BALANCE — funding recommended. VTpass wallet {naira(data.vtpass.balance)} is below the alert threshold of {naira(data.vtpass.lowBalanceThreshold)}.</Alert>}

            <div className="grid-2">
              <Card title="Business wallet">
                <KeyValue items={[
                  ['Revenue on the books', naira(data.business.revenueBalance)],
                  ['Withdrawn to the company account', naira(data.business.withdrawn)],
                  ['Withdrawals in progress', naira(data.business.inProgress)],
                  ['Awaiting second approval', naira(data.business.awaitingApproval)],
                  ['Returned (failed / reversed)', naira(data.business.returned)],
                  ['VTpass commission earned', `${naira(data.business.vtpassCommissionEarned)} (kept inside the VTpass float)`],
                ]} />
                <div className="row-wrap" style={{ marginTop: 12 }}>
                  {can('business.withdraw') && <Button icon={Banknote} onClick={() => setWithdrawing(true)} disabled={!active?.usable || data.business.withdrawable <= 0}>Withdraw to bank</Button>}
                  <Link to="/fees" className="btn btn-secondary">Revenue by source</Link>
                  <Link to="/bills" className="btn btn-secondary">Bill revenue</Link>
                </div>
                {!active && <p className="xsmall muted">Add the company payout account below before withdrawing.</p>}
                {active && !active.usable && <p className="xsmall muted">The payout account becomes usable on {formatDateTime(active.activeFrom)} (cooling-off).</p>}
              </Card>

              <Card title="Liquidity overview (estimate)">
                <KeyValue items={[
                  ['Customer wallets + OSUSU + collector + in transit', naira(obligations)],
                  ['Cash at Paystack per the books', naira(Math.max(0, data.paystackBooks))],
                  ['VTpass float (last check)', data.vtpass.balance == null ? 'Unknown' : naira(data.vtpass.balance)],
                  ['Known liquidity − obligations', naira(liquidity - obligations)],
                ]} />
                <p className="xsmall muted">Estimate from ACHIEVER’s ledger and the last VTpass check. “Cash at Paystack per the books” is what the ledger expects; compare it with the Paystack dashboard. This is not a regulatory reserve figure.</p>
              </Card>
            </div>

            <Card title="VTpass provider" actions={can('providers.check') && <Button size="sm" variant="secondary" icon={RefreshCw} loading={checking} onClick={runCheck}>Run VTpass health check</Button>}>
              <KeyValue items={[
                ['Environment', data.vtpass.environment ? (data.vtpass.environment === 'production' ? 'LIVE' : 'SANDBOX') : 'Unknown'],
                ['Status', (data.vtpass.status || 'unknown').toUpperCase()],
                ['Last successful check', data.vtpass.lastSuccessAt ? formatDateTime(data.vtpass.lastSuccessAt) : '—'],
                ['Last failed check', data.vtpass.lastFailureAt ? formatDateTime(data.vtpass.lastFailureAt) : '—'],
                data.vtpass.lastError && ['Last error', data.vtpass.lastError],
                ['Low-balance alert', `${naira(data.vtpass.lowBalanceThreshold)} (Settings → finance)`],
              ].filter(Boolean)} />
              <VtpassReport report={report} />
            </Card>

            <Card title="Company payout account" actions={can('business.accounts') && !pendingAccount && <Button size="sm" variant="secondary" icon={Landmark} onClick={() => setProposing(true)}>{active ? 'Change account' : 'Add account'}</Button>}>
              {active ? (
                <KeyValue items={[['Account', `${active.accountName} · ${active.bankName} ${active.accountNumber}`], ['Usable from', formatDateTime(active.activeFrom)]]} />
              ) : <p className="small muted">No company payout account yet.</p>}
              {pendingAccount && (
                <Alert tone="warning">
                  <strong>Awaiting approval:</strong> {pendingAccount.accountName} · {pendingAccount.bankName} {pendingAccount.accountNumber}. Reason: {pendingAccount.reason}
                  {can('business.approve') && pendingAccount.addedBy !== user.id && (
                    <div className="row-wrap" style={{ marginTop: 8 }}>
                      <Button size="sm" icon={ShieldCheck} onClick={() => decide('accounts', pendingAccount.id, true)}>Approve</Button>
                      <Button size="sm" variant="secondary" onClick={() => decide('accounts', pendingAccount.id, false)}>Reject</Button>
                    </div>
                  )}
                  {pendingAccount.addedBy === user.id && <p className="xsmall" style={{ margin: '6px 0 0' }}>A different administrator must approve it.</p>}
                </Alert>
              )}
            </Card>

            <Card title="Business withdrawals" flush>
              <DataTable
                rows={withdrawals.data || []}
                empty={<p className="small muted" style={{ padding: 16 }}>No business withdrawals yet.</p>}
                columns={[
                  { key: 'r', label: 'Reference', render: (w) => <span className="mono xsmall">{w.reference}</span> },
                  { key: 'a', label: 'Amount', render: (w) => naira(w.amount) },
                  { key: 'd', label: 'To', render: (w) => (w.account ? `${w.account.bankName} ${w.account.accountNumber}` : '—') },
                  { key: 's', label: 'Status', render: (w) => <span className={`badge badge-${W_TONE[w.status] || 'neutral'}`}>{W_LABEL[w.status] || w.status}</span> },
                  { key: 'why', label: 'Reason', render: (w) => <span className="xsmall">{w.reason}{w.failureReason ? ` — ${w.failureReason}` : ''}</span> },
                  { key: 'c', label: 'Created', render: (w) => formatDateTime(w.createdAt) },
                  { key: 'x', label: '', render: (w) => (w.status === 'PENDING_APPROVAL' ? (
                    w.requestedBy === user.id
                      ? <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/admin/finance/withdrawals/${w.id}/cancel`).catch((e) => toast.error(e)); reloadAll(); }}>Cancel</Button>
                      : can('business.approve') && (
                        <span className="row-wrap">
                          <Button size="sm" icon={Lock} onClick={() => decide('withdrawals', w.id, true)}>Approve</Button>
                          <Button size="sm" variant="secondary" onClick={() => decide('withdrawals', w.id, false)}>Reject</Button>
                        </span>
                      )
                  ) : null) },
                ]}
              />
            </Card>
          </>
        )}
      </AsyncContent>
      {withdrawing && data && active && <WithdrawModal o={{ ...data, account: active }} onClose={() => setWithdrawing(false)} onDone={() => { setWithdrawing(false); reloadAll(); }} />}
      {proposing && <ProposeAccount onClose={() => setProposing(false)} onDone={() => { setProposing(false); accounts.reload(); }} />}
    </div>
  );
}
