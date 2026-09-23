import { Link } from 'react-router-dom';
import { BadgeCheck, CalendarClock, HandCoins, MessagesSquare, ShieldCheck, UsersRound, Zap } from 'lucide-react';
import { Button } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';

const FEATURES = [
  { icon: UsersRound, title: 'Osusu rotation, tracked', text: 'Fixed contributions, a clear payout order, and a live view of who has paid each cycle.' },
  { icon: HandCoins, title: 'Collector savings', text: 'Save flexible amounts with a collector for an agreed term, with the commission shown upfront.' },
  { icon: ShieldCheck, title: 'Verified payments', text: 'Every payment is confirmed with Paystack on our servers before it appears in your records.' },
  { icon: BadgeCheck, title: 'Accountable organisers', text: 'Organisers and collectors verify their identity and sign a written undertaking.' },
  { icon: MessagesSquare, title: 'Chat and calls', text: 'Group chat, voice and video calls, and scheduled meetings for every group.' },
  { icon: Zap, title: 'Everyday bills', text: 'Buy airtime and data, and pay electricity, from the same account.' },
];

export default function Landing() {
  const { status } = useAuth();
  const signedIn = status === 'authenticated';
  return (
    <>
      <div className="hero">
        <header className="public-header">
          <Link to="/" className="brand-mark">
            ACHIEVER<span className="dot">.</span>
          </Link>
          <div className="row">
            {signedIn ? (
              <Button to="/app" variant="gold" size="sm">
                Open dashboard
              </Button>
            ) : (
              <>
                <Link to="/login" style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>
                  Sign in
                </Link>
                <Button to="/register" variant="gold" size="sm">
                  Create account
                </Button>
              </>
            )}
          </div>
        </header>
        <div className="inner">
          <div>
            <h1>Ajo and Osusu savings, with records everyone can trust.</h1>
            <p className="lead">
              ACHIEVER helps Nigerian savings groups and collectors keep accurate, verified records of every contribution, payout and
              return — and keeps members connected.
            </p>
            <div className="ctas">
              <Button to={signedIn ? '/app' : '/register'} variant="gold">
                {signedIn ? 'Go to dashboard' : 'Get started'}
              </Button>
              <Button to="/legal" variant="secondary">
                How we handle money
              </Button>
            </div>
          </div>
          <div className="hero-panel" aria-hidden>
            <div className="rowline">
              <span>Weekly contribution</span>
              <strong style={{ color: '#fff' }}>₦20,000</strong>
            </div>
            <div className="rowline">
              <span>Members</span>
              <strong style={{ color: '#fff' }}>10</strong>
            </div>
            <div className="rowline">
              <span>Pool each cycle</span>
              <strong style={{ color: '#fff' }}>₦200,000</strong>
            </div>
            <div className="rowline">
              <span>Payout</span>
              <strong style={{ color: '#fff' }}>One member per cycle, in order</strong>
            </div>
          </div>
        </div>
      </div>

      <section className="section">
        <h2>Two arrangements, kept separate</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          Osusu and Collector savings follow different rules, so ACHIEVER treats them as different products.
        </p>
        <div className="compare">
          <div className="card card-body">
            <div className="row">
              <UsersRound size={20} /> <h3>Osusu (rotational)</h3>
            </div>
            <ul>
              <li>A fixed group contributes the same amount on a set schedule.</li>
              <li>One member receives the full pool each cycle.</li>
              <li>Members who have been paid keep contributing until everyone has been paid.</li>
            </ul>
          </div>
          <div className="card card-body">
            <div className="row">
              <CalendarClock size={20} /> <h3>Collector (individual savings)</h3>
            </div>
            <ul>
              <li>A saver deposits flexible amounts with a collector.</li>
              <li>Funds are due back to the saver at the end of the agreed term.</li>
              <li>The collector earns the commission agreed before saving starts.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="grid-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card feature">
              <div className="ficon">
                <f.icon size={22} aria-hidden />
              </div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
        <div className="notice" style={{ marginTop: 32 }}>
          ACHIEVER is a record-keeping and payment-coordination service. It is not a bank, is not licensed by the Central Bank of
          Nigeria as a deposit-taking institution, and funds are not covered by deposit insurance. Read our{' '}
          <Link to="/legal">terms and money-handling notice</Link> before you join or organise a group.
        </div>
      </section>

      <footer className="public-footer">
        <div className="inner">
          <span>© {new Date().getFullYear()} ACHIEVER</span>
          <Link to="/legal">Terms, privacy and money handling</Link>
        </div>
      </footer>
    </>
  );
}
