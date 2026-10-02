import { useParams } from 'react-router-dom';
import { Share2 } from 'lucide-react';
import { AsyncContent, Button, Card, KeyValue, PageHeader } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { shareContent } from '../../platform/index.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { STATUS_LABEL } from './walletShared.js';

export default function WalletReceipt() {
  const { id } = useParams();
  const r = useAsync(() => api.get(`/wallet/transactions/${id}`), [id]);
  const t = r.data;
  const share = () => shareContent({
    title: 'ACHIEVER Wallet receipt',
    text: `${t.label}: ${naira(t.amount)} · ${STATUS_LABEL[t.status] || t.status} · Ref ${t.reference} · ${formatDateTime(t.createdAt)}`,
  });
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/wallet', label: 'Wallet' }} title="Receipt" />
      <AsyncContent loading={r.loading} error={r.error} onRetry={r.reload}>
        {t && (
          <Card>
            <div className="stack">
              <div style={{ textAlign: 'center' }}>
                <p className="xsmall muted" style={{ margin: 0 }}>{t.label}</p>
                <p className={`wallet-balance${t.direction === 'credit' ? ' text-green' : ''}`} style={{ fontSize: '1.9rem' }}>
                  {t.direction === 'credit' ? '+' : '−'}{naira(t.amount)}
                </p>
              </div>
              <KeyValue
                items={[
                  ['Status', STATUS_LABEL[t.status] || t.status],
                  ['Description', t.description],
                  t.counterparty && [t.direction === 'credit' ? 'From' : 'To', `${t.counterparty.name} · ${t.counterparty.walletId}`],
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
              <Button icon={Share2} variant="secondary" onClick={share}>Share receipt</Button>
            </div>
          </Card>
        )}
      </AsyncContent>
    </div>
  );
}
