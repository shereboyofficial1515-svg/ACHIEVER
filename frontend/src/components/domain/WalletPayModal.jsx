import { Link } from 'react-router-dom';
import { Alert, KeyValue, Modal } from '../ui/index.js';
import TransactionApproval from './TransactionApproval.jsx';
import FeeBreakdown from './FeeBreakdown.jsx';
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
  const preview = useAsync(() => (open && payment ? api.post('/wallet/payments/preview', payment) : Promise.resolve({ data: null })), [open, payment?.contributionId, payment?.planId]);
  const w = wallet.data;
  const total = preview.data?.total ?? null;
  const enough = w && total != null && w.status === 'active' && w.available >= total;
  return (
    <Modal open={open} onClose={onClose} title="Pay from ACHIEVER Wallet">
      <div className="stack">
        <KeyValue items={[['Recipient', recipient], ['Purpose', title], ['Paid with', 'ACHIEVER Wallet'], w && ['Available balance', naira(w.available)]].filter(Boolean)} />
        <FeeBreakdown amount={amount} fee={preview.data?.fee} total={total} loading={preview.loading} />
        {w && total != null && !enough && (
          <Alert tone="warning">
            {w.status !== 'active' ? 'Your wallet cannot make payments right now.' : 'Insufficient balance for this payment and its fee.'}{' '}
            <Link to="/app/wallet/add">Add money</Link>
          </Alert>
        )}
        {open && enough && (
          <TransactionApproval
            amount={total}
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
