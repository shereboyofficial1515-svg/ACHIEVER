import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Clock3, Copy, CreditCard, Eye, LifeBuoy, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { Alert, Button, Card, Checkbox, ErrorState, KeyValue, Loader, PageHeader } from '../../components/ui/index.js';
import ReceiptShare from '../../components/domain/ReceiptShare.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useSecureScreen } from '../../hooks/useSecureScreen.js';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { api } from '../../services/api.js';
import { billReceiptModel } from '../../services/receiptExport.js';
import { formatDateTime, naira } from '../../utils/format.js';
import { CATEGORY } from './billsShared.js';
import { BillStatus, CategoryIcon } from './billsUi.jsx';

const IN_FLIGHT = new Set(['PENDING', 'PROCESSING', 'UNKNOWN']);
const NOT_DONE = new Set(['FAILED', 'REVERSED', 'REFUNDED', 'CANCELLED']);

async function copyText(toast, text, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what);
  } catch {
    toast.error('Could not copy. Select the text instead.');
  }
}

/** Electricity token / exam PINs: fetched only when asked for (audited), hidden from screenshots. */
function Secrets({ id, secrets, onRevealed, includeOnReceipt, onInclude }) {
  const toast = useToast();
  const [run, pending] = useSingleFlight();
  useSecureScreen(Boolean(secrets));
  const reveal = () => run(async () => {
    try {
      const { data } = await api.post(`/bills/history/${id}/secrets`);
      onRevealed(data);
    } catch (err) {
      toast.error(err);
    }
  });
  if (!secrets) {
    return (
      <div className="secret-panel">
        <p className="small"><strong>Your token / PIN is ready.</strong> It is shown only when you ask, and only to you.</p>
        <Button variant="secondary" icon={Eye} onClick={reveal} loading={pending}>Show token / PIN</Button>
      </div>
    );
  }
  return (
    <div className="secret-panel stack-sm">
      {secrets.token && (
        <>
          <p className="xsmall muted">Electricity token{secrets.units ? ` · ${secrets.units}` : ''}</p>
          <div className="token-box">{secrets.token}</div>
          <Button variant="secondary" icon={Copy} onClick={() => copyText(toast, secrets.token, 'Token copied')}>Copy token</Button>
        </>
      )}
      {secrets.pins?.map((p, i) => (
        <div key={i} className="token-row">
          <div>
            {p.serial && <p className="xsmall muted">Serial {p.serial}</p>}
            <div className="token-box">{p.pin}</div>
          </div>
          <Button variant="secondary" icon={Copy} onClick={() => copyText(toast, p.pin, 'PIN copied')}>Copy PIN</Button>
        </div>
      ))}
      <Checkbox checked={includeOnReceipt} onChange={(e) => onInclude(e.target.checked)}
        label={`Include the ${secrets.token ? 'token' : 'PIN'} on the shared receipt`} />
      <p className="xsmall muted">Keep this private. Anyone with it can use it. ACHIEVER staff will never ask you for it.</p>
    </div>
  );
}

const HERO = {
  SUCCESS: { icon: CheckCircle2, tone: 'success', text: 'Payment successful' },
  PROCESSING: { icon: Clock3, tone: 'info', text: 'Processing' },
  PENDING: { icon: Clock3, tone: 'warning', text: 'Pending' },
  UNKNOWN: { icon: Clock3, tone: 'info', text: 'Awaiting confirmation' },
};

