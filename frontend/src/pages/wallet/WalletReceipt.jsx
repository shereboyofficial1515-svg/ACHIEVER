import { useParams } from 'react-router-dom';
import { AsyncContent, Button, Card, KeyValue, PageHeader } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { STATUS_LABEL, iconFor } from './walletShared.js';
import RecipientCard from '../../components/domain/RecipientCard.jsx';
import ReceiptShare from '../../components/domain/ReceiptShare.jsx';
import { walletReceiptModel } from '../../services/receiptExport.js';

const TONE = { success: 'success', pending: 'warning', failed: 'danger' };

function ReceiptHead({ t }) {
  const Icon = iconFor(t);
  const credit = t.direction === 'credit';
  return (
    <div className="receipt-head">
      <span className={`receipt-icon ${credit ? 'is-credit' : ''}`} aria-hidden><Icon size={22} /></span>
      <span className="small muted">{t.label}</span>
      <p className={`amount${credit ? ' text-green' : ''}`}>{credit ? '+' : '−'}{naira(t.amount)}</p>
      <span className={`badge badge-${TONE[t.status] || 'neutral'}`}>{STATUS_LABEL[t.status] || t.status}</span>
    </div>
  );
}

export default function WalletReceipt() {
  const { id } = useParams();
  const r = useAsync(() => api.get(`/wallet/transactions/${id}`), [id]);
  const t = r.data;
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/wallet', label: 'Wallet' }} title="Receipt" />
      <AsyncContent loading={r.loading} error={r.error} onRetry={r.reload}>
        {t && (
          <Card>
            <div className="stack">
              <ReceiptHead t={t} />
              {t.counterparty && <RecipientCard party={t.counterparty} label={t.direction === 'credit' ? 'From' : 'To'} />}
              <KeyValue
                items={[
                  ['Status', STATUS_LABEL[t.status] || t.status],
                  t.type !== 'transfer' && ['Description', t.description],   // transfers show the person and any note instead
                  t.note && ['Note', t.note],
                  t.direction === 'debit' && ['Amount', naira(t.principal ?? t.amount)],
                  t.direction === 'debit' && ['Fee', t.fee ? naira(t.fee) : '₦0.00'],
                  t.direction === 'debit' && ['Total debit', naira(t.amount)],
                  t.direction === 'credit' && t.type === 'topup' && t.fee > 0 && ['Top-up fee', naira(t.fee)],
                  ['Reference', <span key="ref" className="mono">{t.reference}</span>],
                  ['Date', formatDateTime(t.createdAt)],
                  t.bank && ['Bank', `${t.bank.name} · ${t.bank.account}`],
                  ['Paid with', 'ACHIEVER Wallet'],
                ].filter(Boolean)}
              />
              {t.billPaymentId && <Button to={`/app/bills/history/${t.billPaymentId}`} variant="secondary">View purchase details</Button>}
              <ReceiptShare model={walletReceiptModel(t)} />
            </div>
          </Card>
        )}
      </AsyncContent>
    </div>
  );
}
