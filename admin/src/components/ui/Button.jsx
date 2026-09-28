import { forwardRef } from 'react';
import { Link } from 'react-router-dom';

export const Button = forwardRef(function Button(
  { variant = 'primary', size, block, loading, loadingText, icon: Icon, children, className = '', to, href, type = 'button', disabled, ...rest },
  ref,
) {
  const cls = ['btn', `btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block', className].filter(Boolean).join(' ');
  const content = (
    <>
      {loading ? <span className="spinner" aria-hidden style={{ width: 16, height: 16 }} /> : Icon && <Icon size={size === 'sm' ? 15 : 17} aria-hidden />}
      <span>{loading && loadingText ? loadingText : children}</span>
    </>
  );
  // Plain link for static public pages (e.g. /documentation.html) outside the SPA router.
  if (href) {
    return (
      <a ref={ref} href={href} className={cls} {...rest}>
        {content}
      </a>
    );
  }
  if (to) {
    return (
      <Link ref={ref} to={to} className={cls} {...rest}>
        {content}
      </Link>
    );
  }
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {content}
    </button>
  );
});

export function IconButton({ icon: Icon, label, count, className = '', ...rest }) {
  return (
    <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...rest}>
      <Icon size={20} aria-hidden />
      {count > 0 && <span className="dot-count">{count > 99 ? '99+' : count}</span>}
    </button>
  );
}
