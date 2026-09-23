import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Loader } from '../components/ui/index.js';

/** Client-side guards are for UX only; the API enforces every permission. */
export function RequireAuth() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loader label="Loading account information..." />;
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location }} />;
  if (!user.emailVerified && location.pathname !== '/verify-email') return <Navigate to="/verify-email" replace />;
  return <Outlet />;
}

export function RequireRole({ roles }) {
  const { has } = useAuth();
  if (!has(...roles)) return <Navigate to="/app" replace />;
  return <Outlet />;
}

export function RedirectIfAuthenticated() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loader />;
  if (status === 'authenticated') return <Navigate to={location.state?.from?.pathname || '/app'} replace />;
  return <Outlet />;
}
