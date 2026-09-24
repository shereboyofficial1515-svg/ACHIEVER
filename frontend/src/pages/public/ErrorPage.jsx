import { Compass, Lock, ServerCrash, Wrench, WifiOff } from 'lucide-react';
import { BrandImage } from '../../components/brand/BrandLogo.jsx';
import { useReveal } from '../../hooks/useMotion.js';

const KINDS = {
  404: { icon: Compass, code: '404', title: 'Page not found', message: 'The page you are looking for does not exist or has moved.' },
  403: { icon: Lock, code: '403', title: 'You do not have access', message: 'Your account does not have permission to open this page. If you think this is a mistake, contact support.' },
  500: { icon: ServerCrash, code: '500', title: 'Something went wrong', message: 'An unexpected error stopped this page from loading. Your money and records are not affected. Please try again.' },
  network: { icon: WifiOff, code: 'Offline', title: 'No connection', message: 'ACHIEVER could not reach the server. Check your internet connection and try again. Do not repeat a payment while offline.' },
  maintenance: { icon: Wrench, code: 'Maintenance', title: 'Scheduled maintenance', message: 'ACHIEVER is being updated. Payments are paused until maintenance ends. Your balances and records are safe.' },
};

/** Branded error / status page. Uses plain links so it still works if the router failed. */
export default function ErrorPage({ kind = '404', onRetry }) {
  const k = KINDS[kind] || KINDS[404];
  const ref = useReveal({ children: true });
  const retry = onRetry || ((kind === 'network' || kind === '500' || kind === 'maintenance') ? () => window.location.reload() : null);
  return (
    <main className="error-page" id="main">
      <div className="error-card" ref={ref}>
        <a href="/" aria-label="ACHIEVER home" className="brand-logo"><BrandImage variant="stacked" width={128} /></a>
        <span className="error-icon" aria-hidden><k.icon size={28} /></span>
        <p className="error-code">{k.code}</p>
        <h1>{k.title}</h1>
        <p className="muted">{k.message}</p>
        <div className="row-wrap" style={{ justifyContent: 'center' }}>
          {retry && <button type="button" className="btn btn-primary" onClick={retry}>Try again</button>}
          <a className="btn btn-secondary" href="/app">Go to dashboard</a>
          <a className="btn btn-ghost" href="/support.html">Get support</a>
        </div>
        <p className="xsmall muted"><a href="/documentation.html">Documentation</a> · <a href="/">Home</a></p>
      </div>
    </main>
  );
}
