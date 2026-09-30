import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setSessionEndedHandler } from '../services/api.js';
import { disablePushForSignOut } from '../services/pushDevice.js';
import { biometricEnrolment, signWithBiometrics } from '../platform/index.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous

  const loadMe = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
      setStatus('authenticated');
      return data;
    } catch (err) {
      setUser(null);
      // Social sign-in succeeded but the ACHIEVER profile still has to be created.
      setStatus(err?.code === 'PROFILE_INCOMPLETE' ? 'incomplete' : 'anonymous');
      return null;
    }
  }, []);

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
    setSessionEndedHandler(() => {
      setUser(null);
      setStatus('anonymous');
    });
    api.primeCsrf().catch(() => {});
    loadMe();
  }, [loadMe]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setUser(data);
    setStatus('authenticated');
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
      setUser(null);
      setStatus('anonymous');
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
  }, [user, status, login, loginWithBiometrics, register, logout, loadMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
