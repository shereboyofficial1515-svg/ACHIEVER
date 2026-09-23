import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer, RefreshCw } from 'lucide-react';
import { Alert, Button, Card, ErrorState, KeyValue, Loader, PageHeader, StatusBadge } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime, naira } from '../../utils/format.js';

export default function BillReceipt() {
  const { id } = useParams();
  const toast = useToast();
  const bill = useAsync(() => api.get(`/bills/${id}`), [id]);
  const [checking, setChecking] = useState(false);

  // While delivery is in progress, poll gently for the final outcome.
  useEffect(() => {
    if (!bill.data || !['paid', 'processing', 'awaiting_payment'].includes(bill.data.status)) return undefined;
    const t = setTimeout(() => bill.reload(), 5000);
    return () => clearTimeout(t);
  }, [bill.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const requery = async () => {
    setChecking(true);
    try {
      const { data } = await api.post(`/bills/${id}/requery`);
      bill.setData(data);
    } catch (err) {
      toast.error(err);
    } finally {
      setChecking(false);
    }
  };

  if (bill.loading && !bill.data) return <Loader label="Loading receipt..." />;
  if (bill.error) return <ErrorState error={bill.error} onRetry={bill.reload} />;
  const b = bill.data;
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/bills', label: 'Bills' }} title="Receipt" />
      <Card className="receipt">
        <div className="stack">
          <p className="amount">{naira(b.amount)}</p>
          <p style={{ textAlign: 'center' }}>
            <StatusBadge status={b.status} />
          </p>
          {b.token && (
            <div className="stack-sm">
              <p className="small muted" style={{ textAlign: 'center' }}>
                Electricity token {b.units ? `· ${b.units}` : ''}
              </p>
              <div className="token-box">{b.token}</div>
            </div>
          )}
          {b.status === 'processing' && <Alert tone="info">Your purchase is being confirmed with the provider. This page updates automatically.</Alert>}
          {['refund_pending', 'refunded'].includes(b.status) && <Alert tone="warning">Delivery failed. {b.status === 'refunded' ? 'Your refund has been processed.' : 'A refund has been initiated to your original payment method.'}</Alert>}
          <KeyValue
            items={[
              ['Service', `${b.category[0].toUpperCase()}${b.category.slice(1)} · ${b.serviceId}`],
              ['Customer', b.customerName ? `${b.customerIdentifier} (${b.customerName})` : b.customerIdentifier],
              ['Reference', <span key="r" className="mono">{b.reference}</span>],
              b.paymentReference && ['Payment reference', <span key="p" className="mono">{b.paymentReference}</span>],
              b.providerReference && ['Provider reference', <span key="v" className="mono">{b.providerReference}</span>],
              ['Created', formatDateTime(b.createdAt)],
              b.completedAt && ['Completed', formatDateTime(b.completedAt)],
            ]}
          />
          <div className="row no-print" style={{ justifyContent: 'center' }}>
            {b.status === 'processing' && (
              <Button variant="secondary" icon={RefreshCw} onClick={requery} loading={checking}>
                Check status
              </Button>
            )}
            <Button variant="secondary" icon={Printer} onClick={() => window.print()}>
              Print
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
