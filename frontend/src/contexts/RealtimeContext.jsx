import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { useAuth } from './AuthContext.jsx';

const RealtimeContext = createContext(null);
const EVENTS = ['ready', 'message.new', 'message.updated', 'conversation.updated', 'conversation.receipt', 'typing', 'notification.new', 'call.incoming', 'call.updated'];
const BACKGROUND_CLOSE_MS = 20_000;   // in the background longer than this: close (the server then sends push)

/**
 * One Server-Sent Events connection per signed-in app. The session cookie authenticates it;
 * the browser never holds a database or realtime token.
 *
 * Reliability:
 *  - status: 'connecting' → 'connected' → 'reconnecting' (shown in the chat header)
 *  - the connection is reopened with backoff when it drops, when the network returns and when
 *    the app comes back to the foreground (Android freezes it in the background)
 *  - after every reconnect a 'resync' event tells screens to fetch what they missed
 *    (events sent while disconnected are not replayed by the server)
 *  - exactly one EventSource at a time; it is closed on sign-out and unmount
 */
export function RealtimeProvider({ children }) {
  const { status: authStatus } = useAuth();
  const listeners = useRef(new Map());
  const [status, setStatus] = useState('idle');
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const subscribe = useCallback((event, handler) => {
    if (!listeners.current.has(event)) listeners.current.set(event, new Set());
    listeners.current.get(event).add(handler);
    return () => listeners.current.get(event)?.delete(handler);
  }, []);
  const emit = useCallback((event, payload) => listeners.current.get(event)?.forEach((fn) => fn(payload)), []);

  const refreshUnread = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications/unread-count');
      setUnreadNotifications(data.count);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      setStatus('idle');
      return undefined;
    }
    let source = null;
    let retryTimer = null;
    let backgroundTimer = null;
    let attempt = 0;
    let everConnected = false;
    let stopped = false;

    const close = () => {
      if (source) source.close();
      source = null;
    };
    const open = () => {
      if (stopped) return;
      clearTimeout(retryTimer);
      close();
      setStatus(everConnected ? 'reconnecting' : 'connecting');
      const es = new EventSource(api.eventsUrl(), { withCredentials: true });
      source = es;
      EVENTS.forEach((ev) => es.addEventListener(ev, (e) => {
        if (source !== es) return;   // a stale connection
        let payload = null;
        try {
          payload = JSON.parse(e.data);
        } catch {
          return;
        }
        if (ev === 'ready') {
          attempt = 0;
          setStatus('connected');
          refreshUnread();
          if (everConnected) emit('resync', { at: Date.now() });   // fetch what was missed
          everConnected = true;
        }
        if (ev === 'notification.new') setUnreadNotifications((n) => n + 1);
        emit(ev, payload);
      }));
      es.onerror = () => {
        if (source !== es) return;
        setStatus('reconnecting');
        // The browser retries by itself while the stream is CONNECTING; once it gives up
        // (CLOSED, e.g. the server answered an error) we open a new one with backoff.
        if (es.readyState === EventSource.CLOSED) scheduleRetry();
      };
    };
    const scheduleRetry = () => {
      clearTimeout(retryTimer);
      const delay = Math.min(1000 * 2 ** attempt, 30_000) + Math.random() * 500;
      attempt += 1;
      retryTimer = setTimeout(open, delay);
    };
    // Make sure there is a live connection now (foreground / back online).
    const ensure = () => {
      clearTimeout(backgroundTimer);
      if (!source || source.readyState === EventSource.CLOSED) {
        attempt = 0;
        open();
      } else if (everConnected) {
        emit('resync', { at: Date.now() });   // it stayed open, but events may have been frozen
      }
    };
    const toBackground = () => {
      clearTimeout(backgroundTimer);
      backgroundTimer = setTimeout(() => {
        close();
        clearTimeout(retryTimer);
        setStatus('paused');
      }, BACKGROUND_CLOSE_MS);
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? toBackground() : ensure());
    const onOffline = () => setStatus('reconnecting');

    open();
    window.addEventListener('online', ensure);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('achiever:app-resumed', ensure);
    window.addEventListener('achiever:app-paused', toBackground);
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(backgroundTimer);
      close();
      setStatus('idle');
      window.removeEventListener('online', ensure);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('achiever:app-resumed', ensure);
      window.removeEventListener('achiever:app-paused', toBackground);
    };
  }, [authStatus, refreshUnread, emit]);

  const connected = status === 'connected';
  return (
    <RealtimeContext.Provider value={{ subscribe, status, connected, unreadNotifications, setUnreadNotifications, refreshUnread }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

/** Subscribe to a realtime event for the lifetime of a component (one subscription, latest handler). */
export function useRealtimeEvent(event, handler) {
  const { subscribe } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe(event, (p) => ref.current(p)), [event, subscribe]);
}
