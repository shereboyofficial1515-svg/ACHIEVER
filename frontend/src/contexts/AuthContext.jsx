import { clearAsyncCache } from '../hooks/useAsync.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setSessionEndedHandler } from '../services/api.js';
import { disablePushForSignOut } from '../services/pushDevice.js';
import { biometricEnrolment, flushNativeCookies, signWithBiometrics } from '../platform/index.js';

// A non-sensitive hint ("this device had a signed-in member") so a restart shows
// "Restoring your session" instead of flashing the sign-in page. No token is stored here.
const HINT = 'achiever.signedIn';
const hint = {
  get: () => { try { return localStorage.getItem(HINT) === '1'; } catch { return false; } },
  set: (on) => { try { if (on) localStorage.setItem(HINT, '1'); else localStorage.removeItem(HINT); } catch { /* storage unavailable */ } },
};
// Temporary problems are never a sign-out: offline, gateway errors, rate limiting (429),
// or a response that is not the API's (e.g. an HTML page from a misconfigured proxy).
const isNetworkError = (err) => err && (err.status === 0 || err.status === 429 || err.status >= 502
  || ['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'RATE_LIMITED', 'BAD_RESPONSE'].includes(err.code));

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // loading      : restoring the session (splash, never the sign-in page)
  // authenticated: signed in
  // anonymous    : genuinely no valid session
  // incomplete   : social sign-in finished, ACHIEVER profile still needed
  // unreachable  : the API could not be reached (offline / server waking up); the session is kept
  const [status, setStatus] = useState('loading');
  const [wasSignedIn] = useState(hint.get);

  // Cached screen data belongs to one account only.
  useEffect(() => { clearAsyncCache(); }, [user?.id]);

  const loadMe = useCallback(async ({ quiet = false } = {}) => {
    try {
      const { data } = await api.get('/auth/me');
      if (!data?.id) throw Object.assign(new Error('Unexpected response from the server'), { status: 0, code: 'BAD_RESPONSE' });
      setUser(data);
      setStatus('authenticated');
      hint.set(true);
      return data;
    } catch (err) {
      // A network failure is not a sign-out: keep the session and try again.
      if (isNetworkError(err)) {
        if (!quiet) setStatus((s) => (s === 'authenticated' ? s : 'unreachable'));
        return null;
      }
      setUser(null);
      hint.set(false);
      // Social sign-in succeeded but the ACHIEVER profile still has to be created.
      setStatus(err?.code === 'PROFILE_INCOMPLETE' ? 'incomplete' : 'anonymous');
      return null;
    }
  }, []);

  // While the API is unreachable, retry with back-off; also retry as soon as the device is online.
  useEffect(() => {
    if (status !== 'unreachable') return undefined;
    let delay = 3000;
    let timer;
    const tick = () => { timer = setTimeout(async () => { await loadMe(); delay = Math.min(delay * 2, 30000); tick(); }, delay); };
    tick();
    const online = () => loadMe();
    window.addEventListener('online', online);
    return () => { clearTimeout(timer); window.removeEventListener('online', online); };
  }, [status, loadMe]);

  // Back in the foreground: re-check the session quietly (never signs out on a network error).
  useEffect(() => {
    const onResume = () => { if (status === 'authenticated' || status === 'unreachable') loadMe({ quiet: true }); };
    window.addEventListener('achiever:app-resumed', onResume);
    return () => window.removeEventListener('achiever:app-resumed', onResume);
  }, [status, loadMe]);

  // Android: Google/Facebook sign-in returns through the app's deep link with a one-time code.
  useEffect(() => {
    const onHandoff = async (e) => {
      const { code, error } = e.detail || {};
      if (error || !code) {
        window.location.assign(`/login?oauth_error=${encodeURIComponent(error || 'OAUTH_FAILED')}`);
        return;
      }
      try {
        const { data } = await api.post('/auth/oauth/handoff', { code });
        await loadMe();
        window.location.assign(data?.next || '/app');
      } catch (err) {
        window.location.assign(`/login?oauth_error=${encodeURIComponent(err.code || 'OAUTH_FAILED')}`);
      }
    };
    window.addEventListener('achiever:oauth-handoff', onHandoff);
    return () => window.removeEventListener('achiever:oauth-handoff', onHandoff);
  }, [loadMe]);

  useEffect(() => {
    // Called only when the server says the session is over (refresh rejected / revoked).
    setSessionEndedHandler(() => {
      setUser(null);
      hint.set(false);
      setStatus('anonymous');
    });
    api.primeCsrf().catch(() => {});
    loadMe();
  }, [loadMe]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setUser(data);
    setStatus('authenticated');
    hint.set(true);
    flushNativeCookies();
    return data;
  }, []);

  /**
   * Android biometric sign-in: the server sends a one-time challenge, the phone's
   * secure key signs it after a fingerprint/face check, the server verifies it.
   */
  const loginWithBiometrics = useCallback(async () => {
    const enrolment = biometricEnrolment();
    if (!enrolment?.keyId) throw Object.assign(new Error('Biometric sign-in is not set up on this phone'), { code: 'BIOMETRIC_NOT_ENROLLED' });
    const { data: ch } = await api.post('/auth/biometric/challenge', { keyId: enrolment.keyId });
    const signature = await signWithBiometrics(ch.signPayload, { title: 'Sign in to ACHIEVER', subtitle: 'Use your fingerprint, face or screen lock', cancelText: 'Use password' });
    const { data } = await api.post('/auth/biometric/login', { keyId: enrolment.keyId, challengeId: ch.challengeId, signature });
    setUser(data);
    setStatus('authenticated');
    hint.set(true);
    flushNativeCookies();
    return data;
  }, []);

  const register = useCallback(
    async (payload) => {
      const res = await api.post('/auth/register', payload);
      await loadMe();
      return res;
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    try {
      await disablePushForSignOut();
      await api.post('/auth/logout');
    } finally {
      // Logout is the only place the local session is deliberately cleared.
      setUser(null);
      hint.set(false);
      setStatus('anonymous');
      flushNativeCookies();
    }
  }, []);

  const value = useMemo(() => {
    const roles = user?.roles || [];
    const has = (...r) => r.some((x) => roles.includes(x));
    // Member sessions never carry staff permissions (administration is a separate app).
    const permissions = user?.permissions || [];
    const can = (...p) => p.some((x) => permissions.includes(x));
    return {
      user,
      status,
      wasSignedIn,
      roles,
      has,
      can,
      permissions,
      isOrganiser: has('OSUSU_ADMIN'),
      isCollector: has('COLLECTOR'),
      login,
      loginWithBiometrics,
      register,
      logout,
      refresh: loadMe,
      setUser,
    };
  }, [user, status, wasSignedIn, login, loginWithBiometrics, register, logout, loadMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
