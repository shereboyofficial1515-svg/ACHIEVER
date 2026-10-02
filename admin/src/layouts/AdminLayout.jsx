import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity, BadgeCheck, Banknote, ClipboardCheck, Coins, Eye, FileText, Gauge, Gift, GitBranch, HandCoins, KeyRound, LifeBuoy, LogOut, Menu, MessageSquare, Receipt, ScrollText, Settings, ShieldAlert, ShieldCheck, Trash2, UserCog, Users, UsersRound, Wallet, X, Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useConfirm } from '../components/ui/ConfirmProvider.jsx';
import { pushOverlay } from '../platform/overlays.js';

// Navigation mirrors the API permissions; hiding a link is convenience only — the API enforces access.
export const NAV = [
  { section: 'Operations', items: [
    { to: '/', label: 'Dashboard', icon: Gauge, perms: ['overview.read'], end: true },
  ] },
  { section: 'People', items: [
    { to: '/users', label: 'Users', icon: Users, perms: ['users.read'] },
    { to: '/verification', label: 'KYC & verification', icon: BadgeCheck, perms: ['kyc.review'] },
    { to: '/collectors', label: 'Collectors', icon: HandCoins, perms: ['collectors.review', 'collectors.status', 'overview.read'] },
    { to: '/groups', label: 'Osusu groups', icon: UsersRound, perms: ['overview.read'] },
  ] },
  { section: 'Money', items: [
    { to: '/transactions', label: 'Transactions', icon: Receipt, perms: ['finance.ledger.read'] },
    { to: '/payouts', label: 'Payouts', icon: Banknote, perms: ['finance.payouts.execute'] },
    { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, perms: ['finance.reversal.request', 'finance.reversal.approve', 'collectors.status', 'risk.review', 'finance.payouts.execute'] },
    { to: '/bills', label: 'Bills & Services', icon: Zap, perms: ['finance.ledger.read', 'support.tickets', 'bills.manage'] },
    { to: '/wallets', label: 'Wallets', icon: Wallet, perms: ['wallet.read', 'wallet.manage', 'wallet.adjust', 'wallet.payouts'] },
    { to: '/fees', label: 'Fees & Charges', icon: Coins, perms: ['fees.read', 'fees.manage', 'fees.approve'] },
    { to: '/referrals', label: 'Referrals', icon: Gift, perms: ['referrals.read'] },
  ] },
  { section: 'Cases', items: [
    { to: '/support', label: 'Support & disputes', icon: LifeBuoy, perms: ['support.tickets', 'disputes.manage'] },
    { to: '/risk', label: 'Risk reviews', icon: ShieldAlert, perms: ['risk.review', 'security.events.read'] },
    { to: '/trace', label: 'Traceability', icon: GitBranch, perms: ['trace.read'] },
  ] },
  { section: 'Security & compliance', items: [
    { to: '/compliance', label: 'Security events', icon: Activity, perms: ['security.events.read', 'kyc.review', 'risk.review', 'audit.read'] },
    { to: '/admin-security', label: 'Admin security', icon: ShieldCheck, perms: ['security.events.read', 'audit.read', 'admins.read'] },
    { to: '/audit', label: 'Audit log', icon: ScrollText, perms: ['audit.read'] },
    { to: '/data-access', label: 'Data access log', icon: Eye, perms: ['data_access.read'] },
    { to: '/privacy', label: 'Deletion requests', icon: Trash2, perms: ['privacy.requests.manage'] },
  ] },
  { section: 'Platform', items: [
    { to: '/reports', label: 'Reports & exports', icon: FileText, perms: ['reports.platform', 'reports.export'] },
    { to: '/notices', label: 'Platform notices', icon: MessageSquare, perms: ['notifications.broadcast'] },
    { to: '/settings', label: 'Settings', icon: Settings, perms: ['settings.read', 'sms.read'] },
    { to: '/admins', label: 'Administrators', icon: UserCog, perms: ['admins.read'] },
  ] },
];

export default function AdminLayout() {
  const { admin, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const confirmAction = useConfirm();
  const [theme, setTheme] = useState(() => document.documentElement.dataset.themePref || 'system');
  const changeTheme = (value) => {
    setTheme(value);
    try { localStorage.setItem('achiever.admin.theme', value); } catch { /* private mode */ }
    const dark = value === 'dark' || (value === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.themePref = value;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  };
  useEffect(() => (open ? pushOverlay(() => setOpen(false)) : undefined), [open]);
  const signOut = async () => {
    if (await confirmAction({ type: 'logout' })) logout();
  };
  return (
    <>
    <a className="skip-link" href="#main">Skip to main content</a>
    <div className={`admin-shell ${open ? 'nav-open' : ''}`}>
      <aside className="admin-nav" aria-label="Admin navigation">
        <div className="admin-brand">
          <img src="/brand/achiever-mark-96.png" width="28" height="28" alt="" />
          <span><strong>ACHIEVER</strong> Admin</span>
          <button type="button" className="icon-button nav-close" aria-label="Close menu" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        <nav>
          {NAV.map((group) => {
            const items = group.items.filter((i) => can(...i.perms));
            if (!items.length) return null;
            return (
              <div key={group.section} className="nav-group">
                <span className="nav-section">{group.section}</span>
                {items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink key={to} to={to} end={end} className="nav-item" onClick={() => setOpen(false)}>
                    <Icon size={16} aria-hidden="true" /> {label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <button type="button" className="icon-button nav-toggle" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={18} /></button>
          <span className="env-tag">Site Administration</span>
          <span className="grow" />
          <NavLink to="/account" className="admin-who" title="My admin account">
            <KeyRound size={14} aria-hidden="true" />
            <span>{admin?.name}</span>
            <span className="roles">{admin?.roles?.join(' · ')}</span>
          </NavLink>
          <select className="select theme-select" aria-label="Theme" value={theme} onChange={(e) => changeTheme(e.target.value)}>
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}><LogOut size={14} aria-hidden="true" /> Sign out</button>
        </header>
        <main id="main" className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
    </>
  );
}
