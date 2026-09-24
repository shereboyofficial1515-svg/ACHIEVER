import { Link } from 'react-router-dom';

/**
 * The official ACHIEVER logo (supplied artwork, never redrawn).
 *   full     – mark, wordmark and tagline
 *   stacked  – mark and wordmark (no tagline) for compact headers
 *   mark     – the "A" mark alone for icons and tight spaces
 * `plate` places the logo on a white rounded background for dark surfaces.
 */
const SOURCES = {
  full: { src: '/brand/achiever-logo-600.webp', fallback: '/brand/achiever-logo-600.png', ratio: 1063 / 848 },
  stacked: { src: '/brand/achiever-logo-stacked.webp', fallback: '/brand/achiever-logo-stacked.png', ratio: 1063 / 761 },
  mark: { src: '/brand/achiever-mark-192.png', fallback: '/brand/achiever-mark-192.png', ratio: 1 },
};

export function BrandImage({ variant = 'stacked', width, height, className = '' }) {
  const s = SOURCES[variant];
  const w = width ?? Math.round(height * s.ratio);
  const h = height ?? Math.round(width / s.ratio);
  return (
    <picture className={className}>
      {s.src.endsWith('.webp') && <source srcSet={s.src} type="image/webp" />}
      <img src={s.fallback} width={w} height={h} alt="ACHIEVER" style={{ display: 'block', width: w, height: 'auto', maxWidth: '100%' }} />
    </picture>
  );
}

export default function BrandLogo({ variant = 'stacked', width, height, plate = false, to = '/', label = 'ACHIEVER home', className = '' }) {
  const image = <BrandImage variant={variant} width={width} height={height} />;
  const content = plate ? <span className="brand-plate">{image}</span> : image;
  if (!to) return <span className={`brand-logo ${className}`}>{content}</span>;
  return (
    <Link to={to} className={`brand-logo ${className}`} aria-label={label}>
      {content}
    </Link>
  );
}
