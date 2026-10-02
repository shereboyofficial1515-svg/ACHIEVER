import { Link } from 'react-router-dom';
import { ChevronRight, Landmark, Wallet } from 'lucide-react';
import { Alert, PageHeader } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';

/** Transfer Money: clearly separate ACHIEVER-to-ACHIEVER from ACHIEVER-to-bank. */
export default function TransferChooser() {
  const w = useAsync(() => api.get('/wallet'), []).data;
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/wallet', label: 'Wallet' }} title="Transfer money" subtitle="Choose where the money is going" />
      <div className="transfer-choice">
        {(!w || w.transfersEnabled) && (
          <Link to="/app/wallet/send" className="transfer-option">
            <span className="transfer-option-icon"><Wallet size={22} aria-hidden /></span>
            <span className="grow">
              <strong>ACHIEVER User</strong>
              <span className="xsmall muted" style={{ display: 'block' }}>Internal transfer · ACHIEVER Wallet → ACHIEVER Wallet, using their wallet account number</span>
            </span>
            <ChevronRight size={20} aria-hidden />
          </Link>
        )}
        {(!w || w.bankTransfersEnabled) && (
          <Link to="/app/wallet/bank" className="transfer-option">
            <span className="transfer-option-icon is-bank"><Landmark size={22} aria-hidden /></span>
            <span className="grow">
              <strong>Bank Account</strong>
              <span className="xsmall muted" style={{ display: 'block' }}>External transfer · ACHIEVER Wallet → any Nigerian bank account</span>
            </span>
            <ChevronRight size={20} aria-hidden />
          </Link>
        )}
      </div>
      {w && !w.transfersEnabled && !w.bankTransfersEnabled && <Alert tone="info">Transfers are temporarily unavailable. Your balance is safe.</Alert>}
      <p className="xsmall muted">Any fee is shown before you confirm. Nothing is sent until you approve with your PIN, fingerprint or the code we email you.</p>
    </div>
  );
}
