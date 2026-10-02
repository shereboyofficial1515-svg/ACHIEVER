import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, DataTable, Input, KeyValue, Modal, PageHeader, Select, StatCard, Tabs, Textarea } from '../components/ui/index.js';
import { useConfirm } from '../components/ui/ConfirmProvider.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api, newIdempotencyKey } from '../services/api.js';
import { formatDateTime, naira, parseNairaToKobo } from '../utils/format.js';
import { AdminTable } from './adminShared.jsx';

const KIND_LABEL = {
  paystack_clearing: 'Paystack clearing', bill_settlement: 'Bill settlement', fees: 'Fees', osusu_pool: 'OSUSU pool',
  collector_pool: 'Collector pool', rewards: 'Rewards', adjustments: 'Adjustments',
};
const StatusBadge = ({ s }) => <span className={`badge badge-${s === 'active' ? 'success' : s === 'frozen' ? 'warning' : 'neutral'}`}>{s}</span>;

function Overview() {
  const s = useAsync(() => api.get('/admin/wallets/stats'), []);
  const d = s.data;
  return (
    <AsyncContent loading={s.loading} error={s.error} onRetry={s.reload}>
      {d && (
        <div className="stack-lg">
          <div className="stat-grid">
            <StatCard label="Member wallets" value={d.wallets} sub={`${d.frozen} on hold · ${d.negative} negative`} />
            <StatCard label="Total member balances" value={naira(d.totalBalance)} sub={`${naira(d.totalHeld)} held for review`} />
            <StatCard label="Wallet transactions (24 h)" value={d.transactions24h} />
            <StatCard label="Waiting for a decision" value={d.pendingReview + d.pendingAdjustments} sub={`${d.pendingReview} transfers · ${d.pendingAdjustments} adjustments`} />
          </div>
          <Card title="System ledger accounts" actions={<Button variant="ghost" icon={RefreshCw} onClick={s.reload}>Refresh</Button>}>
            <DataTable rows={d.system} rowKey="code" columns={[
              { key: 'k', label: 'Account', render: (a) => KIND_LABEL[a.kind] || a.kind },
              { key: 'c', label: 'Code', render: (a) => <span className="mono xsmall">{a.code}</span> },
              { key: 'b', label: 'Balance', align: 'right', render: (a) => <span className="money">{naira(a.balance)}</span> },
            ]} />
            <p className="xsmall muted">Double-entry: member balances plus these accounts always sum to zero. A negative clearing balance is money received from Paystack and held for members.</p>
          </Card>
        </div>
      )}
    </AsyncContent>
  );
}

