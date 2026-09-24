import { Outlet } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import BrandLogo from '../components/brand/BrandLogo.jsx';
import { useReveal } from '../hooks/useMotion.js';

export default function AuthLayout() {
  const cardRef = useReveal();
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <BrandLogo variant="full" width={190} plate />
        <div>
          <h2>Contribution savings, organised properly.</h2>
          <ul>
            <li>
              <CheckCircle2 size={18} /> Every contribution is verified with the payment provider before it is recorded.
            </li>
            <li>
              <CheckCircle2 size={18} /> Organisers and collectors are identity-verified and sign a written undertaking.
            </li>
            <li>
              <CheckCircle2 size={18} /> Clear records of who has paid, who is due, and who has been paid out.
            </li>
          </ul>
        </div>
        <p className="xsmall" style={{ color: '#7f8fab' }}>
          ACHIEVER is a record-keeping and payments coordination platform. It is not a bank and does not hold deposit insurance.
        </p>
      </aside>
      <div className="auth-main">
        <div className="auth-top">
          <BrandLogo variant="stacked" width={112} className="auth-top-logo" />
        </div>
        <div className="auth-card" ref={cardRef}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
