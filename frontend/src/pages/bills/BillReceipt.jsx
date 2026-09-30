import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Copy, CreditCard, Eye, LifeBuoy, Printer, RefreshCw, Share2 } from 'lucide-react';
import { Alert, Button, Card, ErrorState, KeyValue, Loader, PageHeader } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useSecureScreen } from '../../hooks/useSecureScreen.js';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { api } from '../../services/api.js';
import { shareContent } from '../../platform/index.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { BillStatus } from './Bills.jsx';

const IN_FLIGHT = new Set(['PENDING', 'PROCESSING', 'UNKNOWN']);

/** Electricity token / exam PINs: fetched only when asked for, hidden from screenshots. */
function Secrets({ id }) {
  const toast = useToast();
  const [secrets, setSecrets] = useState(null);
  const [run, pending] = useSingleFlight();
  useSecureScreen(Boolean(secrets));
  const reveal = () => run(async () => {
    try {
      const { data } = await api.post(`/bills/history/${id}/secrets`);
      setSecrets(data);
    } catch (err) {
      toast.error(err);
    }
  });
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy. Select the text instead.');
    }
  };
  if (!secrets) return <Button variant="secondary" icon={Eye} onClick={reveal} loading={pending}>Show token / PIN</Button>;
  return (
    <div className="stack-sm">
      {secrets.token && (
        <>
          <p className="small muted" style={{ textAlign: 'center' }}>Token{secrets.units ? ` · ${secrets.units}` : ''}</p>
          <div className="token-box">{secrets.token}</div>
          <Button variant="secondary" icon={Copy} onClick={() => copy(secrets.token)}>Copy token</Button>
        </>
      )}
      {secrets.pins?.map((p, i) => (
        <div key={i} className="token-row">
          <div>
            {p.serial && <p className="xsmall muted">Serial {p.serial}</p>}
            <div className="token-box">{p.pin}</div>
          </div>
          <Button variant="secondary" icon={Copy} onClick={() => copy(p.pin)}>Copy PIN</Button>
        </div>
      ))}
      <p className="xsmall muted">Keep this private. ACHIEVER staff will never ask you for it.</p>
    </div>
  );
}

export default function BillReceipt() {
  const { id } = useParams();
  const toast = useToast();
  const bill = useAsync(() => api.get(`/bills/history/${id}`), [id]);
  const [run, pending] = useSingleFlight();
  const b = bill.data;

  // While the provider confirms, check again gently (the server also requeries on its own).
  useEffect(() => {
    if (!b || !IN_FLIGHT.has(b.status)) return undefined;
    const t = setTimeout(() => bill.reload(), 8000);
    return () => clearTimeout(t);
  }, [b]); // eslint-disable-line react-hooks/exhaustive-deps

  const requery = () => run(async () => {
    try {
      const { data } = await api.post(`/bills/history/${id}/requery`);
      bill.setData(data);
    } catch (err) {
      toast.error(err);
    }
  });
  const resume = () => run(async () => {
    try {
      const { data } = await api.post(`/bills/${id}/checkout`);
      if (data.authorizationUrl) window.location.assign(data.authorizationUrl);
    } catch (err) {
      toast.error(err);
    }
  });
  const share = async () => {
    const { data: r } = await api.get(`/bills/history/${id}/receipt`);
    const text = [`ACHIEVER receipt ${r.reference}`, `${r.category}: ${r.service}`, `To: ${r.recipient}`, `Amount ${naira(r.amount)} · Fee ${naira(r.fee)} · Total ${naira(r.total)}`,
      `Status: ${r.status}`, `Date: ${formatDateTime(r.date)}`, r.providerReference && `Provider ref: ${r.providerReference}`].filter(Boolean).join('\n');
    const how = await shareContent({ title: 'ACHIEVER receipt', text });
    if (how === 'copied') toast.success('Receipt copied');
  };

  if (bill.loading && !b) return <Loader label="Loading transaction..." />;
  if (bill.error) return <ErrorState error={bill.error} onRetry={bill.reload} />;
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/bills/history', label: 'Transaction history' }} title="Transaction details" />
      <Card className="receipt">
        <div className="stack">
          <p className="receipt-brand">ACHIEVER</p>
          <p className="amount">{naira(b.total)}</p>
          <p style={{ textAlign: 'center' }}><BillStatus status={b.status} /></p>
          {IN_FLIGHT.has(b.status) && <Alert tone="info">{b.message || 'Your transaction is being processed. We will update you when the provider confirms it.'}</Alert>}
          {b.status === 'FAILED' && <Alert tone="warning">The transaction was not completed. A refund to your original payment method has been started.</Alert>}
          {b.status === 'REVERSED' && <Alert tone="warning">The provider reversed this transaction. A refund has been started.</Alert>}
          {b.status === 'REFUNDED' && <Alert tone="info">This transaction was refunded.</Alert>}
          {b.hasSecrets && b.status === 'SUCCESS' && <Secrets id={id} />}
          <KeyValue
            items={[
              ['Service', `${b.categoryLabel} · ${b.service}`],
              ['Recipient', <span key="r" className="mono">{b.recipient}</span>],
              b.customerName && ['Customer', b.customerName],
              b.quantity > 1 && ['Quantity', b.quantity],
              ['Amount', naira(b.amount)],
              ['Fee', naira(b.fee)],
              ['Total', <strong key="t">{naira(b.total)}</strong>],
              ['ACHIEVER reference', <span key="a" className="mono">{b.reference}</span>],
              b.providerReference && ['Provider reference', <span key="p" className="mono">{b.providerReference}</span>],
              b.paymentReference && ['Payment reference', <span key="y" className="mono">{b.paymentReference}</span>],
              b.authMethod && ['Approved with', b.authMethod === 'device_biometric' ? 'Biometrics on your phone' : 'Transaction PIN + email code'],
              ['Date', formatDateTime(b.createdAt)],
              b.completedAt && ['Completed', formatDateTime(b.completedAt)],
            ].filter(Boolean)}
          />
          {b.history?.length > 0 && (
            <div className="stack-sm">
              <h3 className="small">Status history</h3>
              <ol className="status-timeline">
                {b.history.map((h, i) => (
                  <li key={i}><BillStatus status={h.status} /> <span className="xsmall muted">{formatDateTime(h.at)}</span></li>
                ))}
              </ol>
            </div>
          )}
          <div className="row-wrap no-print" style={{ justifyContent: 'center' }}>
            {b.canResumePayment && <Button icon={CreditCard} onClick={resume} loading={pending}>Continue to payment</Button>}
            {IN_FLIGHT.has(b.status) && <Button variant="secondary" icon={RefreshCw} onClick={requery} loading={pending}>Check status</Button>}
            <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print / save as PDF</Button>
            <Button variant="secondary" icon={Share2} onClick={share}>Share receipt</Button>
            <Link className="btn btn-ghost" to={`/app/support?new=1&category=bill_payment_issue&reference=${encodeURIComponent(b.reference)}`}>
              <LifeBuoy size={16} aria-hidden /> Report a problem
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
