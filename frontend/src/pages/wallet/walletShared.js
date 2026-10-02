import { ArrowDownLeft, ArrowUpRight, Gift, Receipt, RotateCcw, SlidersHorizontal, Users, Wallet } from 'lucide-react';

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
  topup: Wallet, transfer: ArrowUpRight, bill_payment: Receipt, osusu_contribution: Users, collector_savings: Users,
  refund: RotateCcw, reversal: RotateCcw, referral_reward: Gift, adjustment: SlidersHorizontal, fee: SlidersHorizontal,
};
export const iconFor = (t) => (t.type === 'transfer' && t.direction === 'credit' ? ArrowDownLeft : TX_ICON[t.type] || Wallet);

export const STATUS_LABEL = { success: 'Successful', pending: 'Pending', failed: 'Failed', reversed: 'Reversed' };

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
