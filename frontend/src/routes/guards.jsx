import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Loader } from '../components/ui/index.js';

/** Client-side guards are for UX only; the API enforces every permission. */
export function RequireAuth() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <SessionSplash />;
  if (status === 'unreachable') return <SessionUnreachable />;
  if (status === 'incomplete') return <Navigate to="/complete-profile" replace />;
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location }} />;
  if (!user.emailVerified && location.pathname !== '/verify-email') return <Navigate to="/verify-email" replace />;
  return <Outlet />;
}

export function RequireRole({ roles }) {
  const { has } = useAuth();
  if (!has(...roles)) return <Navigate to="/app" replace />;
  return <Outlet />;
}

export function RequirePermission({ permissions }) {
  const { can } = useAuth();
  if (!can(...permissions)) return <Navigate to="/403" replace />;
  return <Outlet />;
}

export function RedirectIfAuthenticated() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <SessionSplash />;
  if (status === 'authenticated') return <Navigate to={location.state?.from?.pathname || '/app'} replace />;
  return <Outlet />;
}

/** Shown while the saved session is being restored (never the sign-in page). */
export function SessionSplash() {
  const { wasSignedIn } = useAuth();
  return <Loader label={wasSignedIn ? 'Restoring your session…' : 'Loading…'} />;
}

/** The API could not be reached: keep the session, explain, retry automatically. */
export function SessionUnreachable() {
  const { refresh } = useAuth();
  return (
    <div className="session-unreachable" role="status">
      <h1>You’re offline</h1>
      <p className="muted">We couldn’t reach ACHIEVER. You’re still signed in — we’ll reconnect automatically when your connection is back.</p>
      <button type="button" className="btn btn-primary" onClick={() => refresh()}>Try again</button>
    </div>
  );
}
