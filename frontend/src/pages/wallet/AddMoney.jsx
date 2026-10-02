import { useMemo, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { Alert, Button, Card, PageHeader } from '../../components/ui/index.js';
import SecureKeypad from '../../components/ui/SecureKeypad.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { api, newIdempotencyKey } from '../../services/api.js';
import { naira } from '../../utils/format.js';
import { amountToKobo } from './walletShared.js';

const QUICK = [100_000, 200_000, 500_000, 1_000_000];

/** Add money: amount (secure keypad) -> Paystack checkout -> credited only after the server verifies the payment. */
export default function AddMoney() {
  const summary = useAsync(() => api.get('/wallet'), []);
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [run, pending] = useSingleFlight();
  const kobo = amountToKobo(value);
  const key = useMemo(() => newIdempotencyKey(), [kobo]);
  const limits = summary.data?.limits;
  const tooLow = limits && kobo > 0 && kobo < limits.topupMin;
  const tooHigh = limits && kobo > limits.topupMax;

  const start = () => run(async () => {
    setError(null);
    try {
      const { data } = await api.post('/wallet/topups', { amount: kobo }, { idempotencyKey: key });
      if (data.authorizationUrl) window.location.assign(data.authorizationUrl);
      await new Promise((r) => setTimeout(r, 15000));   // stay busy while leaving for Paystack
    } catch (err) {
      setError(err);
    }
  });

  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/wallet', label: 'Wallet' }} title="Add money" subtitle="Fund your ACHIEVER Wallet securely with Paystack" />
      <Card>
        <div className="stack">
          {error && <Alert tone="danger">{error.message}</Alert>}
          <SecureKeypad id="topup-amount" type="amount" label="How much do you want to add?" value={value} onChange={setValue} disabled={pending} />
          <div className="wallet-chips" role="group" aria-label="Quick amounts" style={{ justifyContent: 'center' }}>
            {QUICK.map((k) => (
              <button key={k} type="button" className="wallet-chip" aria-pressed={kobo === k} onClick={() => setValue(String(k / 100))} disabled={pending}>{naira(k).replace('.00', '')}</button>
            ))}
          </div>
          {tooLow && <p className="xsmall text-red" role="alert">The minimum top-up is {naira(limits.topupMin)}.</p>}
          {tooHigh && <p className="xsmall text-red" role="alert">The maximum single top-up is {naira(limits.topupMax)}.</p>}
          <Button icon={CreditCard} onClick={start} loading={pending} loadingText="Opening secure payment…" disabled={!kobo || tooLow || tooHigh} block>
            {kobo ? `Add ${naira(kobo)} with Paystack` : 'Enter an amount'}
          </Button>
          <p className="xsmall muted">
            You pay on Paystack’s secure page (card, bank transfer or USSD). Your wallet is credited only after ACHIEVER confirms the payment with Paystack. ACHIEVER Wallet is not a bank account.
          </p>
        </div>
      </Card>
    </div>
  );
}