export default function BillReceipt() {
  const { id } = useParams();
  const toast = useToast();
  const bill = useAsync(() => api.get(`/bills/history/${id}`), [id]);
  const b = bill.data;
  // Receipt facts (service-specific). Not available for unapproved or cancelled purchases.
  const rc = useAsync(() => api.get(`/bills/history/${id}/receipt`).catch(() => ({ data: null })), [id, b?.status]);
  const [run, pending] = useSingleFlight();
  const [secrets, setSecrets] = useState(null);
  const [includeSecrets, setIncludeSecrets] = useState(false);

  // While the provider confirms, check again gently (the server also requeries on its own).
  useEffect(() => {
    if (!b || !IN_FLIGHT.has(b.status)) return undefined;
    const t = setTimeout(() => bill.reload(), 8000);
    return () => clearTimeout(t);
  }, [b]); // eslint-disable-line react-hooks/exhaustive-deps

  const model = useMemo(
    () => (rc.data ? billReceiptModel(rc.data, { secrets: includeSecrets ? secrets : null }) : null),
    [rc.data, secrets, includeSecrets],
  );

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

  if (bill.loading && !b) return <Loader label="Loading transaction..." />;
  if (bill.error) return <ErrorState error={bill.error} onRetry={bill.reload} />;

  const hero = HERO[b.status] || { icon: XCircle, tone: NOT_DONE.has(b.status) ? 'danger' : 'neutral', text: null };
  const HeroIcon = hero.icon;
  const meta = CATEGORY[b.category];
  // Details: the server's receipt rows when available (same rows as the shared file), otherwise the transaction summary.
  const rows = model
    ? model.rows.filter(([label]) => !['Token', 'PIN'].includes(label) && !/^PIN \d/.test(label))
    : [['Service', `${b.categoryLabel} · ${b.service}`], ['Recipient', b.recipient], ['Amount', naira(b.amount)], ['Fee', naira(b.fee)], ['Total', naira(b.total)], ['Reference', b.reference], ['Date', formatDateTime(b.createdAt)]];
  const MONO = new Set(['Reference', 'Provider reference', 'Payment reference', 'Phone number', 'Meter number', 'Smartcard / IUC number', 'Customer ID', 'Profile / candidate ID']);

  return (
    <div className="stack-lg bill-receipt-page">
      <PageHeader back={{ to: '/app/bills/history', label: 'Transaction history' }} title="Transaction details" />
      <Card className={`bill-receipt tone-${hero.tone}`}>
        <div className="stack">
          <div className="bill-receipt-hero">
            <span className="bill-receipt-cat"><CategoryIcon category={b.category} size={48} /></span>
            <p className="bill-receipt-title">{meta?.verb || b.categoryLabel}</p>
            <p className="bill-receipt-amount">{naira(b.total)}</p>
            <p className={`bill-receipt-status is-${hero.tone}`}><HeroIcon size={16} aria-hidden /> <BillStatus status={b.status} /></p>
            <p className="xsmall muted">{formatDateTime(b.completedAt || b.createdAt)}</p>
          </div>

          {IN_FLIGHT.has(b.status) && <Alert tone="info">{b.message || 'Your transaction is being processed. We will update you when the provider confirms it.'} No receipt is issued until it is confirmed.</Alert>}
          {b.status === 'FAILED' && <Alert tone="warning">{b.message || 'The transaction was not completed.'} A refund to your original payment method has been started.</Alert>}
          {b.status === 'REVERSED' && <Alert tone="warning">The provider reversed this transaction. A refund has been started.</Alert>}
          {b.status === 'REFUNDED' && <Alert tone="info">{b.message || 'This transaction was refunded.'}</Alert>}
          {b.status === 'AWAITING_AUTHORIZATION' && <Alert tone="info">This purchase was not approved, so nothing was charged.</Alert>}

          {b.hasSecrets && b.status === 'SUCCESS' && (
            <Secrets id={id} secrets={secrets} onRevealed={setSecrets} includeOnReceipt={includeSecrets} onInclude={setIncludeSecrets} />
          )}

          <KeyValue items={rows.map(([k, v]) => [k, MONO.has(k) ? <span key={k} className="mono">{v}</span> : v])} />

          <div className="row-wrap receipt-quick-actions">
            <Button variant="ghost" icon={Copy} onClick={() => copyText(toast, b.reference, 'Reference copied')}>Copy reference</Button>
            {meta && <Link className="btn btn-ghost" to={`/app/bills/buy/${b.category}`}><RotateCcw size={16} aria-hidden /> Buy again</Link>}
          </div>

          {model && <ReceiptShare model={model} saveActions />}
          {!model && b.status === 'SUCCESS' && rc.loading && <p className="xsmall muted">Preparing receipt…</p>}

          {b.history?.length > 0 && (
            <details className="status-details">
              <summary className="small">Status history</summary>
              <ol className="status-timeline">
                {b.history.map((h, i) => (
                  <li key={i}><BillStatus status={h.status} /> <span className="xsmall muted">{formatDateTime(h.at)}</span></li>
                ))}
              </ol>
            </details>
          )}
          <div className="row-wrap no-print receipt-support-actions">
            {b.canResumePayment && <Button icon={CreditCard} onClick={resume} loading={pending}>Continue to payment</Button>}
            {IN_FLIGHT.has(b.status) && <Button variant="secondary" icon={RefreshCw} onClick={requery} loading={pending}>Check status</Button>}
            <Link className="btn btn-ghost" to={`/app/support?new=1&category=bill_payment_issue&reference=${encodeURIComponent(b.reference)}`}>
              <LifeBuoy size={16} aria-hidden /> Report a problem
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
