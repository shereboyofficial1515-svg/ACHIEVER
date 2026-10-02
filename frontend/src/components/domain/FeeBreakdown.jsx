import { naira } from '../../utils/format.js';

/**
 * Amount / fee / total (and what the recipient receives when the fee is
 * included). Values always come from the server's fee engine.
 */
export default function FeeBreakdown({ amount, fee, total, recipientAmount, mode, amountLabel = 'Amount', recipientLabel = 'Recipient receives', loading }) {
  if (amount == null) return null;
  return (
    <div className="fee-breakdown" aria-live="polite" aria-busy={loading || undefined}>
      <div><span>{amountLabel}</span><span className="money">{naira(amount)}</span></div>
      <div><span>ACHIEVER fee</span><span className="money">{fee == null ? '…' : fee ? naira(fee) : '₦0.00 (no fee)'}</span></div>
      {mode === 'FEE_INCLUDED' && recipientAmount != null && (
        <div><span>{recipientLabel}</span><span className="money">{naira(recipientAmount)}</span></div>
      )}
      <div className="total"><span>Total debit</span><span className="money">{total == null ? '…' : naira(total)}</span></div>
    </div>
  );
}
