import { Link, Outlet } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';

export default function AuthLayout() {
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <Link to="/" className="brand-mark">
          ACHIEVER<span className="dot">.</span>
        </Link>
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
          <Link to="/" className="brand-mark dark" style={{ visibility: 'visible' }}>
            ACHIEVER<span className="dot">.</span>
          </Link>
        </div>
        <div className="auth-card">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
