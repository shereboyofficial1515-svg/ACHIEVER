import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, TriangleAlert } from 'lucide-react';

/**
 * Pull-to-refresh for the app's main page scroll (Android app and mobile browsers).
 *
 *   <PullToRefresh onRefresh={async () => changed}> … </PullToRefresh>
 *
 * - Starts only when the page is scrolled to the very top and the finger moves
 *   mostly downwards (normal scrolling and sideways swipes never trigger it).
 * - States: Pull to refresh → Release to refresh → Refreshing… → Updated /
 *   You're up to date / Couldn't refresh (onRefresh resolves true when
 *   something changed and rejects when the refresh failed).
 * - One refresh at a time: further pulls are ignored until it finishes.
 * - Refreshes only what the page passes in; never reloads the whole app. While
 *   mounted, the mobile browser's own pull-to-reload is switched off so the two
 *   never fire together (normal scrolling is unaffected).
 * - Respects prefers-reduced-motion; listeners are removed on unmount.
 */
const MAX_FACTOR = 1.6;

export default function PullToRefresh({ onRefresh, disabled = false, threshold = 72, children }) {
  const ref = useRef(null);
  const start = useRef(null);
  const pullRef = useRef(0);
  const [pull, setPullState] = useState(0);
  const [phase, setPhase] = useState('idle'); // idle | pulling | ready | refreshing | done | failed
  const [doneText, setDoneText] = useState('');
  const busy = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return undefined;
    const setPull = (v) => { pullRef.current = v; setPullState(v); };
    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
    // Only one pull-to-refresh system per page: turn off the browser's native reload gesture.
    document.documentElement.classList.add('has-ptr');

    const onStart = (e) => {
      if (busy.current || e.touches.length !== 1 || !atTop()) { start.current = null; return; }
      // Never hijack gestures that begin inside inputs, dialogs or horizontal scrollers.
      if (e.target.closest?.('input, textarea, select, [role="dialog"], .no-pull, .h-scroll')) { start.current = null; return; }
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: false };
    };
    const onMove = (e) => {
      const s = start.current;
      if (!s || busy.current) return;
      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      if (!s.active) {
        // Decide once: a clear downward pull while at the top, otherwise let the page scroll.
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || !atTop()) { start.current = null; return; }
        s.active = true;
      }
      const distance = Math.max(0, Math.min(threshold * MAX_FACTOR, dy * 0.5));
      setPull(distance);
      setPhase(distance >= threshold ? 'ready' : 'pulling');
    };
    const finish = (text, failed) => {
      setDoneText(text);
      setPhase(failed ? 'failed' : 'done');
      setTimeout(() => { busy.current = false; setPhase('idle'); setPull(0); }, failed ? 1800 : 900);
    };
    const onEnd = () => {
      const s = start.current;
      start.current = null;
      if (!s?.active) return;
      if (pullRef.current < threshold || busy.current) { setPhase('idle'); setPull(0); return; }
      busy.current = true;
      setPhase('refreshing');
      setPull(threshold * 0.75);
      Promise.resolve()
        .then(() => onRefreshRef.current?.())
        .then((changed) => finish(changed === false ? 'You’re up to date' : 'Updated', false))
        .catch(() => finish('Couldn’t refresh. Check your connection and try again.', true));
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.documentElement.classList.remove('has-ptr');
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [disabled, threshold]);

  const label = { pulling: 'Pull to refresh', ready: 'Release to refresh', refreshing: 'Refreshing…', done: doneText, failed: doneText }[phase] || '';
  const visible = phase !== 'idle' || pull > 0;
  return (
    <div ref={ref} className="ptr">
      <div className={`ptr-indicator${visible ? ' is-visible' : ''}`} style={{ height: visible ? Math.max(pull, phase === 'idle' ? 0 : 44) : 0 }} aria-hidden={!visible}>
        <span className={`ptr-chip ptr-${phase}`} role="status" aria-live="polite">
          {phase === 'done' ? <Check size={16} aria-hidden />
            : phase === 'failed' ? <TriangleAlert size={16} aria-hidden />
              : <RefreshCw size={16} aria-hidden style={phase === 'refreshing' ? undefined : { transform: `rotate(${Math.round((pull / threshold) * 270)}deg)` }} />}
          <span className="xsmall">{label}</span>
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * Refresh several useAsync() results in the background and report whether
 * anything changed (so the indicator can say "You're up to date"). The screen
 * keeps its current data while loading; if any request fails the data already
 * shown stays and this rejects, so the indicator says "Couldn't refresh".
 */
export async function reloadAll(...asyncs) {
  const list = asyncs.filter(Boolean);
  const before = list.map((a) => JSON.stringify(a.data ?? null));
  const hadError = list.some((a) => a.error);   // an error screen that now loads is a change too
  const results = await Promise.allSettled(list.map((a) => (a.refresh ? a.refresh() : a.reload?.())));
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
  return hadError || results.some((r, i) => r.value !== undefined && JSON.stringify(r.value?.data ?? r.value ?? null) !== before[i]);
}
