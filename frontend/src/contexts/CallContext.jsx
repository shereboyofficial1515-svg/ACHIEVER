import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { useRealtimeEvent } from './RealtimeContext.jsx';
import { useToast } from './ToastContext.jsx';
import { useAuth } from './AuthContext.jsx';
import IncomingCall from '../components/call/IncomingCall.jsx';

// LiveKit is only downloaded when a call actually starts.
const CallInterface = lazy(() => import('../components/call/CallInterface.jsx'));

const CallContext = createContext(null);

/**
 * Call signalling: the API creates call records and mints LiveKit tokens;
 * ringing/accept/reject/end events arrive over the realtime stream.
 */
export function CallProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();
  const [incoming, setIncoming] = useState(null);
  const [session, setSession] = useState(null); // { call, token, url, roomName }
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef(null);
  sessionRef.current = session;

  const begin = useCallback((result) => {
    setIncoming(null);
    setSession({ call: result.call, token: result.token, url: result.url, roomName: result.roomName });
  }, []);

  const run = useCallback(
    async (fn) => {
      if (busy) return;
      setBusy(true);
      try {
        const { data } = await fn();
        begin(data);
      } catch (err) {
        toast.error(err);
      } finally {
        setBusy(false);
      }
    },
    [busy, begin, toast],
  );

  const startCall = useCallback((conversationId, callType) => run(() => api.post('/calls', { conversationId, callType })), [run]);
  const acceptCall = useCallback((callId) => run(() => api.post(`/calls/${callId}/accept`)), [run]);
  const joinCall = useCallback((callId) => run(() => api.post(`/calls/${callId}/join`)), [run]);
  const startMeeting = useCallback((meetingId, callType) => run(() => api.post(`/meetings/${meetingId}/start`, { callType })), [run]);
  const joinMeeting = useCallback((meetingId) => run(() => api.post(`/meetings/${meetingId}/join`)), [run]);

  const rejectCall = useCallback(async (callId) => {
    setIncoming(null);
    await api.post(`/calls/${callId}/reject`).catch(() => {});
  }, []);

  const hangUp = useCallback(async (mode = 'leave') => {
    const current = sessionRef.current;
    setSession(null);
    if (current) await api.post(`/calls/${current.call.id}/${mode}`).catch(() => {});
  }, []);

  const refreshToken = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return null;
    const { data } = await api.post(`/calls/${current.call.id}/token`);
    return data;
  }, []);

  useRealtimeEvent('call.incoming', (call) => {
    if (call.initiatedBy === user?.id) return;
    if (sessionRef.current) return; // already on a call; the caller will see "missed"
    setIncoming(call);
  });

  useRealtimeEvent('call.updated', (call) => {
    setIncoming((cur) => (cur && cur.id === call.id && call.status !== 'ringing' ? null : cur));
    const current = sessionRef.current;
    if (current && current.call.id === call.id) {
      if (['ended', 'rejected', 'cancelled', 'missed'].includes(call.status)) {
        setSession(null);
        toast.info(call.status === 'rejected' ? 'Call declined' : call.status === 'missed' ? 'No answer' : 'Call ended');
      } else {
        setSession((s) => (s ? { ...s, call: { ...s.call, status: call.status } } : s));
      }
    }
  });

  // Ringing times out server-side after 45s; mirror that locally.
  useEffect(() => {
    if (!incoming) return undefined;
    const t = setTimeout(() => setIncoming(null), 45_000);
    return () => clearTimeout(t);
  }, [incoming]);

  return (
    <CallContext.Provider value={{ startCall, acceptCall, joinCall, rejectCall, startMeeting, joinMeeting, hangUp, busy, inCall: Boolean(session) }}>
      {children}
      {incoming && !session && (
        <IncomingCall call={incoming} onAccept={() => acceptCall(incoming.id)} onReject={() => rejectCall(incoming.id)} pending={busy} />
      )}
      {session && (
        <Suspense fallback={null}>
          <CallInterface session={session} currentUser={user} onLeave={() => hangUp('leave')} onEnd={() => hangUp('end')} refreshToken={refreshToken} />
        </Suspense>
      )}
    </CallContext.Provider>
  );
}

export function useCalls() {
  return useContext(CallContext);
}
