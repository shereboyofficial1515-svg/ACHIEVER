import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock, ShieldCheck, UserCheck } from 'lucide-react';
import { Alert, Button, Card, Input, KeyValue, PageHeader } from '../../components/ui/index.js';
import SecureKeypad from '../../components/ui/SecureKeypad.jsx';
import TransactionApproval from '../../components/domain/TransactionApproval.jsx';
import FeeBreakdown from '../../components/domain/FeeBreakdown.jsx';
import RecipientCard from '../../components/domain/RecipientCard.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { api, newIdempotencyKey } from '../../services/api.js';
import { naira } from '../../utils/format.js';
import { amountToKobo, useFeeQuote } from './walletShared.js';

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
  const { quote, error: quoteError } = useFeeQuote('wallet_transfer', step === 'amount' ? kobo : 0);
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
            <p className="xsmall muted" style={{ margin: 0 }}>{held ? 'Under review' : 'Money Sent'}</p>
            <p className="wallet-balance" style={{ fontSize: '1.75rem' }}>{naira(done.amount)}</p>
            {held && <p className="muted">{done.message}</p>}
            <div style={{ width: '100%', textAlign: 'left' }}><RecipientCard party={recipient} label="To" /></div>
            <KeyValue items={[['Reference', <span key="r" className="mono">{done.reference}</span>], ['Fee', done.fee ? naira(done.fee) : '₦0.00'], ['Total debit', naira(done.total ?? done.amount + done.fee)]]} />
            {done.transactionId && <Button to={`/app/wallet/transactions/${done.transactionId}`} variant="secondary" block>View receipt</Button>}
            <Button onClick={() => navigate('/app/wallet')} block>Back to wallet</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/wallet/transfer', label: 'Transfer money' }} title="Send to ACHIEVER user" subtitle="Internal transfer · ACHIEVER Wallet → ACHIEVER Wallet" />
      {error && <Alert tone="danger">{error.message}</Alert>}

      {step === 'recipient' && (
        <Card>
          <form className="stack" onSubmit={verify} noValidate>
            <Input
              label="Recipient’s wallet account number"
              placeholder="ACH…"
              value={walletId}
              onChange={(e) => { setWalletId(e.target.value.toUpperCase()); setRecipient(null); }}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              hint="Ask the person for the wallet account number on their ACHIEVER Wallet page (e.g. ACH7K92M4X81P6Q3R5T)."
            />
            <Button type="submit" icon={UserCheck} loading={pending} disabled={walletId.replace(/[\s-]/g, '').length < 12} block>Find recipient</Button>
          </form>
        </Card>
      )}

      {step === 'amount' && recipient && (
        <Card>
          <div className="stack">
            <RecipientCard
              party={recipient}
              action={<Button variant="ghost" size="sm" onClick={() => { setStep('recipient'); setRecipient(null); }}>Change</Button>}
            />
            {recipient.legacyId && <p className="xsmall muted" style={{ margin: 0 }}>You entered an old wallet ID; this is the same wallet’s current number.</p>}
            <SecureKeypad id="send-amount" type="amount" label="Amount to send" value={value} onChange={setValue} disabled={pending} />
            {w && <p className="xsmall muted" style={{ textAlign: 'center', margin: 0 }}>Available: {naira(w.available)} · Daily limit left: {naira(w.limits.transferDailyRemaining)}</p>}
            {kobo > 0 && <FeeBreakdown amount={kobo} fee={quote?.fee} total={quote?.totalDebit} recipientAmount={quote?.recipientAmount} mode={quote?.feeBearingMode} loading={!quote} />}
            {quoteError && <p className="xsmall text-red" role="alert">{quoteError.message}</p>}
            {w && quote && quote.totalDebit > w.available && <p className="xsmall text-red" role="alert" style={{ textAlign: 'center' }}>Insufficient balance. You need {naira(quote.totalDebit)} including the fee.</p>}
            <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value.slice(0, 120))} maxLength={120} placeholder="What is it for?" />
            <Button onClick={toReview} loading={pending} disabled={!kobo || !quote || (w && quote.totalDebit > w.available)} block>Review transfer</Button>
          </div>
        </Card>
      )}

      {step === 'review' && review && (
        <Card className="review-card">
          <div className="stack">
            <p className="flow-title" style={{ margin: 0 }}>Confirm Transfer</p>
            <RecipientCard party={review.recipient} label="To" />
            <KeyValue
              items={[
                ['Transfer type', 'ACHIEVER transfer (internal)'],
                review.note && ['Note', review.note],
                ['From', 'Your ACHIEVER Wallet'],
              ].filter(Boolean)}
            />
            <FeeBreakdown amount={review.amount} fee={review.fee} total={review.total} recipientAmount={review.recipientAmount} mode={review.feeBearingMode} />
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
                subtitle={`To ${review.recipient?.displayName || review.recipient?.name} · ${review.recipient?.walletId}`}
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
