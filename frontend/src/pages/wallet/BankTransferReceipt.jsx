import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Clock, RotateCcw } from 'lucide-react';
import { AsyncContent, Card, KeyValue, PageHeader } from '../../components/ui/index.js';
import FeeBreakdown from '../../components/domain/FeeBreakdown.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import ReceiptShare from '../../components/domain/ReceiptShare.jsx';
import { bankReceiptModel } from '../../services/receiptExport.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { BANK_STATUS } from './walletShared.js';

/** Bank transfer status and receipt. Refreshes while the bank is processing it. */
export default function BankTransferReceipt() {
  const { id } = useParams();
  const r = useAsync(() => api.get(`/wallet/bank-transfers/${id}`), [id]);
  const t = r.data;
  const open = t && ['PENDING', 'PROCESSING'].includes(t.status);
  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(() => r.reload(), 10_000);
    return () => clearInterval(timer);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = t ? BANK_STATUS[t.status] || { label: t.status, tone: 'neutral' } : null;
  const Icon = t?.status === 'SUCCESS' ? CheckCircle2 : ['FAILED', 'REVERSED', 'REFUNDED'].includes(t?.status) ? RotateCcw : Clock;
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/wallet', label: 'Wallet' }} title="Bank transfer" />
      <AsyncContent loading={r.loading && !t} error={r.error} onRetry={r.reload}>
        {t && (
          <Card>
            <div className="stack">
              <div style={{ textAlign: 'center' }} aria-live="polite">
                <Icon size={44} className={t.status === 'SUCCESS' ? 'text-green' : 'text-sky'} aria-hidden />
                <p className="wallet-balance" style={{ fontSize: '1.75rem' }}>{naira(t.recipientAmount)}</p>
                <span className={`badge badge-${s.tone}`}>{s.label}</span>
                <p className="small muted">{t.message}</p>
              </div>
              <KeyValue items={[
                ['Recipient', t.accountName],
                ['Bank', t.bankName],
                ['Account', <span key="a" className="mono">{t.accountNumber}</span>],
                t.narration && ['Description', t.narration],
                ['Reference', <span key="r" className="mono">{t.reference}</span>],
                ['Date', formatDateTime(t.createdAt)],
                t.completedAt && ['Completed', formatDateTime(t.completedAt)],
              ].filter(Boolean)} />
              <FeeBreakdown amount={t.amount} fee={t.fee} total={t.totalDebit} recipientAmount={t.recipientAmount} mode={t.feeBearingMode} />
              <ReceiptShare model={bankReceiptModel(t)} />
            </div>
          </Card>
        )}
      </AsyncContent>
    </div>
  );
}
