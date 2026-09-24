import { FileText } from 'lucide-react';
import BrandLogo from '../../components/brand/BrandLogo.jsx';
import PublicFooter from './PublicFooter.jsx';

const POLICIES = [
  ['Terms of Service', '/terms.html', 'Your responsibilities, contribution obligations, Osusu and Collector rules, disputes, suspension and termination.'],
  ['Privacy Policy', '/privacy.html', 'What we collect, why, who it may be shared with, how long it is kept and your rights.'],
  ['Refund Policy', '/refund-policy.html', 'Failed, duplicate and reversed payments, bill-payment failures and timelines.'],
  ['Cookie Policy', '/cookie-policy.html', 'The small set of necessary cookies ACHIEVER uses.'],
  ['Security', '/security.html', 'How accounts and money records are protected, and how to report a problem.'],
  ['Deleting your data', '/delete-data.html', 'Account deletion, personal-data deletion and records we must keep.'],
  ['Accessibility', '/accessibility.html', 'Accessibility features and how to request help.'],
];

/** Policy centre (the canonical policy pages are static HTML for fast, public access). */
export default function Legal() {
  return (
    <>
      <div className="section" style={{ maxWidth: 860 }}>
        <BrandLogo variant="stacked" width={120} />
        <div className="stack-lg" style={{ marginTop: 32 }}>
          <div>
            <h1>Policy centre</h1>
            <p className="muted">
              Plain-language policies describing how ACHIEVER works. They must be reviewed by qualified Nigerian legal and compliance
              professionals before public launch.
            </p>
          </div>
          <div className="grid-2">
            {POLICIES.map(([title, href, text]) => (
              <a key={href} href={href} className="card card-body" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="row"><FileText size={18} aria-hidden /><strong>{title}</strong></div>
                <p className="small muted" style={{ marginTop: 6 }}>{text}</p>
              </a>
            ))}
          </div>
        </div>
      </div>
      <PublicFooter />
    </>
  );
}
