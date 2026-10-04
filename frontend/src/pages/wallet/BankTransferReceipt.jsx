import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Circle, CircleDot, Clock, RotateCcw, XCircle } from 'lucide-react';
import { AsyncContent, Card, KeyValue, PageHeader } from '../../components/ui/index.js';
import FeeBreakdown from '../../components/domain/FeeBreakdown.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { useRealtimeEvent } from '../../contexts/RealtimeContext.jsx';
import ReceiptShare from '../../components/domain/ReceiptShare.jsx';
import { bankReceiptModel } from '../../services/receiptExport.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { BANK_STATUS } from './walletShared.js';

const OPEN = ['PENDING', 'PROCESSING'];
const HEADLINE = {
  PENDING: 'Transfer processing', PROCESSING: 'Transfer processing', SUCCESS: 'Transfer successful',
  FAILED: 'Transfer not completed', REVERSED: 'Transfer reversed', REFUNDED: 'Transfer refunded', CANCELLED: 'Transfer cancelled', INITIATED: 'Awaiting approval',
};

/** Steps recorded by the server (no invented events). */
function Timeline({ steps = [] }) {
  if (!steps.length) return null;
  return (
    <ol className="tx-timeline" aria-label="Transfer progress">
      {steps.map((s) => {
        const Icon = s.state === 'done' ? (['failed'].includes(s.key) ? XCircle : CheckCircle2) : s.state === 'current' ? CircleDot : Circle;
        return (
          <li key={s.key} className={`tx-step is-${s.state}`}>
            <Icon size={18} aria-hidden />
            <span className="tx-step-text">
              <span>{s.label}</span>
              {s.at && <span className="xsmall muted">{formatDateTime(s.at)}</span>}
              <span className="sr-only">{s.state === 'done' ? '(done)' : s.state === 'current' ? '(in progress)' : '(not yet)'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Bank transfer status. "Submitted" is never shown as "successful": the status comes from the
 * provider (webhook or verify). The page updates when the status-change notification arrives,
 * and checks again every 15 s while the transfer is open and the page is visible.
 */
export default function BankTransferReceipt() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const justSubmitted = params.get('submitted') === '1';
  const r = useAsync(() => api.get(`/wallet/bank-transfers/${id}`), [id]);
  const t = r.data;
  const open = t && OPEN.includes(t.status);
  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') r.reload(); }, 15_000);
    return () => clearInterval(timer);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Success / failure / reversal notifications carry the transfer id: refresh straight away.
  useRealtimeEvent('notification.new', (n) => { if (n?.data?.bank_transfer_id === id) r.reload(); });
  useRealtimeEvent('resync', () => { if (open) r.reload(); });

  const s = t ? BANK_STATUS[t.status] || { label: t.status, tone: 'neutral' } : null;
  const Icon = t?.status === 'SUCCESS' ? CheckCircle2 : t?.status === 'FAILED' ? XCircle : ['REVERSED', 'REFUNDED'].includes(t?.status) ? RotateCcw : Clock;
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/wallet', label: 'Wallet' }} title="Bank transfer" />
      <AsyncContent loading={r.loading && !t} error={r.error} onRetry={r.reload}>
        {t && (
          <Card>
            <div className="stack">
              <div className={`tx-status tx-status-${t.status.toLowerCase()}`} aria-live="polite">
                <Icon size={44} aria-hidden />
                <h2 className="tx-status-title">{HEADLINE[t.status] || 'Bank transfer'}</h2>
                <p className="wallet-balance" style={{ fontSize: '1.75rem', margin: 0 }}>{naira(t.recipientAmount)}</p>
                <span className={`badge badge-${s.tone}`}>{s.label}</span>
                <p className="small muted" style={{ margin: 0 }}>{t.message}</p>
              </div>

              {open && (
                <div className="processing-panel" role="status">
                  <p><strong>{justSubmitted ? 'Your transfer has been submitted and is being processed.' : 'This transfer is still being processed.'}</strong></p>
                  <p className="small">Estimated processing: may take up to 1 hour. You can safely leave this screen — we’ll update the status and notify you when it’s complete.</p>
                  <p className="small"><strong>Please don’t submit another transfer for the same payment.</strong></p>
                </div>
              )}
              {t.status === 'FAILED' && t.failureReason && <p className="small muted" style={{ margin: 0 }}>Reason: {t.failureReason}</p>}

              <KeyValue items={[
                ['Recipient', t.accountName],
                ['Bank', t.bankName],
                ['Account', <span key="a" className="mono">{t.accountNumber}</span>],
                t.narration && ['Description', t.narration],
                ['Transaction ID', <span key="r" className="mono">{t.reference}</span>],
                ['Date', formatDateTime(t.createdAt)],
                t.completedAt && ['Completed', formatDateTime(t.completedAt)],
              ].filter(Boolean)} />
              <FeeBreakdown amount={t.amount} fee={t.fee} total={t.totalDebit} recipientAmount={t.recipientAmount} mode={t.feeBearingMode} />
              <Timeline steps={t.timeline} />
              {t.status === 'SUCCESS' && <ReceiptShare model={bankReceiptModel(t)} />}
              {open && <Link to="/app/wallet" className="btn btn-secondary">Back to wallet</Link>}
            </div>
          </Card>
        )}
      </AsyncContent>
    </div>
  );
}
