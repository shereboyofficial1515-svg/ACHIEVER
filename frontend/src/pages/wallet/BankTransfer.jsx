import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, Clock, Landmark } from 'lucide-react';
import { Alert, BankSelect, Button, Card, Checkbox, Input, KeyValue, Modal, PageHeader } from '../../components/ui/index.js';
import SecureKeypad from '../../components/ui/SecureKeypad.jsx';
import TransactionApproval from '../../components/domain/TransactionApproval.jsx';
import FeeBreakdown from '../../components/domain/FeeBreakdown.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { api, newIdempotencyKey } from '../../services/api.js';
import { naira } from '../../utils/format.js';
import { amountToKobo, useFeeQuote } from './walletShared.js';

/**
 * Shown once when the external bank transfer flow opens (before any details are entered),
 * so nobody is surprised — or sends the money twice — if the bank takes a while.
 * Closing it (Escape / back) leaves the flow; only "I understand, continue" goes on.
 */
export function ProcessingTimeNotice({ onContinue, onLeave }) {
  return (
    <Modal
      open
      title="Bank transfer processing time"
      onClose={onLeave}
      describedBy="bank-time-notice"
      footer={(
        <div className="row-wrap modal-actions-stack">
          <Button onClick={onContinue} block>I understand, continue</Button>
          <Button variant="secondary" onClick={onLeave} block>Go back</Button>
        </div>
      )}
    >
      <div id="bank-time-notice" className="stack-sm">
        <p className="notice-lead"><Clock size={18} aria-hidden /> Your transfer to a bank account may not arrive instantly.</p>
        <p className="small">External bank transfers are processed through our payment provider and the banking network. Most arrive quickly, but it can sometimes take up to 1 hour for the money to reach the recipient’s account.</p>
        <p className="small">If it hasn’t arrived yet, please don’t send it again. You can follow the status in your transaction history.</p>
      </div>
    </Modal>
  );
}

/**
 * ACHIEVER Wallet → Nigerian bank account.
 * Bank → account number → verified with the bank → amount (fee shown) → review
 * → approve → submitted → the final status comes from the bank via Paystack.
 */
