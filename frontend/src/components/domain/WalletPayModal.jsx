import { Link } from 'react-router-dom';
import { Alert, KeyValue, Modal } from '../ui/index.js';
import TransactionApproval from './TransactionApproval.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { naira } from '../../utils/format.js';

/**
 * Pay an OSUSU contribution (or a collector savings deposit) from the
 * ACHIEVER Wallet: review -> approve -> the server debits the wallet and
 * records the contribution exactly like a card payment.
 *   payment: { kind: 'osusu', contributionId } | { kind: 'collector', planId, amount }
 */
export default function WalletPayModal({ open, payment, amount, title, recipient, onClose, onPaid }) {
  const wallet = useAsync(() => (open ? api.get('/wallet') : Promise.resolve({ data: null })), [open]);
  const w = wallet.data;
  const enough = w && w.status === 'active' && w.available >= amount;
  return (
    <Modal open={open} onClose={onClose} title="Pay from ACHIEVER Wallet">
      <div className="stack">
        <KeyValue items={[['Recipient', recipient], ['Purpose', title], ['Amount', naira(amount)], ['Fee', '₦0.00 (no fee)'], ['Paid with', 'ACHIEVER Wallet'], w && ['Available balance', naira(w.available)]].filter(Boolean)} />
        {w && !enough && (
          <Alert tone="warning">
            {w.status !== 'active' ? 'Your wallet cannot make payments right now.' : 'Your wallet balance is not enough for this payment.'}{' '}
            <Link to="/app/wallet/add">Add money</Link>
          </Alert>
        )}
        {open && enough && (
          <TransactionApproval
            amount={amount}
            title={title}
            subtitle={recipient}
            authorizeUrl="/wallet/payments/authorize"
            confirmUrl="/wallet/payments/confirm"
            extra={payment}
            confirmExtra={payment}
            confirmLabel="Paying"
            footnote="Your wallet is debited only after ACHIEVER verifies your approval."
            onCancel={onClose}
            onApproved={onPaid}
          />
        )}
      </div>
    </Modal>
  );
}
