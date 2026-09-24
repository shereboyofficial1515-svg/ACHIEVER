import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setSessionEndedHandler } from '../services/api.js';

const AuthContext = createContext(null);

export const STAFF_ROLES = [
  'SUPER_ADMIN', 'ADMIN', 'COMPLIANCE_ADMIN', 'FINANCE_ADMIN', 'DISPUTE_ADMIN', 'SECURITY_ADMIN', 'SUPPORT_ADMIN', 'AUDITOR', 'READ_ONLY_ADMIN',
];

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
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(() => {
    const roles = user?.roles || [];
    const has = (...r) => r.some((x) => roles.includes(x));
    // Permissions come from the server (role_permissions); UI checks are for display only.
    const permissions = user?.permissions || [];
    const can = (...p) => p.some((x) => permissions.includes(x));
    return {
      user,
      status,
      roles,
      has,
      can,
      permissions,
      isStaff: has(...STAFF_ROLES),
      isFinanceStaff: can('finance.payouts.execute'),
      isOrganiser: has('OSUSU_ADMIN'),
      isCollector: has('COLLECTOR'),
      login,
      register,
      logout,
      refresh: loadMe,
      setUser,
    };
  }, [user, status, login, register, logout, loadMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
