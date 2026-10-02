import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Copy, Eye, EyeOff, Plus, Send, ShieldAlert } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, EmptyState, PageHeader, SkeletonList } from '../../components/ui/index.js';
import PullToRefresh, { reloadAll } from '../../components/PullToRefresh.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { STATUS_LABEL, TX_FILTERS, balanceHidden, iconFor, setBalanceHidden } from './walletShared.js';

export function TxRow({ t }) {
  const Icon = iconFor(t);
  const credit = t.direction === 'credit';
  return (
    <Link to={`/app/wallet/transactions/${t.id}`} className="wallet-tx">
      <span className={`wallet-tx-icon${credit ? ' is-credit' : ''}`}><Icon size={18} aria-hidden /></span>
      <div className="wallet-tx-main">
        <p style={{ fontWeight: 600 }}>{t.label}</p>
        <p className="xsmall muted">{t.description} · {formatDateTime(t.createdAt)}</p>
      </div>
      <div style={{ textAlign: 'right' }}>
        <span className={`wallet-tx-amount${credit ? ' is-credit' : ''}`}>{credit ? '+' : '−'}{naira(t.amount)}</span>
        {t.status !== 'success' && <p className="xsmall muted" style={{ margin: 0 }}>{STATUS_LABEL[t.status] || t.status}</p>}
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
      toast.success('Wallet ID copied');
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
              <section className="wallet-hero" aria-label="Wallet balance">
                <span className="xsmall">Available balance</span>
                <div className="wallet-balance-row">
                  <p className="wallet-balance" aria-live="polite">{hidden ? '₦ ••••••' : naira(w.available)}</p>
                  <button type="button" className="wallet-eye" onClick={toggle} aria-label={hidden ? 'Show balance' : 'Hide balance'} aria-pressed={hidden}>
                    {hidden ? <Eye size={18} aria-hidden /> : <EyeOff size={18} aria-hidden />}
                  </button>
                </div>
                {w.held > 0 && !hidden && <span className="xsmall">{naira(w.held)} on hold for a transfer under review</span>}
                <button type="button" className="wallet-id" onClick={copyId} aria-label={`Wallet ID ${w.walletId}. Copy`}>
                  {w.walletId} <Copy size={14} aria-hidden />
                </button>
              </section>
              <div className="wallet-actions">
                <Link to="/app/wallet/add" className="wallet-action"><Plus size={22} aria-hidden />Add money</Link>
                {w.transfersEnabled
                  ? <Link to="/app/wallet/send" className="wallet-action"><Send size={22} aria-hidden />Send</Link>
                  : <span className="wallet-action" aria-disabled="true" style={{ opacity: 0.5 }}><Send size={22} aria-hidden />Send</span>}
                <Link to="/app/wallet/autopay" className="wallet-action"><CalendarClock size={22} aria-hidden />Auto-pay</Link>
              </div>
              <p className="wallet-note">{w.notice} Your wallet ID identifies your wallet inside ACHIEVER only.</p>
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
