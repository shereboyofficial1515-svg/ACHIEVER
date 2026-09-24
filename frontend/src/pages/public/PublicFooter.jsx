import { BrandImage } from '../../components/brand/BrandLogo.jsx';

/** Footer links match the static public pages (frontend/public/*.html). */
export const FOOTER_LINKS = [
  ['Documentation', '/documentation.html'],
  ['Terms', '/terms.html'],
  ['Privacy', '/privacy.html'],
  ['Refund Policy', '/refund-policy.html'],
  ['Cookie Policy', '/cookie-policy.html'],
  ['Security', '/security.html'],
  ['Support', '/support.html'],
  ['Delete Data', '/delete-data.html'],
  ['Accessibility', '/accessibility.html'],
  ['About', '/about.html'],
  ['Contact', '/contact.html'],
];

export default function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="inner footer-inner">
        <div className="stack-sm">
          <BrandImage variant="stacked" width={110} />
          <span className="xsmall muted">© {new Date().getFullYear()} ACHIEVER. Save Together. Go Further.</span>
          <span className="xsmall muted">ACHIEVER is not a bank and funds are not covered by deposit insurance.</span>
        </div>
        <nav aria-label="Footer" className="footer-links">
          {FOOTER_LINKS.map(([label, href]) => (
            <a key={href} href={href}>{label}</a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
