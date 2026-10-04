import { Link } from 'react-router-dom';
import { BadgeCheck, ChevronRight, Eye, EyeOff, ShieldAlert, Wallet } from 'lucide-react';
import { useState } from 'react';
import { GroupAvatar } from '../ui/index.js';
import { naira, titleCase } from '../../utils/format.js';

/**
 * Shared building blocks for My Profile, a member's profile, Group info and Group settings,
 * so these screens look like one application (same cards, rows, spacing and tokens).
 */

/** A titled section card with an optional action (e.g. "See all"). */
export function ProfileSection({ title, action, children, className = '' }) {
  return (
    <section className={`profile-section ${className}`}>
      {(title || action) && (
        <div className="profile-section-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      <div className="profile-section-body">{children}</div>
    </section>
  );
}

/** A full-width row: icon, title, optional description/detail, chevron. A link or a button. */
export function ProfileListItem({ to, onClick, icon: Icon, title, description, detail, danger, as, external }) {
  const inner = (
    <>
      {Icon && <span className={`list-row-icon${danger ? ' danger' : ''}`}><Icon size={19} aria-hidden /></span>}
      <span className="list-row-text">
        <span className="list-row-title">{title}</span>
        {description && <span className="list-row-desc">{description}</span>}
      </span>
      {detail && <span className="list-row-detail">{detail}</span>}
      {!danger && <ChevronRight size={18} className="list-row-chevron" aria-hidden />}
    </>
  );
  const cls = `list-row${danger ? ' danger' : ''}`;
  if (as === 'button' || (!to && onClick)) return <button type="button" className={cls} onClick={onClick}>{inner}</button>;
  if (external) return <a className={cls} href={to}>{inner}</a>;
  return <Link className={cls} to={to} onClick={onClick}>{inner}</Link>;
}

/** Green check shown next to a verified name. Only rendered when the server says so. */
export function VerifiedBadge({ verified, size = 20 }) {
  if (!verified) return null;
  return <BadgeCheck size={size} className="verified-badge" aria-label="Verified account" role="img" />;
}

/** A row of statistics (values come from the server). */
export function StatGrid({ items }) {
  return (
    <dl className="stat-grid">
      {items.map((s) => (
        <div key={s.label} className="stat-grid-item">
          <dd>{s.value ?? '—'}</dd>
          <dt>{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/**
 * The wallet card. The balance comes from GET /wallet each time (never cached) and is hidden
 * until the owner taps the eye (people often open their profile in public).
 */
export function WalletSummaryCard({ wallet, loading, error }) {
  const [shown, setShown] = useState(false);
  const available = wallet?.available ?? wallet?.balance;
  return (
    <section className="wallet-summary" aria-label="ACHIEVER Wallet">
      <div className="wallet-summary-top">
        <span className="wallet-summary-label"><Wallet size={16} aria-hidden /> ACHIEVER Wallet</span>
        <button type="button" className="wallet-summary-eye" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Hide balance' : 'Show balance'} aria-pressed={shown}>
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      <span className="wallet-summary-caption">Available balance</span>
      <strong className="wallet-summary-amount" aria-live="polite">
        {loading && !wallet ? 'Loading…' : error && !wallet ? 'Unavailable' : shown ? naira(available || 0) : '₦ ••••••'}
      </strong>
      <Link to="/app/wallet" className="wallet-summary-link">View wallet <ChevronRight size={16} aria-hidden /></Link>
    </section>
  );
}

/** One OSUSU group in a list (avatar always contained and circular). */
export function GroupListItem({ group }) {
  const tone = { active: 'success', recruiting: 'info', completed: 'neutral', cancelled: 'danger' }[group.status] || 'neutral';
  return (
    <Link to={`/app/osusu/${group.id}`} className="list-row group-row">
      <GroupAvatar name={group.name} src={group.imageUrl} size="medium" />
      <span className="list-row-text">
        <span className="list-row-title">{group.name}</span>
        <span className="list-row-desc">{naira(group.contributionAmount)} · {titleCase(group.frequency || '')}</span>
      </span>
      <span className={`badge badge-${tone}`}>{titleCase(group.status || '')}</span>
      <ChevronRight size={18} className="list-row-chevron" aria-hidden />
    </Link>
  );
}

/** "Account verified" / "Verification needed" — derived only from the server's verification state. */
export function VerificationCard({ verification, status }) {
  const checks = [['email', 'Email'], ['phone', 'Phone'], ['identity', 'Identity'], ['paymentAccount', 'Payout account']];
  const done = checks.filter(([k]) => verification?.[k]);
  const full = done.length === checks.length && status === 'active';
  return (
    <section className={`verify-card${full ? ' is-verified' : ''}`}>
      {full ? <BadgeCheck size={28} aria-hidden /> : <ShieldAlert size={28} aria-hidden />}
      <div className="grow" style={{ minWidth: 0 }}>
        <strong>{full ? 'Account verified' : `Verification ${done.length} of ${checks.length}`}</strong>
        <p>{full ? 'Your account is fully verified and active.' : `Still needed: ${checks.filter(([k]) => !verification?.[k]).map(([, l]) => l).join(', ') || 'account review'}.`}</p>
      </div>
      {!full && <Link to="/app/onboarding" className="btn btn-secondary btn-sm">Continue</Link>}
    </section>
  );
}
