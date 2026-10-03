import { useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { UserAvatar } from '../ui/index.js';

/**
 * The other person in an INTERNAL ACHIEVER transfer: profile photo (or
 * initials), full display name — never masked — and wallet account number.
 */
export default function RecipientCard({ party, label, action, size = 52 }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  if (!party) return null;
  const name = party.displayName || party.name;
  const photo = party.avatarUrl && !photoFailed ? party.avatarUrl : undefined;
  return (
    <div className="recipient-card">
      {photo && <img src={photo} alt="" hidden onError={() => setPhotoFailed(true)} />}{/* falls back to initials if the photo cannot load */}
      <UserAvatar name={name} src={photo} size={size} />
      <div className="recipient-card-main">
        {label && <span className="xsmall muted">{label}</span>}
        <strong className="recipient-card-name">{name}</strong>
        {party.walletId && (
          <>
            <span className="xsmall muted">ACHIEVER Wallet ID</span>
            <span className="mono recipient-card-wallet">{party.walletId}</span>
          </>
        )}
        <span className="recipient-card-verified"><BadgeCheck size={14} aria-hidden /> Verified ACHIEVER Wallet</span>
      </div>
      {action}
    </div>
  );
}