function WalletDetail({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirmAction = useConfirm();
  const d = useAsync(() => api.get(`/admin/wallets/${id}`), [id]);
  const [reason, setReason] = useState('');
  const [adj, setAdj] = useState({ direction: 'credit', amount: '', reason: '' });
  const [pending, setPending] = useState(false);
  const w = d.data;

  const setStatus = async (status) => {
    if (!(await confirmAction({ type: status === 'active' ? 'wallet_unfreeze' : 'wallet_freeze' }))) return;
    setPending(true);
    try {
      await api.post(`/admin/wallets/${id}/status`, { status, reason });
      toast.success(status === 'active' ? 'Wallet available again' : 'Wallet placed on hold');
      setReason('');
      d.reload();
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  const requestAdjustment = async () => {
    if (!(await confirmAction({ type: 'wallet_adjust_request' }))) return;
    setPending(true);
    try {
      await api.post(`/admin/wallets/${id}/adjustments`, { direction: adj.direction, amount: parseNairaToKobo(adj.amount), reason: adj.reason }, { idempotencyKey: newIdempotencyKey() });
      toast.success('Adjustment requested. A second administrator must approve it.');
      setAdj({ direction: 'credit', amount: '', reason: '' });
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Wallet" wide>
      <AsyncContent loading={d.loading} error={d.error} onRetry={d.reload}>
        {w && (
          <div className="stack-lg">
            <KeyValue items={[
              ['Wallet ID', <span key="w" className="mono">{w.walletId}</span>],
              ['Status', <StatusBadge key="s" s={w.status} />],
              w.statusReason && ['Reason', w.statusReason],
              ['Balance', naira(w.balance)],
              ['Held', naira(w.held)],
            ].filter(Boolean)} />
            {can('wallet.manage') && (
              <Card title={w.status === 'active' ? 'Place on hold' : 'Release hold'}>
                <div className="stack">
                  <Textarea label="Reason (recorded in the audit log and shown to no one else)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                  <div>
                    {w.status === 'active'
                      ? <Button variant="danger" onClick={() => setStatus('frozen')} loading={pending} disabled={reason.trim().length < 5}>Place wallet on hold</Button>
                      : <Button onClick={() => setStatus('active')} loading={pending} disabled={reason.trim().length < 5}>Release hold</Button>}
                  </div>
                </div>
              </Card>
            )}
            {can('wallet.adjust') && (
              <Card title="Request an adjustment">
                <div className="stack">
                  <Alert tone="info">Adjustments are posted through the ledger only after a different administrator approves them. Use them to correct errors, never to “edit” a balance.</Alert>
                  <div className="form-grid">
                    <Select label="Type" value={adj.direction} onChange={(e) => setAdj({ ...adj, direction: e.target.value })} options={[{ value: 'credit', label: 'Credit (add to wallet)' }, { value: 'debit', label: 'Debit (remove from wallet)' }]} />
                    <Input label="Amount (₦)" inputMode="decimal" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} />
                  </div>
                  <Textarea label="Reason (at least 10 characters, e.g. the ticket or transaction it corrects)" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} rows={2} />
                  <div><Button onClick={requestAdjustment} loading={pending} disabled={!parseNairaToKobo(adj.amount) || adj.reason.trim().length < 10}>Request adjustment</Button></div>
                </div>
              </Card>
            )}
            <Card title="Recent wallet transactions" flush>
              <DataTable rows={w.transactions} columns={[
                { key: 'r', label: 'Reference', render: (t) => <span className="mono xsmall">{t.reference}</span> },
                { key: 'l', label: 'Type', render: (t) => t.label },
                { key: 'a', label: 'Amount', align: 'right', render: (t) => <span className="money">{t.direction === 'credit' ? '+' : '−'}{naira(t.amount)}</span> },
                { key: 's', label: 'Status', render: (t) => t.status },
                { key: 'd', label: 'Date', render: (t) => formatDateTime(t.createdAt) },
              ]} />
            </Card>
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
}

function Decision({ title, confirmType, onDecide, onClose }) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const confirmAction = useConfirm();
  const decide = async (approve) => {
    if (!(await confirmAction({ type: `${confirmType}_${approve ? 'approve' : 'reject'}` }))) return;
    setPending(true);
    try {
      await onDecide(approve, reason);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="stack">
        <Textarea label="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        <div className="row-wrap">
          <Button onClick={() => decide(true)} loading={pending} disabled={reason.trim().length < 5}>Approve</Button>
          <Button variant="danger" onClick={() => decide(false)} loading={pending} disabled={reason.trim().length < 5}>Reject</Button>
        </div>
        <p className="xsmall muted">You cannot decide on a request you made yourself.</p>
      </div>
    </Modal>
  );
}

function Adjustments() {
  const toast = useToast();
  const { can } = useAuth();
  const [status, setStatus] = useState('PENDING');
  const [open, setOpen] = useState(null);
  const list = useAsync(() => api.get('/admin/wallets/adjustments', status ? { status } : {}), [status]);
  return (
    <Card title="Adjustment requests" flush actions={<Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'PENDING', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }, { value: '', label: 'All' }]} />}>
      <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.data?.length}>
        <DataTable rows={list.data || []} columns={[
          { key: 'w', label: 'Wallet', render: (a) => <span className="mono xsmall">{a.wallet?.wallet_code}</span> },
          { key: 't', label: 'Type', render: (a) => a.direction },
          { key: 'a', label: 'Amount', align: 'right', render: (a) => <span className="money">{naira(a.amount)}</span> },
          { key: 'r', label: 'Reason', render: (a) => <span className="xsmall">{a.reason}</span> },
          { key: 'b', label: 'Requested by', render: (a) => `${a.requester?.full_name || '—'} · ${formatDateTime(a.created_at)}` },
          { key: 's', label: 'Status', render: (a) => a.status },
          { key: 'x', label: '', render: (a) => (a.status === 'PENDING' && can('wallet.adjust') ? <Button size="sm" onClick={() => setOpen(a)}>Decide</Button> : null) },
        ]} />
      </AsyncContent>
      {open && (
        <Decision
          title={`${open.direction === 'credit' ? 'Credit' : 'Debit'} ${naira(open.amount)} · ${open.wallet?.wallet_code}`}
          confirmType="wallet_adjust"
          onClose={() => setOpen(null)}
          onDecide={async (approve, reason) => {
            try {
              await api.post(`/admin/wallets/adjustments/${open.id}/decide`, { approve, reason }, { idempotencyKey: newIdempotencyKey() });
              toast.success(approve ? 'Adjustment approved and posted' : 'Adjustment rejected');
              setOpen(null);
              list.reload();
            } catch (err) {
              toast.error(err);
            }
          }}
        />
      )}
    </Card>
  );
}

function TransfersForReview() {
  const toast = useToast();
  const { can } = useAuth();
  const [open, setOpen] = useState(null);
  const list = useAsync(() => api.get('/admin/wallets/transfers/review'), []);
  return (
    <Card title="Large transfers held for review" flush>
      <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.data?.length}>
        <DataTable rows={list.data || []} columns={[
          { key: 'r', label: 'Reference', render: (t) => <span className="mono xsmall">{t.reference}</span> },
          { key: 's', label: 'Sender', render: (t) => `${t.sender?.name || '—'} (${t.sender?.email || ''})` },
          { key: 'a', label: 'Amount', align: 'right', render: (t) => <span className="money">{naira(t.amount)}</span> },
          { key: 'd', label: 'Requested', render: (t) => formatDateTime(t.created_at) },
          { key: 'x', label: '', render: (t) => (can('wallet.manage') ? <Button size="sm" onClick={() => setOpen(t)}>Review</Button> : null) },
        ]} />
      </AsyncContent>
      {open && (
        <Decision
          title={`Transfer ${open.reference} · ${naira(open.amount)}`}
          confirmType="wallet_transfer"
          onClose={() => setOpen(null)}
          onDecide={async (approve, reason) => {
            try {
              await api.post(`/admin/wallets/transfers/${open.id}/review`, { approve, reason }, { idempotencyKey: newIdempotencyKey() });
              toast.success(approve ? 'Transfer approved and completed' : 'Transfer rejected; the money is available to the sender again');
              setOpen(null);
              list.reload();
            } catch (err) {
              toast.error(err);
            }
          }}
        />
      )}
    </Card>
  );
}

