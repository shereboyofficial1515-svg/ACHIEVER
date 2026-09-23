import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { Button } from './Button.jsx';

export function Loader({ label = 'Loading...' }) {
  return (
    <div className="loader" role="status">
      <span className="spinner lg" aria-hidden />
      <p>{label}</p>
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%', style }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden />;
}

export function SkeletonCards({ count = 3 }) {
  return (
    <div className="grid-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card card-body stack-sm">
          <Skeleton width="40%" height={12} />
          <Skeleton width="70%" height={26} />
          <Skeleton width="55%" height={12} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({ rows = 5 }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="list-item">
          <Skeleton width={38} height={38} style={{ borderRadius: 10, flexShrink: 0 }} />
          <div className="grow stack-sm">
            <Skeleton width="60%" height={12} />
            <Skeleton width="35%" height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, message, action }) {
  return (
    <div className="state">
      <div className="state-icon">
        <Icon size={24} aria-hidden />
      </div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'We could not load this' }) {
  return (
    <div className="state error" role="alert">
      <div className="state-icon">
        <AlertTriangle size={24} aria-hidden />
      </div>
      <h3>{title}</h3>
      <p>{error?.message || 'Please check your connection and try again.'}</p>
      {error?.requestId && <p className="xsmall mono">Reference: {error.requestId}</p>}
      {onRetry && (
        <Button variant="secondary" icon={RefreshCw} onClick={() => onRetry()}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = 'info', icon: Icon, children }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      {Icon && <Icon size={18} aria-hidden />}
      <div>{children}</div>
    </div>
  );
}

/** Renders loading → error → empty → content in one place. */
export function AsyncContent({ loading, error, empty, onRetry, skeleton, emptyState, children }) {
  if (loading) return skeleton || <Loader />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (empty) return emptyState || <EmptyState title="Nothing here yet" />;
  return children;
}
