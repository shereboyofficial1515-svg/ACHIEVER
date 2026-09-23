import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { useAuth } from './AuthContext.jsx';

const RealtimeContext = createContext(null);
const EVENTS = ['ready', 'message.new', 'notification.new', 'call.incoming', 'call.updated'];

/**
 * One Server-Sent Events connection per signed-in tab. The session cookie
 * authenticates it; the browser never holds a database or realtime token.
 * EventSource reconnects automatically; subscribers refetch on 'ready'.
 */
export function RealtimeProvider({ children }) {
  const { status } = useAuth();
  const listeners = useRef(new Map());
  const [connected, setConnected] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const subscribe = useCallback((event, handler) => {
    if (!listeners.current.has(event)) listeners.current.set(event, new Set());
    listeners.current.get(event).add(handler);
    return () => listeners.current.get(event)?.delete(handler);
  }, []);

  const refreshUnread = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications/unread-count');
      setUnreadNotifications(data.count);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    refreshUnread();
    const source = new EventSource(api.eventsUrl(), { withCredentials: true });
    const emit = (event) => (e) => {
      let payload = null;
      try {
        payload = JSON.parse(e.data);
      } catch {
        return;
      }
      if (event === 'ready') setConnected(true);
      if (event === 'notification.new') setUnreadNotifications((n) => n + 1);
      listeners.current.get(event)?.forEach((fn) => fn(payload));
    };
    EVENTS.forEach((ev) => source.addEventListener(ev, emit(ev)));
    source.onerror = () => setConnected(false);
    return () => {
      source.close();
      setConnected(false);
    };
  }, [status, refreshUnread]);

  return (
    <RealtimeContext.Provider value={{ subscribe, connected, unreadNotifications, setUnreadNotifications, refreshUnread }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

/** Subscribe to a realtime event for the lifetime of a component. */
export function useRealtimeEvent(event, handler) {
  const { subscribe } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe(event, (p) => ref.current(p)), [event, subscribe]);
}