const BANK_TONE = { SUCCESS: 'success', PROCESSING: 'info', PENDING: 'warning', INITIATED: 'neutral', FAILED: 'danger', REVERSED: 'warning', REFUNDED: 'neutral', CANCELLED: 'neutral' };

function BankTransferActions({ t, onDone, onClose }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirmAction = useConfirm();
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const act = async (kind) => {
    if (!(await confirmAction({ type: kind === 'paid' ? 'bank_mark_paid' : 'bank_refund' }))) return;
    setPending(true);
    try {
      if (kind === 'paid') await api.post(`/admin/wallets/bank-transfers/${t.id}/mark-paid`, { manualReference: ref }, { idempotencyKey: newIdempotencyKey() });
      else await api.post(`/admin/wallets/bank-transfers/${t.id}/refund`, { reason }, { idempotencyKey: newIdempotencyKey() });
      toast.success(kind === 'paid' ? 'Recorded as sent' : 'Refunded to the wallet');
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  const requery = async () => {
    try {
      const { data } = await api.post(`/admin/wallets/bank-transfers/${t.id}/requery`, {});
      toast.success(`Status: ${data.status}`);
      onDone();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Bank transfer ${t.reference}`} wide>
      <div className="stack">
        <KeyValue items={[
          ['Member', `${t.user?.name || '—'} (${t.user?.email || ''})`],
          ['Recipient', `${t.accountName} · ${t.bankName} ${t.accountNumber}`],
          ['Amount / fee / total debit', `${naira(t.amount)} / ${naira(t.fee)} / ${naira(t.totalDebit)}`],
          ['Recipient receives', naira(t.recipientAmount)],
          ['Status', <span key="s" className={`badge badge-${BANK_TONE[t.status] || 'neutral'}`}>{t.status}</span>],
          ['Payout', t.executionMode === 'manual' ? 'Manual (finance pays from the bank)' : 'Paystack Transfer'],
          t.transferCode && ['Paystack transfer code', t.transferCode],
          t.providerStatus && ['Provider status', t.providerStatus],
          t.providerCost != null && ['Provider cost', `${naira(t.providerCost)}${t.providerCostEstimated ? ' (estimated)' : ''}`],
          t.manualReference && ['Bank reference', t.manualReference],
          t.failureReason && ['Reason', t.failureReason],
        ].filter(Boolean)} />
        {t.executionMode === 'manual' && t.status === 'PENDING' && can('wallet.payouts') && (
          <Card title="Manual payout">
            <div className="stack">
              <Input label="Bank / transfer reference" value={ref} onChange={(e) => setRef(e.target.value)} />
              <div className="row-wrap">
                <Button onClick={() => act('paid')} loading={pending} disabled={ref.trim().length < 4}>Record as sent</Button>
              </div>
              <Textarea label="Or refund it (reason)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              <div><Button variant="danger" onClick={() => act('refund')} loading={pending} disabled={reason.trim().length < 5}>Refund to wallet</Button></div>
            </div>
          </Card>
        )}
        {t.executionMode !== 'manual' && ['PENDING', 'PROCESSING'].includes(t.status) && (can('wallet.payouts') || can('wallet.manage')) && (
          <div><Button variant="secondary" onClick={requery}>Check status with Paystack</Button></div>
        )}
      </div>
    </Modal>
  );
}

function BankTransfers() {
  const [open, setOpen] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <>
      <AdminTable
        endpoint="/admin/wallets/bank-transfers"
        reloadKey={reloadKey}
        onRowClick={setOpen}
        filters={[
          { name: 'search', label: 'Reference (ACH-WBT-…)' },
          { name: 'status', label: 'All statuses', options: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED', 'REFUNDED', 'INITIATED', 'CANCELLED'] },
        ]}
        columns={[
          { key: 'r', label: 'Reference', render: (t) => <span className="mono xsmall">{t.reference}</span> },
          { key: 'u', label: 'Member', render: (t) => t.user?.name },
          { key: 'to', label: 'Recipient', render: (t) => <span>{t.accountName}<br /><span className="xsmall muted">{t.bankName} · {t.accountNumber}</span></span> },
          { key: 'a', label: 'Amount', align: 'right', render: (t) => <span className="money">{naira(t.amount)}</span> },
          { key: 'f', label: 'Fee', align: 'right', render: (t) => naira(t.fee) },
          { key: 's', label: 'Status', render: (t) => <span className={`badge badge-${BANK_TONE[t.status] || 'neutral'}`}>{t.status}{t.executionMode === 'manual' && t.status === 'PENDING' ? ' · manual' : ''}</span> },
          { key: 'd', label: 'Created', render: (t) => formatDateTime(t.createdAt) },
        ]}
      />
      {open && <BankTransferActions t={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); setReloadKey((k) => k + 1); }} />}
    </>
  );
}

export default function AdminWallets() {
  const [tab, setTab] = useState('overview');
  const [detail, setDetail] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="stack-lg">
      <PageHeader title="ACHIEVER Wallet" subtitle="Member wallets, ledger accounts, held transfers and two-person adjustments" />
      <Alert tone="info">ACHIEVER Wallet is an internal stored-value balance, not a bank account. Balances change only through the ledger: never edit them directly.</Alert>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Overview' },
        { value: 'wallets', label: 'Wallets' },
        { value: 'transfers', label: 'Held transfers' },
        { value: 'bank', label: 'Bank transfers' },
        { value: 'adjustments', label: 'Adjustments' },
      ]} />
      {tab === 'overview' && <Overview />}
      {tab === 'wallets' && (
        <AdminTable
          endpoint="/admin/wallets"
          reloadKey={reloadKey}
          onRowClick={(w) => setDetail(w.id)}
          filters={[
            { name: 'search', label: 'Wallet ID (ACHW-…), name or email' },
            { name: 'status', label: 'All statuses', options: ['active', 'frozen', 'closed'] },
          ]}
          columns={[
            { key: 'w', label: 'Wallet ID', render: (w) => <span className="mono xsmall">{w.walletId}</span> },
            { key: 'o', label: 'Owner', render: (w) => <span>{w.owner?.name}<br /><span className="xsmall muted">{w.owner?.email}</span></span> },
            { key: 'b', label: 'Balance', align: 'right', render: (w) => <span className="money">{naira(w.balance)}</span> },
            { key: 'h', label: 'Held', align: 'right', render: (w) => (w.held ? naira(w.held) : '—') },
            { key: 's', label: 'Status', render: (w) => <StatusBadge s={w.status} /> },
            { key: 'd', label: 'Opened', render: (w) => formatDateTime(w.createdAt) },
          ]}
        />
      )}
      {tab === 'transfers' && <TransfersForReview />}
      {tab === 'bank' && <BankTransfers />}
      {tab === 'adjustments' && <Adjustments />}
      {detail && <WalletDetail id={detail} onClose={() => setDetail(null)} onChanged={() => setReloadKey((k) => k + 1)} />}
    </div>
  );
}
