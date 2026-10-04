import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, CalendarClock, Copy, Eye, EyeOff, Plus, ShieldAlert } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, EmptyState, PageHeader, SkeletonList } from '../../components/ui/index.js';
import PullToRefresh, { reloadAll } from '../../components/PullToRefresh.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { BANK_STATUS, STATUS_LABEL, TX_FILTERS, balanceHidden, iconFor, setBalanceHidden } from './walletShared.js';

export function TxRow({ t }) {
  const Icon = iconFor(t);
  const credit = t.direction === 'credit';
  return (
    <Link to={t.bankTransferId && t.type === 'bank_transfer' ? `/app/wallet/bank-transfers/${t.bankTransferId}` : `/app/wallet/transactions/${t.id}`} className="wallet-tx">
      <span className={`wallet-tx-icon${credit ? ' is-credit' : ''}`}><Icon size={18} aria-hidden /></span>
      <div className="wallet-tx-main">
        <p style={{ fontWeight: 600 }}>{t.label}</p>
        <p className="xsmall muted">{t.description} · {formatDateTime(t.createdAt)}</p>
      </div>
      <div style={{ textAlign: 'right' }}>
        <span className={`wallet-tx-amount${credit ? ' is-credit' : ''}`}>{credit ? '+' : '−'}{naira(t.amount)}</span>
        {t.transferStatus ? (
          <span className={`badge badge-${BANK_STATUS[t.transferStatus]?.tone || 'neutral'} tx-status-badge`}>{BANK_STATUS[t.transferStatus]?.label || t.transferStatus}</span>
        ) : t.status !== 'success' && <p className="xsmall muted" style={{ margin: 0 }}>{STATUS_LABEL[t.status] || t.status}</p>}
      </div>
    </Link>
  );
}

/** ACHIEVER Wallet: balance (hide/show), wallet ID, add money, send, automatic payments, history. */
export default function Wallet() {
  const toast = useToast();
  const [hidden, setHidden] = useState(balanceHidden());
  const [filter, setFilter] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const summary = useAsync(() => api.get('/wallet'), []);
  const txs = useAsync(() => api.get('/wallet/transactions', { type: filter || undefined, page: 1, pageSize }), [filter, pageSize]);
  const w = summary.data;

  const toggle = () => { setBalanceHidden(!hidden); setHidden(!hidden); };
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(w.walletId);
      toast.success('Wallet account number copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <PullToRefresh onRefresh={() => reloadAll(summary, txs)}>
      <div className="stack-lg">
        <PageHeader title="ACHIEVER Wallet" subtitle="Add money, pay bills and contributions, and send to other members" />
        <AsyncContent loading={summary.loading && !w} error={summary.error} onRetry={summary.reload} skeleton={<SkeletonList rows={2} />}>
          {w && (
            <>
              {w.status !== 'active' && <Alert tone="warning" icon={ShieldAlert}>{w.statusReason}</Alert>}
              {!w.enabled && <Alert tone="info">ACHIEVER Wallet is temporarily unavailable. Your balance is safe.</Alert>}
              <section className="wallet-hero" aria-label="ACHIEVER Wallet">
                <span className="wallet-hero-title">ACHIEVER WALLET</span>
                <span className="xsmall">Available balance</span>
                <div className="wallet-balance-row">
                  <p className="wallet-balance" aria-live="polite">{hidden ? '₦ ••••••' : naira(w.available)}</p>
                  <button type="button" className="wallet-eye" onClick={toggle} aria-label={hidden ? 'Show balance' : 'Hide balance'} aria-pressed={hidden}>
                    {hidden ? <Eye size={18} aria-hidden /> : <EyeOff size={18} aria-hidden />}
                  </button>
                </div>
                {w.held > 0 && !hidden && <span className="xsmall">{naira(w.held)} on hold for a transfer under review</span>}
                <div className="wallet-account">
                  <span className="xsmall">Wallet account number</span>
                  <div className="wallet-account-row">
                    <span className="wallet-account-number" aria-label={`Wallet account number ${w.walletId.split('').join(' ')}`}>{w.walletId}</span>
                    <button type="button" className="wallet-copy" onClick={copyId} aria-label="Copy wallet account number">
                      <Copy size={14} aria-hidden /> Copy
                    </button>
                  </div>
                  <span className="xsmall">ACHIEVER Wallet account · not a bank account</span>
                </div>
              </section>
              <div className="wallet-actions">
                <Link to="/app/wallet/add" className="wallet-action"><Plus size={22} aria-hidden />Add money</Link>
                {w.transfersEnabled || w.bankTransfersEnabled
                  ? <Link to="/app/wallet/transfer" className="wallet-action"><ArrowLeftRight size={22} aria-hidden />Transfer</Link>
                  : <span className="wallet-action" aria-disabled="true" style={{ opacity: 0.5 }}><ArrowLeftRight size={22} aria-hidden />Transfer</span>}
                <Link to="/app/wallet/autopay" className="wallet-action"><CalendarClock size={22} aria-hidden />Auto-pay</Link>
              </div>
              <p className="wallet-note">{w.notice} Your wallet account number identifies your wallet inside ACHIEVER only; to receive money from a bank, add money with Paystack.</p>
            </>
          )}
        </AsyncContent>

        <Card title="Transactions">
          <div className="stack">
            <div className="wallet-chips" role="group" aria-label="Filter transactions">
              {TX_FILTERS.map((f) => (
                <button key={f.value} type="button" className="wallet-chip" aria-pressed={filter === f.value} onClick={() => { setFilter(f.value); setPageSize(20); }}>{f.label}</button>
              ))}
            </div>
            <AsyncContent
              loading={txs.loading && !txs.data}
              error={txs.error}
              onRetry={txs.reload}
              empty={!txs.data?.length}
              emptyState={<EmptyState title="No transactions yet" message="Add money to start using your ACHIEVER Wallet." action={<Button to="/app/wallet/add" icon={Plus}>Add money</Button>} />}
            >
              <div>{(txs.data || []).map((t) => <TxRow key={t.id} t={t} />)}</div>
              {txs.meta && txs.meta.total > (txs.data?.length || 0) && (
                <Button variant="secondary" onClick={() => setPageSize((n) => Math.min(n + 20, 100))} loading={txs.loading}>Show more</Button>
              )}
            </AsyncContent>
          </div>
        </Card>
      </div>
    </PullToRefresh>
  );
}
