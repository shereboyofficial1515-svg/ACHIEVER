import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader } from './components/ui/index.js';
import { useAuth } from './contexts/AuthContext.jsx';
import StepUpDialog from './components/StepUpDialog.jsx';
import AdminLayout from './layouts/AdminLayout.jsx';
import Login from './pages/Login.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const AdminUsers = lazy(() => import('./pages/AdminUsers.jsx'));
const AdminUserDetail = lazy(() => import('./pages/AdminUserDetail.jsx'));
const AdminGroups = lazy(() => import('./pages/AdminGroups.jsx'));
const GroupView = lazy(() => import('./pages/GroupView.jsx'));
const AdminCollectors = lazy(() => import('./pages/AdminCollectors.jsx'));
const AdminTransactions = lazy(() => import('./pages/AdminTransactions.jsx'));
const AdminPayouts = lazy(() => import('./pages/AdminPayouts.jsx'));
const AdminBills = lazy(() => import('./pages/AdminBills.jsx'));
const AdminWallets = lazy(() => import('./pages/AdminWallets.jsx'));
const AdminReferrals = lazy(() => import('./pages/AdminReferrals.jsx'));
const AdminVerification = lazy(() => import('./pages/AdminVerification.jsx'));
const AdminSupport = lazy(() => import('./pages/AdminSupport.jsx'));
const TicketView = lazy(() => import('./pages/TicketView.jsx'));
const AdminRisk = lazy(() => import('./pages/AdminRisk.jsx'));
const AdminAudit = lazy(() => import('./pages/AdminAudit.jsx'));
const AdminReports = lazy(() => import('./pages/AdminReports.jsx'));
const AdminSettings = lazy(() => import('./pages/AdminSettings.jsx'));
const Notices = lazy(() => import('./pages/Notices.jsx'));
const AdminCompliance = lazy(() => import('./pages/AdminCompliance.jsx'));
const AdminApprovals = lazy(() => import('./pages/AdminApprovals.jsx'));
const AdminTrace = lazy(() => import('./pages/AdminTrace.jsx'));
const AdminDataAccess = lazy(() => import('./pages/AdminDataAccess.jsx'));
const AdminPrivacy = lazy(() => import('./pages/AdminPrivacy.jsx'));
const Admins = lazy(() => import('./pages/Admins.jsx'));
const AdminSecurity = lazy(() => import('./pages/AdminSecurity.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));

function RequireAdmin({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loader />;
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function RedirectIfSignedIn({ children }) {
  const { status } = useAuth();
  if (status === 'loading') return <Loader />;
  return status === 'authenticated' ? <Navigate to="/" replace /> : children;
}

function NotFound() {
  return <div className="card card-body"><h1>Page not found</h1><p className="muted">That admin page does not exist.</p></div>;
}

export default function App() {
  return (
    <Suspense fallback={<Loader />}>
      <StepUpDialog />
      <Routes>
        <Route path="/login" element={<RedirectIfSignedIn><Login /></RedirectIfSignedIn>} />
        <Route path="/forgot-password" element={<RedirectIfSignedIn><ForgotPassword /></RedirectIfSignedIn>} />
        <Route element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route index element={<Dashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/:id" element={<AdminUserDetail />} />
          <Route path="groups" element={<AdminGroups />} />
          <Route path="groups/:groupId" element={<GroupView />} />
          <Route path="collectors" element={<AdminCollectors />} />
          <Route path="transactions" element={<AdminTransactions />} />
          <Route path="payouts" element={<AdminPayouts />} />
          <Route path="bills" element={<AdminBills />} />
          <Route path="wallets" element={<AdminWallets />} />
          <Route path="referrals" element={<AdminReferrals />} />
          <Route path="verification" element={<AdminVerification />} />
          <Route path="support" element={<AdminSupport />} />
          <Route path="support/:id" element={<TicketView />} />
          <Route path="risk" element={<AdminRisk />} />
          <Route path="trace" element={<AdminTrace />} />
          <Route path="compliance" element={<AdminCompliance />} />
          <Route path="admin-security" element={<AdminSecurity />} />
          <Route path="audit" element={<AdminAudit />} />
          <Route path="data-access" element={<AdminDataAccess />} />
          <Route path="privacy" element={<AdminPrivacy />} />
          <Route path="approvals" element={<AdminApprovals />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="notices" element={<Notices />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="admins" element={<Admins />} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
