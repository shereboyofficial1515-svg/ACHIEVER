import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setSignedOutHandler } from '../services/api.js';

/**
 * Administrator session. The browser only knows who is signed in and which
 * permissions the API reported; the API enforces every permission itself.
 */
const AuthContext = createContext(null);

export const STAFF_ROLES = [
  'SUPER_ADMIN', 'ADMIN', 'COMPLIANCE_ADMIN', 'FINANCE_ADMIN', 'DISPUTE_ADMIN', 'SECURITY_ADMIN',
  'SUPPORT_ADMIN', 'CONTENT_ADMIN', 'AUDITOR', 'READ_ONLY_ADMIN',
];

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous
  const [endedReason, setEndedReason] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/auth/me');
      setAdmin(data);
      setStatus('authenticated');
      return data;
    } catch {
      setAdmin(null);
      setStatus('anonymous');
      return null;
    }
  }, []);

  useEffect(() => {
    setSignedOutHandler((err) => {
      setAdmin(null);
      setStatus('anonymous');
      setEndedReason(err?.message || null);
    });
    load();
  }, [load]);

  const logout = useCallback(async () => {
    await api.post('/admin/auth/logout').catch(() => {});
    api.resetCsrf();
    setAdmin(null);
    setStatus('anonymous');
  }, []);

  const can = useCallback((...perms) => perms.some((p) => admin?.permissions?.includes(p)), [admin]);

  const value = useMemo(() => ({
    // `user` keeps the moved pages working (they read user.id / user.permissions).
    admin, user: admin, status, endedReason, clearEnded: () => setEndedReason(null), load, logout, can,
  }), [admin, status, endedReason, load, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
