import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Gift, Landmark, Receipt, RotateCcw, SlidersHorizontal, Users, Wallet } from 'lucide-react';
import { api } from '../../services/api.js';

export const TX_FILTERS = [
  { value: '', label: 'All' },
  { value: 'topup', label: 'Top-ups' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'bills', label: 'Bills' },
  { value: 'osusu', label: 'OSUSU & savings' },
  { value: 'refunds', label: 'Refunds' },
  { value: 'rewards', label: 'Rewards' },
  { value: 'adjustments', label: 'Adjustments' },
];

export const TX_ICON = {
  topup: Wallet, transfer: ArrowUpRight, bank_transfer: Landmark, bill_payment: Receipt, osusu_contribution: Users, collector_savings: Users,
  refund: RotateCcw, reversal: RotateCcw, referral_reward: Gift, adjustment: SlidersHorizontal, fee: SlidersHorizontal,
};
export const iconFor = (t) => (t.type === 'transfer' && t.direction === 'credit' ? ArrowDownLeft : TX_ICON[t.type] || Wallet);

export const STATUS_LABEL = { success: 'Successful', pending: 'Pending', failed: 'Failed', reversed: 'Reversed' };

export const BANK_STATUS = {
  INITIATED: { label: 'Awaiting approval', tone: 'neutral' },
  PENDING: { label: 'Processing', tone: 'info' },
  PROCESSING: { label: 'Processing', tone: 'info' },
  SUCCESS: { label: 'Successful', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  REVERSED: { label: 'Reversed', tone: 'warning' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

const HIDE_KEY = 'achiever.wallet.hideBalance';
export function balanceHidden() {
  try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
}
export function setBalanceHidden(hidden) {
  try { localStorage.setItem(HIDE_KEY, hidden ? '1' : '0'); } catch { /* storage unavailable */ }
}

/** Typed naira string from the keypad ("1500.5") -> kobo (150050). */
export function amountToKobo(value) {
  if (!value) return 0;
  const [w, d = ''] = value.split('.');
  return Number(w || 0) * 100 + Number((d + '00').slice(0, 2));
}

/**
 * Live fee preview from the server's fee engine (debounced). The server repeats
 * the calculation when the transaction is created; this is only what the member
 * sees while typing.
 */
export function useFeeQuote(service, amount) {
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!amount || amount <= 0) { setQuote(null); setError(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      api.get('/wallet/fees/quote', { service, amount })
        .then(({ data }) => { if (live) { setQuote(data); setError(null); } })
        .catch((err) => { if (live) { setQuote(null); setError(err); } });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [service, amount]);
  return { quote, error };
}
