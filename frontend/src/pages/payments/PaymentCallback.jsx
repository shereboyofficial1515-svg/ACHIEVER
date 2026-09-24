import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Button } from '../../components/ui/index.js';
import { api } from '../../services/api.js';
import { naira } from '../../utils/format.js';
import { useStatusMotion } from '../../hooks/useMotion.js';

const MAX_POLLS = 20;

function destination(p) {
  if (!p) return '/app';
  if (p.purpose === 'bill_payment') return `/app/bills/${p.targetId}`;
  if (p.purpose === 'collector_savings') return `/app/collector/plans/${p.targetId}`;
  return '/app';
}

/**
 * Paystack redirects here after checkout. The page NEVER decides that a
 * payment succeeded: it asks the API, which verifies with Paystack.
 */
export default function PaymentCallback() {
  const [params] = useSearchParams();
  const reference = params.get('reference') || params.get('trxref');
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState(null);
  const polls = useRef(0);
  // Gentle emphasis when the provider confirms the final status (skipped with reduced motion).
  const iconRef = useStatusMotion(payment?.status && payment.status !== 'initialized' ? payment.status : null);

  useEffect(() => {
    if (!reference) return undefined;
    let timer;
    let cancelled = false;
    const check = async () => {
      try {
        const { data } = await api.get(`/payments/status/${encodeURIComponent(reference)}`);
        if (cancelled) return;
        setPayment(data);
        polls.current += 1;
        if (data.status === 'initialized' && polls.current < MAX_POLLS) timer = setTimeout(check, Math.min(2000 + polls.current * 500, 6000));
      } catch (err) {
        if (!cancelled) setError(err);
      }
    };
    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reference]);

  if (!reference) {
    return (
      <div className="payment-status">
        <p>No payment reference was provided.</p>
        <Button to="/app">Back to dashboard</Button>
      </div>
    );
  }

  const status = error ? 'error' : payment?.status || 'initialized';
  const ok = status === 'success';
  const bad = ['failed', 'abandoned', 'error'].includes(status);
  const review = ['amount_mismatch', 'duplicate'].includes(status);
  const stillWaiting = status === 'initialized' && polls.current >= MAX_POLLS;

  return (
    <div className="payment-status stack" role="status" aria-live="polite">
      <div ref={iconRef} className={`big-icon ${ok ? 'ok' : bad ? 'bad' : 'wait'}`}>
        {ok ? <CheckCircle2 size={36} /> : bad ? <XCircle size={36} /> : status === 'initialized' && !stillWaiting ? <span className="spinner lg" /> : <Clock size={36} />}
      </div>
      <h1>
        {ok && 'Payment successful'}
        {bad && (error ? 'We could not check this payment' : 'Payment failed. Please try again.')}
        {review && 'Payment received — refund due'}
        {status === 'initialized' && (stillWaiting ? 'Payment is still processing' : 'Processing payment...')}
      </h1>
      {payment && <p className="money" style={{ fontSize: 22 }}>{naira(payment.amount)}</p>}
      <p className="muted">
        {ok && 'Your payment was verified with the payment provider and recorded in your ledger.'}
        {status === 'failed' && 'No money was recorded. If you were debited, the provider will reverse it automatically.'}
        {status === 'abandoned' && 'The checkout was not completed.'}
        {review && payment?.message}
        {stillWaiting && 'Bank transfers can take a few minutes to confirm. You will get a notification as soon as it is confirmed — you can safely leave this page.'}
        {status === 'initialized' && !stillWaiting && 'Please keep this page open while we confirm your payment with the provider.'}
        {error && error.message}
      </p>
      <p className="xsmall mono muted">Reference: {reference}</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Button to={destination(payment)}>Continue</Button>
        {!ok && (
          <Button to="/app/support" variant="secondary">
            Report a problem
          </Button>
        )}
      </div>
    </div>
  );
}
