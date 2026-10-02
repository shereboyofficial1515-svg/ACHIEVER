import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Loader } from './components/ui/index.js';
import { RedirectIfAuthenticated, RequireAuth, RequireRole } from './routes/guards.jsx';
import StepUpPrompt from './components/domain/StepUpPrompt.jsx';
import ErrorPage from './pages/public/ErrorPage.jsx';
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
const BillPurchase = lazy(() => import('./pages/bills/BillPurchase.jsx'));
const BillHistory = lazy(() => import('./pages/bills/BillHistory.jsx'));
const Referrals = lazy(() => import('./pages/referrals/Referrals.jsx'));
const Wallet = lazy(() => import('./pages/wallet/Wallet.jsx'));
const AddMoney = lazy(() => import('./pages/wallet/AddMoney.jsx'));
const SendMoney = lazy(() => import('./pages/wallet/SendMoney.jsx'));
const WalletReceipt = lazy(() => import('./pages/wallet/WalletReceipt.jsx'));
const AutoPay = lazy(() => import('./pages/wallet/AutoPay.jsx'));
const TransferChooser = lazy(() => import('./pages/wallet/TransferChooser.jsx'));
const BankTransfer = lazy(() => import('./pages/wallet/BankTransfer.jsx'));
const BankTransferReceipt = lazy(() => import('./pages/wallet/BankTransferReceipt.jsx'));
const ReferralTerms = lazy(() => import('./pages/public/ReferralTerms.jsx'));
const Messages = lazy(() => import('./pages/messages/Messages.jsx'));
const Meetings = lazy(() => import('./pages/app/Meetings.jsx'));
const Support = lazy(() => import('./pages/support/Support.jsx'));
const TicketDetail = lazy(() => import('./pages/support/TicketDetail.jsx'));

const TrustProfile = lazy(() => import('./pages/app/TrustProfile.jsx'));
const Settings = lazy(() => import('./pages/settings/Settings.jsx'));
const HelpCenter = lazy(() => import('./help/HelpCenter.jsx'));
const PublicHelpCenter = lazy(() => import('./help/HelpCenter.jsx').then((m) => ({ default: m.PublicHelpCenter })));
const CompleteProfile = lazy(() => import('./pages/auth/CompleteProfile.jsx'));

/** Old receipt links (/app/bills/:id) keep working. */
function LegacyBillRedirect() {
  const { id } = useParams();
  return <Navigate to={`/app/bills/history/${id}`} replace />;
}

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
        <Route path="/referral-terms" element={<ReferralTerms />} />
        <Route path="/help" element={<PublicHelpCenter />} />
        <Route path="/help/:articleId" element={<PublicHelpCenter />} />
        <Route path="/403" element={<ErrorPage kind="403" />} />
        <Route path="/500" element={<ErrorPage kind="500" />} />
        <Route path="/offline" element={<ErrorPage kind="network" />} />
        <Route path="/maintenance" element={<ErrorPage kind="maintenance" />} />

        <Route element={<AuthLayout />}>
          <Route element={<RedirectIfAuthenticated />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Route>
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/complete-profile" element={<CompleteProfile />} />
          <Route path="/invite/:token" element={<InviteLanding />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route path="/app" element={<SignedInShell />}>
            <Route index element={<Dashboard />} />
            <Route path="onboarding" element={<Onboarding />} />
            <Route path="profile" element={<Profile />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/:section" element={<Settings />} />
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
            <Route path="bills/buy/:category" element={<BillPurchase />} />
            <Route path="bills/history" element={<BillHistory />} />
            <Route path="bills/history/:id" element={<BillReceipt />} />
            <Route path="bills/:id" element={<LegacyBillRedirect />} />
            <Route path="referrals" element={<Referrals />} />
            <Route path="wallet" element={<Wallet />} />
            <Route path="wallet/add" element={<AddMoney />} />
            <Route path="wallet/transfer" element={<TransferChooser />} />
            <Route path="wallet/send" element={<SendMoney />} />
            <Route path="wallet/bank" element={<BankTransfer />} />
            <Route path="wallet/bank-transfers/:id" element={<BankTransferReceipt />} />
            <Route path="wallet/autopay" element={<AutoPay />} />
            <Route path="wallet/transactions/:id" element={<WalletReceipt />} />
            <Route path="messages" element={<Messages />} />
            <Route path="messages/:conversationId" element={<Messages />} />
            <Route path="meetings" element={<Meetings />} />
            <Route path="help" element={<HelpCenter />} />
            <Route path="help/:articleId" element={<HelpCenter />} />
            <Route path="support" element={<Support />} />
            <Route path="support/:id" element={<TicketDetail />} />

            <Route path="people/:id" element={<TrustProfile />} />

            <Route path="*" element={<Navigate to="/app" replace />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
