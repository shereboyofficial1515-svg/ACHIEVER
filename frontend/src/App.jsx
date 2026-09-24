import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loader } from './components/ui/index.js';
import { RedirectIfAuthenticated, RequireAuth, RequirePermission, RequireRole } from './routes/guards.jsx';
import { STAFF_ROLES } from './contexts/AuthContext.jsx';
import StepUpPrompt from './components/domain/StepUpPrompt.jsx';
import { RealtimeProvider } from './contexts/RealtimeContext.jsx';
import { CallProvider } from './contexts/CallContext.jsx';
import AuthLayout from './layouts/AuthLayout.jsx';
import AppLayout from './layouts/AppLayout.jsx';

// Route-level code splitting keeps the first load small on mobile networks.
const Landing = lazy(() => import('./pages/public/Landing.jsx'));
const Legal = lazy(() => import('./pages/public/Legal.jsx'));
const NotFound = lazy(() => import('./pages/public/NotFound.jsx'));
const Login = lazy(() => import('./pages/auth/Login.jsx'));
const Register = lazy(() => import('./pages/auth/Register.jsx'));
const VerifyEmail = lazy(() => import('./pages/auth/VerifyEmail.jsx'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword.jsx'));
const InviteLanding = lazy(() => import('./pages/auth/InviteLanding.jsx'));

const Dashboard = lazy(() => import('./pages/app/Dashboard.jsx'));
const Onboarding = lazy(() => import('./pages/app/Onboarding.jsx'));
const Profile = lazy(() => import('./pages/app/Profile.jsx'));
const Notifications = lazy(() => import('./pages/app/Notifications.jsx'));
const Transactions = lazy(() => import('./pages/payments/Transactions.jsx'));
const PaymentCallback = lazy(() => import('./pages/payments/PaymentCallback.jsx'));
const GroupsList = lazy(() => import('./pages/osusu/GroupsList.jsx'));
const CreateGroup = lazy(() => import('./pages/osusu/CreateGroup.jsx'));
const JoinGroup = lazy(() => import('./pages/osusu/JoinGroup.jsx'));
const GroupDetail = lazy(() => import('./pages/osusu/GroupDetail.jsx'));
const CollectorDesk = lazy(() => import('./pages/collector/CollectorDesk.jsx'));
const MySavings = lazy(() => import('./pages/collector/MySavings.jsx'));
const PlanDetail = lazy(() => import('./pages/collector/PlanDetail.jsx'));
const Bills = lazy(() => import('./pages/bills/Bills.jsx'));
const BillReceipt = lazy(() => import('./pages/bills/BillReceipt.jsx'));
const Messages = lazy(() => import('./pages/messages/Messages.jsx'));
const Meetings = lazy(() => import('./pages/app/Meetings.jsx'));
const Support = lazy(() => import('./pages/support/Support.jsx'));
const TicketDetail = lazy(() => import('./pages/support/TicketDetail.jsx'));

const AdminOverview = lazy(() => import('./pages/admin/AdminOverview.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const AdminUserDetail = lazy(() => import('./pages/admin/AdminUserDetail.jsx'));
const AdminGroups = lazy(() => import('./pages/admin/AdminGroups.jsx'));
const AdminCollectors = lazy(() => import('./pages/admin/AdminCollectors.jsx'));
const AdminTransactions = lazy(() => import('./pages/admin/AdminTransactions.jsx'));
const AdminPayouts = lazy(() => import('./pages/admin/AdminPayouts.jsx'));
const AdminBills = lazy(() => import('./pages/admin/AdminBills.jsx'));
const AdminVerification = lazy(() => import('./pages/admin/AdminVerification.jsx'));
const AdminSupport = lazy(() => import('./pages/admin/AdminSupport.jsx'));
const AdminRisk = lazy(() => import('./pages/admin/AdminRisk.jsx'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit.jsx'));
const AdminReports = lazy(() => import('./pages/admin/AdminReports.jsx'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings.jsx'));
const AdminCompliance = lazy(() => import('./pages/admin/AdminCompliance.jsx'));
const AdminApprovals = lazy(() => import('./pages/admin/AdminApprovals.jsx'));
const AdminTrace = lazy(() => import('./pages/admin/AdminTrace.jsx'));
const AdminDataAccess = lazy(() => import('./pages/admin/AdminDataAccess.jsx'));
const TrustProfile = lazy(() => import('./pages/app/TrustProfile.jsx'));

function SignedInShell() {
  return (
    <RealtimeProvider>
      <CallProvider>
        <AppLayout />
      </CallProvider>
    </RealtimeProvider>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Loader />}>
      <StepUpPrompt />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/legal" element={<Legal />} />

        <Route element={<AuthLayout />}>
          <Route element={<RedirectIfAuthenticated />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Route>
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/invite/:token" element={<InviteLanding />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route path="/app" element={<SignedInShell />}>
            <Route index element={<Dashboard />} />
            <Route path="onboarding" element={<Onboarding />} />
            <Route path="profile" element={<Profile />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="payments/callback" element={<PaymentCallback />} />
            <Route path="osusu" element={<GroupsList />} />
            <Route path="osusu/new" element={<CreateGroup />} />
            <Route path="osusu/join" element={<JoinGroup />} />
            <Route path="osusu/:groupId" element={<GroupDetail />} />
            <Route element={<RequireRole roles={['COLLECTOR']} />}>
              <Route path="collector" element={<CollectorDesk />} />
            </Route>
            <Route path="collector/plans/:planId" element={<PlanDetail />} />
            <Route path="savings" element={<MySavings />} />
            <Route path="bills" element={<Bills />} />
            <Route path="bills/:id" element={<BillReceipt />} />
            <Route path="messages" element={<Messages />} />
            <Route path="messages/:conversationId" element={<Messages />} />
            <Route path="meetings" element={<Meetings />} />
            <Route path="support" element={<Support />} />
            <Route path="support/:id" element={<TicketDetail />} />

            <Route path="people/:id" element={<TrustProfile />} />

            {/* Admin console: each page is gated by the permission the API enforces. */}
            <Route path="admin" element={<RequireRole roles={STAFF_ROLES} />}>
              <Route index element={<AdminOverview />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route element={<RequirePermission permissions={['users.read']} />}>
                <Route path="users" element={<AdminUsers />} />
                <Route path="users/:id" element={<AdminUserDetail />} />
              </Route>
              <Route path="groups" element={<AdminGroups />} />
              <Route element={<RequirePermission permissions={['collectors.review', 'collectors.status', 'overview.read']} />}>
                <Route path="collectors" element={<AdminCollectors />} />
              </Route>
              <Route element={<RequirePermission permissions={['finance.ledger.read', 'support.tickets']} />}>
                <Route path="bills" element={<AdminBills />} />
              </Route>
              <Route element={<RequirePermission permissions={['support.tickets', 'disputes.manage']} />}>
                <Route path="support" element={<AdminSupport />} />
                <Route path="support/:id" element={<TicketDetail staffView />} />
              </Route>
              <Route element={<RequirePermission permissions={['risk.review', 'security.events.read']} />}>
                <Route path="risk" element={<AdminRisk />} />
              </Route>
              <Route element={<RequirePermission permissions={['security.events.read', 'kyc.review', 'risk.review', 'audit.read']} />}>
                <Route path="compliance" element={<AdminCompliance />} />
              </Route>
              <Route element={<RequirePermission permissions={['finance.reversal.request', 'finance.reversal.approve', 'collectors.status', 'risk.review', 'finance.payouts.execute']} />}>
                <Route path="approvals" element={<AdminApprovals />} />
              </Route>
              <Route element={<RequirePermission permissions={['trace.read']} />}>
                <Route path="trace" element={<AdminTrace />} />
              </Route>
              <Route element={<RequirePermission permissions={['data_access.read']} />}>
                <Route path="data-access" element={<AdminDataAccess />} />
              </Route>
              <Route element={<RequirePermission permissions={['finance.ledger.read']} />}>
                <Route path="transactions" element={<AdminTransactions />} />
              </Route>
              <Route element={<RequirePermission permissions={['finance.payouts.execute']} />}>
                <Route path="payouts" element={<AdminPayouts />} />
              </Route>
              <Route element={<RequirePermission permissions={['kyc.review']} />}>
                <Route path="verification" element={<AdminVerification />} />
              </Route>
              <Route element={<RequirePermission permissions={['audit.read']} />}>
                <Route path="audit" element={<AdminAudit />} />
              </Route>
              <Route element={<RequirePermission permissions={['reports.platform']} />}>
                <Route path="reports" element={<AdminReports />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