export default function BankTransfer() {
  const navigate = useNavigate();
  const wallet = useAsync(() => api.get('/wallet'), []);
  const banks = useAsync(() => api.get('/payments/banks'), []);
  const [step, setStep] = useState('account');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [account, setAccount] = useState(null);
  const [value, setValue] = useState('');
  const [narration, setNarration] = useState('');
  const [review, setReview] = useState(null);
  const [approving, setApproving] = useState(false);
  const [noticeSeen, setNoticeSeen] = useState(false);          // once per visit to this flow
  const [sendAnyway, setSendAnyway] = useState(false);
  const [error, setError] = useState(null);
  const [run, pending] = useSingleFlight();
  const kobo = amountToKobo(value);
  const { quote, error: quoteError } = useFeeQuote('bank_transfer', step === 'amount' ? kobo : 0);
  const key = useMemo(() => newIdempotencyKey(), [bankCode, accountNumber, kobo, narration]);
  const w = wallet.data;

  const verify = (e) => {
    e?.preventDefault();
    return run(async () => {
      setError(null);
      try {
        const { data } = await api.post('/wallet/bank/resolve', { bankCode, accountNumber });
        setAccount(data);
        setStep('amount');
      } catch (err) {
        setError(err);
      }
    });
  };

  const toReview = () => run(async () => {
    setError(null);
    try {
      const { data } = await api.post('/wallet/bank-transfers', { bankCode, accountNumber, amount: kobo, narration: narration.trim() || null }, { idempotencyKey: key });
      setReview(data);
      setSendAnyway(false);
      setStep('review');
    } catch (err) {
      setError(err);
    }
  });

  const cancel = () => {
    if (review?.id) api.post(`/wallet/bank-transfers/${review.id}/cancel`).catch(() => {});
    setReview(null);
    setApproving(false);
    setStep('amount');
  };

  const short = quote && w && quote.totalDebit > w.available;
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/wallet/transfer', label: 'Transfer money' }} title="Send to bank account" subtitle="External transfer · ACHIEVER Wallet → Nigerian bank" />
      {!noticeSeen && <ProcessingTimeNotice onContinue={() => setNoticeSeen(true)} onLeave={() => navigate('/app/wallet/transfer', { replace: true })} />}
      {error && <Alert tone="danger">{error.message}</Alert>}

      {step === 'account' && (
        <Card>
          <form className="stack" onSubmit={verify} noValidate>
            <BankSelect
              banks={banks.data || []}
              loading={banks.loading}
              value={bankCode}
              onChange={(code) => { setBankCode(code); setAccount(null); }}
              error={banks.error ? 'Could not load banks. Please try again.' : undefined}
            />
            <Input
              label="Account number"
              inputMode="numeric"
              autoComplete="off"
              maxLength={10}
              value={accountNumber}
              onChange={(e) => { setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10)); setAccount(null); }}
              hint="10-digit NUBAN account number"
            />
            <Button type="submit" icon={BadgeCheck} loading={pending} loadingText="Checking with the bank…" disabled={!bankCode || accountNumber.length !== 10} block>
              Verify account
            </Button>
          </form>
        </Card>
      )}

      {step === 'amount' && account && (
        <Card>
          <div className="stack">
            <div className="wallet-recipient">
              <Landmark size={22} className="text-green" aria-hidden />
              <div className="grow">
                <strong>{account.accountName}</strong>
                <p className="xsmall muted" style={{ margin: 0 }}>{account.bankName} · {account.accountNumber} · verified with the bank</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setStep('account'); setAccount(null); }}>Change</Button>
            </div>
            <SecureKeypad id="bank-amount" type="amount" label="Amount to send" value={value} onChange={setValue} disabled={pending} />
            {w && <p className="xsmall muted" style={{ textAlign: 'center', margin: 0 }}>Available: {naira(w.available)}</p>}
            {kobo > 0 && <FeeBreakdown amount={kobo} fee={quote?.fee} total={quote?.totalDebit} recipientAmount={quote?.recipientAmount} mode={quote?.feeBearingMode} loading={!quote} />}
            {quoteError && <p className="xsmall text-red" role="alert">{quoteError.message}</p>}
            {short && <p className="xsmall text-red" role="alert">Insufficient balance. You need {naira(quote.totalDebit)} including the fee.</p>}
            <Input label="Description (optional)" value={narration} onChange={(e) => setNarration(e.target.value.slice(0, 100))} maxLength={100} placeholder="What is it for?" />
            <Button onClick={toReview} loading={pending} disabled={!kobo || !quote || short} block>Review transfer</Button>
          </div>
        </Card>
      )}

      {step === 'review' && review && (
        <Card className="review-card">
          <div className="stack">
            <KeyValue
              items={[
                ['Transfer type', 'Bank transfer (external)'],
                ['Recipient', <strong key="n">{review.accountName}</strong>],
                ['Bank', review.bankName],
                ['Account', <span key="a" className="mono">{review.accountNumber}</span>],
                review.narration && ['Description', review.narration],
                ['From', 'Your ACHIEVER Wallet'],
              ].filter(Boolean)}
            />
            <FeeBreakdown amount={review.amount} fee={review.fee} total={review.totalDebit} recipientAmount={review.recipientAmount} mode={review.feeBearingMode} />
            {review.approval?.newAccount && <Alert tone="info">First transfer to this account. Check the name matches the person you want to pay: bank transfers cannot be recalled once sent.</Alert>}
            {review.possibleDuplicate && (
              <Alert tone="warning">
                <strong style={{ display: 'block' }}>A transfer like this is still processing</strong>
                You sent {naira(review.amount)} to this account recently and it is still being processed. Please don’t send it again unless you mean to pay twice.{' '}
                <a href={`/app/wallet/bank-transfers/${review.possibleDuplicate.id}`} onClick={(e) => { e.preventDefault(); navigate(`/app/wallet/bank-transfers/${review.possibleDuplicate.id}`); }}>View that transfer</a>
                <div style={{ marginTop: 8 }}><Checkbox label="I want to send another, separate transfer" checked={sendAnyway} onChange={(e) => setSendAnyway(e.target.checked)} /></div>
              </Alert>
            )}
            <p className="processing-note"><Clock size={16} aria-hidden /> External bank transfers may take up to 1 hour to reach the recipient. Please avoid sending the transfer again while it is processing.</p>
            {!approving ? (
              <div className="row-wrap">
                <Button onClick={() => setApproving(true)} disabled={Boolean(review.possibleDuplicate) && !sendAnyway}>Confirm transfer</Button>
                <Button variant="secondary" onClick={cancel}>Cancel</Button>
              </div>
            ) : (
              <TransactionApproval
                amount={review.totalDebit}
                title="Bank transfer"
                subtitle={`${review.accountName} · ${review.bankName} ${review.accountNumber}`}
                authorizeUrl={`/wallet/bank-transfers/${review.id}/authorize`}
                confirmUrl={`/wallet/bank-transfers/${review.id}/confirm`}
                options={review.approval}
                confirmLabel="Sending"
                footnote="Your wallet is debited only after ACHIEVER verifies your approval. If the bank rejects the transfer, the full amount and fee return to your wallet."
                onCancel={cancel}
                onApproved={(data) => navigate(`/app/wallet/bank-transfers/${data.id}?submitted=1`, { replace: true })}
              />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
