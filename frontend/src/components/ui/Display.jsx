import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { statusMeta } from '../../utils/status.js';
import { initials } from '../../utils/format.js';

export function Card({ title, actions, children, footer, className = '', bodyClassName = 'card-body', flush }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row-wrap">{actions}</div>}
        </header>
      )}
      <div className={flush ? '' : bodyClassName}>{children}</div>
      {footer && <footer className="card-footer">{footer}</footer>}
    </section>
  );
}

export function StatCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <div className={`card stat-card ${accent ? 'accent' : ''}`}>
      <span className="label">
        {Icon && <Icon size={14} aria-hidden />}
        {label}
      </span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

/** Status badge used for Paid / Pending / Overdue / Completed / Failed / Processing / Under review. */
export function StatusBadge({ status, label }) {
  const meta = statusMeta(status);
  return <span className={`badge badge-${meta.tone}`}>{label || meta.label}</span>;
}
export const PaymentStatus = StatusBadge;

/**
 * Avatar: a fixed square box (never stretched by its parent) with a circular, clipped face.
 * The picture fills the circle with object-fit: cover, so a portrait or landscape photo is
 * cropped instead of changing the layout. Falls back to initials (or an icon) when there is
 * no picture or it fails to load. The online dot sits outside the clipped face.
 */
export function UserAvatar({ name, src, size = 36, online, icon: Icon, label, eager = false, className = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const showImage = src && !failed;
  return (
    <span
      className={`avatar ${className}`}
      style={{ '--avatar-size': `${size}px`, width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="avatar-face">
        {showImage
          ? <img src={src} alt="" width={size} height={size} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} />
          : Icon && !name ? <Icon size={Math.round(size * 0.5)} aria-hidden /> : initials(name)}
      </span>
      {online !== undefined && <span className={`presence ${online ? 'online' : ''}`} title={online ? 'Online' : 'Offline'} />}
    </span>
  );
}

const GROUP_SIZES = { small: 32, medium: 44, 'group-header': 40, large: 72, profile: 104 };

/** A group's picture (always circular, never distorted). size: small | medium | group-header | large | profile | px */
export function GroupAvatar({ name, src, size = 'medium', ...rest }) {
  const px = typeof size === 'number' ? size : GROUP_SIZES[size] || GROUP_SIZES.medium;
  return <UserAvatar name={name} src={src} size={px} className="group-avatar" {...rest} />;
}

/** Overlapping avatars (e.g. a few group members). */
export function AvatarStack({ people = [], size = 28, max = 4 }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="avatar-stack" aria-label={`${people.length} people`}>
      {shown.map((p) => <UserAvatar key={p.id || p.name} name={p.name} src={p.avatarUrl} size={size} />)}
      {extra > 0 && <span className="avatar avatar-more" style={{ width: size, height: size, fontSize: Math.max(10, size * 0.34) }}><span className="avatar-face">+{extra}</span></span>}
    </span>
  );
}

export function ProgressBar({ value, max, label }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="page-header">
      <div>
        {back && (
          <Link to={back.to} className="back-link">
            <ArrowLeft size={15} aria-hidden /> {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="row-wrap">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" className="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ meta, onPage }) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="pagination">
      <span className="muted">
        Page {meta.page} of {meta.totalPages} · {meta.total} records
      </span>
      <div className="row">
        <button type="button" className="btn btn-secondary btn-sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

/** Responsive data table: a real table on desktop, stacked label/value cards on phones. */
export function DataTable({ columns, rows, rowKey = 'id', onRowClick, empty }) {
  if (!rows?.length) return empty || null;
  return (
    <div className="table-wrap">
      <table className="table responsive">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : ''} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r[rowKey]}
              className={onRowClick ? 'clickable' : ''}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} className={c.align === 'right' ? 'num' : ''}>
                  {c.render ? c.render(r) : r[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeyValue({ items }) {
  return (
    <dl className="kv">
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
