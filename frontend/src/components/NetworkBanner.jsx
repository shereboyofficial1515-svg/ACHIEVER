import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { getNetworkStatus, onNetworkChange } from '../platform/index.js';

/**
 * Tells people when they are offline instead of showing blank screens. It
 * never retries anything by itself: money actions are only ever started by a
 * person, and only the server's confirmation counts as success.
 */
export default function NetworkBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let live = true;
    getNetworkStatus().then((s) => live && setOnline(s.connected)).catch(() => {});
    const off = onNetworkChange((s) => setOnline(s.connected));
    return () => {
      live = false;
      off();
    };
  }, []);
  if (online) return null;
  return (
    <div className="net-banner" role="status" aria-live="polite">
      <WifiOff size={16} aria-hidden="true" />
      <span>You appear to be offline. Figures shown may be out of date; payments and changes need a connection.</span>
      <button type="button" className="btn btn-sm btn-secondary" onClick={() => window.location.reload()}>Retry</button>
    </div>
  );
}
