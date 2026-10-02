import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock, ShieldCheck, UserCheck } from 'lucide-react';
import { Alert, Button, Card, Input, KeyValue, PageHeader } from '../../components/ui/index.js';
import SecureKeypad from '../../components/ui/SecureKeypad.jsx';
import TransactionApproval from '../../components/domain/TransactionApproval.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { api, newIdempotencyKey } from '../../services/api.js';
import { naira } from '../../utils/format.js';
import { amountToKobo } from './walletShared.js';

/**
 * Send to another ACHIEVER Wallet:
 *   recipient (verified: masked name + masked wallet ID) -> amount -> review
 *   -> approve (PIN / PIN + emailed code / biometric) -> server moves the money -> receipt.
 */
export default function SendMoney() {
  const navigate = useNavigate();
  const summary = useAsync(() => api.get('/wallet'), []);
  const [step, setStep] = useState('recipient');
  const [walletId, setWalletId] = useState('');
  const [recipient, setRecipient] = useState(null);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [review, setReview] = useState(null);
  const [approving, setApproving] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [run, pending] = useSingleFlight();
  const kobo = amountToKobo(value);
  const key = useMemo(() => newIdempotencyKey(), [walletId, kobo, note]);
  const w = summary.data;

  const verify = (e) => {
    e?.preventDefault();
    return run(async () => {
      setError(null);
      try {
        const { data } = await api.post('/wallet/recipients/resolve', { walletId: walletId.trim() });
        setRecipient(data);
        setStep('amount');
      } catch (err) {
        setError(err);
      }
    });
  };

  const toReview = () => run(async () => {
    setError(null);
    try {
      const { data } = await api.post('/wallet/transfers', { walletId: walletId.trim(), amount: kobo, note: note.trim() || null }, { idempotencyKey: key });
      setReview(data);
      setStep('review');
    } catch (err) {
      setError(err);
    }
  });

  const cancel = () => {
    if (review?.transferId) api.post(`/wallet/transfers/${review.transferId}/cancel`).catch(() => {});
    setReview(null);
    setApproving(false);
    setStep('amount');
  };

  if (done) {
    const held = done.status === 'PENDING_REVIEW';
    return (
      <div className="stack-lg">
        <PageHeader title={held ? 'Transfer under review' : 'Transfer successful'} />
        <Card>
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            {held ? <Clock size={48} className="text-sky" aria-hidden /> : <CheckCircle2 size={48} className="text-green" aria-hidden />}
            <p className="wallet-balance" style={{ fontSize: '1.75rem' }}>{naira(done.amount)}</p>
            <p className="muted">{held ? done.message : `Sent to ${recipient?.name} (${recipient?.walletId})`}</p>
            <KeyValue items={[['Reference', <span key="r" className="mono">{done.reference}</span>], ['Fee', done.fee ? naira(done.fee) : '₦0.00']]} />
            {done.transactionId && <Button to={`/app/wallet/transactions/${done.transactionId}`} variant="secondary" block>View receipt</Button>}
            <Button onClick={() => navigate('/app/wallet')} block>Back to wallet</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/wallet', label: 'Wallet' }} title="Send money" subtitle="To another ACHIEVER Wallet" />
      {error && <Alert tone="danger">{error.message}</Alert>}

      {step === 'recipient' && (
        <Card>
          <form className="stack" onSubmit={verify} noValidate>
            <Input
              label="Recipient’s wallet ID"
              placeholder="ACHW-XXXXXXXX"
              value={walletId}
              onChange={(e) => { setWalletId(e.target.value.toUpperCase()); setRecipient(null); }}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              hint="Ask the person for the wallet ID shown on their ACHIEVER Wallet page."
            />
            <Button type="submit" icon={UserCheck} loading={pending} disabled={walletId.trim().length < 8} block>Verify recipient</Button>
          </form>
        </Card>
      )}

      {step === 'amount' && recipient && (
        <Card>
          <div className="stack">
            <div className="wallet-recipient">
              <UserCheck size={22} className="text-green" aria-hidden />
              <div className="grow">
                <strong>{recipient.name}</strong>
                <p className="xsmall muted" style={{ margin: 0 }}>{recipient.walletId} · verified ACHIEVER Wallet</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setStep('recipient'); setRecipient(null); }}>Change</Button>
            </div>
            <SecureKeypad id="send-amount" type="amount" label="Amount to send" value={value} onChange={setValue} disabled={pending} />
            {w && <p className="xsmall muted" style={{ textAlign: 'center', margin: 0 }}>Available: {naira(w.available)} · Daily limit left: {naira(w.limits.transferDailyRemaining)}</p>}
            {w && kobo > w.available && <p className="xsmall text-red" role="alert" style={{ textAlign: 'center' }}>This is more than your available balance.</p>}
            <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value.slice(0, 120))} maxLength={120} placeholder="What is it for?" />
            <Button onClick={toReview} loading={pending} disabled={!kobo || (w && kobo > w.available)} block>Review transfer</Button>
          </div>
        </Card>
      )}

      {step === 'review' && review && (
        <Card className="review-card">
          <div className="stack">
            <KeyValue
              items={[
                ['To', <span key="to"><strong>{review.recipient?.name}</strong><br /><span className="xsmall muted mono">{review.recipient?.walletId}</span></span>],
                ['Amount', naira(review.amount)],
                ['Fee', review.fee ? naira(review.fee) : '₦0.00 (no fee)'],
                ['Total', <strong key="t" className="money">{naira(review.total)}</strong>],
                review.note && ['Note', review.note],
                ['From', 'Your ACHIEVER Wallet'],
              ].filter(Boolean)}
            />
            {review.newRecipient && <Alert tone="info" icon={ShieldCheck}>First transfer to this wallet. Check the name before you approve: transfers between wallets cannot be cancelled once sent.</Alert>}
            {!approving ? (
              <div className="row-wrap">
                <Button onClick={() => setApproving(true)}>Confirm transfer</Button>
                <Button variant="secondary" onClick={cancel}>Edit</Button>
              </div>
            ) : (
              <TransactionApproval
                amount={review.total}
                title="Wallet transfer"
                subtitle={`To ${review.recipient?.name} · ${review.recipient?.walletId}`}
                authorizeUrl={`/wallet/transfers/${review.transferId}/authorize`}
                confirmUrl={`/wallet/transfers/${review.transferId}/confirm`}
                options={review.approval}
                confirmLabel="Sending"
                footnote="The money moves only after ACHIEVER verifies your approval. Large transfers may be held briefly for review."
                onCancel={cancel}
                onApproved={(data) => { setDone(data); summary.reload(); }}
              />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
