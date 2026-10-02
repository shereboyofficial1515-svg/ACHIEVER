import { naira } from './format.js';

export function describeFee(c) {
  if (!c) return 'No fee configured';
  if (!c.enabled) return 'No fee (disabled)';
  if (c.feeType === 'FIXED') return naira(c.fixedAmount);
  if (c.feeType === 'PERCENTAGE') return `${c.percentage}%`;
  if (c.feeType === 'FIXED_PLUS_PERCENTAGE') return `${naira(c.fixedAmount)} + ${c.percentage}%`;
  return `${c.tiers.length} tier${c.tiers.length === 1 ? '' : 's'}`;
}

/**
 * Illustration only, for the administrator while editing. Members are always
 * charged by the server's fee engine (fee_quote), never by this function.
 */
export function exampleFee(f, amount) {
  if (!amount) return null;
  if (!f.enabled) return { fee: 0, total: amount, receives: amount };
  let fee;
  if (f.feeType === 'FIXED') fee = f.fixedAmount;
  else if (f.feeType === 'PERCENTAGE') fee = Math.round((amount * f.percentage) / 100);
  else if (f.feeType === 'FIXED_PLUS_PERCENTAGE') fee = f.fixedAmount + Math.round((amount * f.percentage) / 100);
  else {
    const tier = [...f.tiers].sort((a, b) => b.min - a.min).find((t) => amount >= t.min && (t.max == null || amount <= t.max));
    if (!tier) return { error: 'No tier covers this amount' };
    fee = (tier.fixed || 0) + Math.round((amount * (tier.percentage || 0)) / 100);
  }
  if (f.minimumFee != null && fee < f.minimumFee) fee = f.minimumFee;
  if (f.maximumFee != null && fee > f.maximumFee) fee = f.maximumFee;
  return f.feeBearingMode === 'FEE_INCLUDED' ? { fee, total: amount, receives: amount - fee } : { fee, total: amount + fee, receives: amount };
}
