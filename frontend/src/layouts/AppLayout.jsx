import { Suspense, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Menu } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useRealtime, useRealtimeEvent } from '../contexts/RealtimeContext.jsx';
import { IconButton, Loader, UserAvatar } from '../components/ui/index.js';
import { buildNavigation } from './navigation.js';
import BrandLogo from '../components/brand/BrandLogo.jsx';
import { usePreferences } from '../contexts/PreferencesContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { usePageTransition } from '../hooks/useMotion.js';
import { playSound } from '../utils/sounds.js';
import { api } from '../services/api.js';
import { useConfirm } from '../components/ui/ConfirmProvider.jsx';
import { pushOverlay } from '../platform/overlays.js';
import NetworkBanner from '../components/NetworkBanner.jsx';
import AppLock from '../components/AppLock.jsx';
import { usePushRefresh } from '../components/domain/SecuritySettings.jsx';

function Brand({ compact }) {
  return compact
    ? <BrandLogo variant="mark" height={36} to="/app" />
    : <BrandLogo variant="stacked" width={132} plate to="/app" />;
}

function NavList({ nav, badges, onNavigate }) {
  const renderItem = (item) => (
    <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onNavigate}>
      <item.icon size={18} aria-hidden />
      <span>{item.label}</span>
      {item.badgeKey && badges[item.badgeKey] > 0 && <span className="count">{badges[item.badgeKey]}</span>}
    </NavLink>
  );
  return (
    <>
      {nav.main.map(renderItem)}
      {nav.admin.length > 0 && <div className="nav-section">Administration</div>}
      {nav.admin.map(renderItem)}
    </>
  );
}

export default function AppLayout() {
  const { user, has, can, logout } = useAuth();
  const { unreadNotifications } = useRealtime();
  const { prefs } = usePreferences();
  const toast = useToast();
  const [drawer, setDrawer] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const location = useLocation();
  // An open conversation is a full-screen chat: no bottom navigation over the composer.
  const inChat = /^\/app\/messages\/[^/]+\/?$/.test(location.pathname);
  useEffect(() => {
    document.body.classList.toggle('in-chat', inChat);
    return () => document.body.classList.remove('in-chat');
  }, [inChat]);
  const navigate = useNavigate();
  const nav = useMemo(() => buildNavigation(has, can), [has, can]);

  const refreshMessages = () =>
    api.get('/messages/conversations').then(({ data }) => setUnreadMessages(data.reduce((s, c) => s + c.unreadCount, 0))).catch(() => {});

  useEffect(() => {
    if (user?.emailVerified) refreshMessages();
  }, [user?.emailVerified, location.pathname]);
  // Back after a dropped connection or from the background: recount what arrived meanwhile.
  useRealtimeEvent('resync', () => { if (user?.emailVerified) refreshMessages(); });
  // Notification sound: security alerts always sound; other notifications follow the settings.
  useRealtimeEvent('notification.new', (n) => {
    if (n?.category === 'security') playSound('notification', {});
    else playSound('notification', prefs.messages);
  });
  useRealtimeEvent('message.new', (m) => {
    if (m.senderId === user?.id) return;
    // The app received it: senders who share receipts see "delivered" (two grey ticks).
    api.post(`/messages/conversations/${m.conversationId}/delivered`).catch(() => {});
    if (m.muted) {   // muted chat: counted, but no sound or pop-up
      if (!location.pathname.includes(m.conversationId)) setUnreadMessages((n) => n + 1);
      return;
    }
    // Settings → Notifications → Message sounds (master switch, incoming, sleep mode).
    playSound('incoming', prefs.messages);
    if (location.pathname.includes(m.conversationId)) return;   // already reading it
    setUnreadMessages((n) => n + 1);
    toast.info(prefs.messages.messagePreview && m.body ? `${m.senderName || 'New message'}: ${m.body.slice(0, 80)}` : 'You have a new message');
  });
  const pageRef = usePageTransition(location.pathname);

  useEffect(() => setDrawer(false), [location.pathname]);

  const badges = { notifications: unreadNotifications, messages: unreadMessages };
  const current = [...nav.admin, ...nav.main].find((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)));

  const confirmAction = useConfirm();
  const onLogout = async () => {
    if (!(await confirmAction({ type: 'logout' }))) return;
    await logout();
    navigate('/login', { replace: true });
  };

  // Android: keep the push token current; a tapped notification opens its screen.
  usePushRefresh();
  useEffect(() => {
    const go = (e) => { if (e.detail?.to?.startsWith('/app/')) navigate(e.detail.to); };
    window.addEventListener('achiever:navigate', go);
    return () => window.removeEventListener('achiever:navigate', go);
  }, [navigate]);
  const lockSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // The Android back button closes the menu drawer first.
  useEffect(() => (drawer ? pushOverlay(() => setDrawer(false)) : undefined), [drawer]);

  return (
    <div className="app-shell">
      <NetworkBanner />
      <AppLock onSignOut={lockSignOut} />
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <Brand />
        </div>
        <nav>
          <NavList nav={nav} badges={badges} />
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="nav-link" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer' }} onClick={onLogout}>
            <LogOut size={18} aria-hidden /> <span>Sign out</span>
          </button>
        </div>
      </aside>

      {drawer && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <aside className="drawer" aria-label="Menu">
            <div className="brand" style={{ display: 'flex', alignItems: 'center', padding: '16px 20px' }}>
              <Brand />
            </div>
            <nav>
              <NavList nav={nav} badges={badges} onNavigate={() => setDrawer(false)} />
              <button type="button" className="nav-link" style={{ background: 'none', border: 0, textAlign: 'left' }} onClick={onLogout}>
                <LogOut size={18} aria-hidden /> <span>Sign out</span>
              </button>
            </nav>
          </aside>
        </>
      )}

      <div className="app-body">
        <header className="topbar">
          <IconButton icon={Menu} label="Open menu" className="menu-toggle" onClick={() => setDrawer(true)} />
          <span className="mobile-mark"><Brand compact /></span>
          <span className="topbar-title">{current?.label || 'ACHIEVER'}</span>
          <div className="actions">
            <IconButton icon={Bell} label="Notifications" count={unreadNotifications} onClick={() => navigate('/app/notifications')} />
            <Link to="/app/profile" aria-label="My profile">
              <UserAvatar name={user?.fullName} src={user?.avatarUrl} size={34} />
            </Link>
          </div>
        </header>
        <main className="main" id="main" tabIndex={-1}>
          <div ref={pageRef}>
            {['restricted', 'verification_required'].includes(user?.status) && (
              <div className="alert alert-warning" role="status" style={{ marginBottom: 16 }}>
                {user.status === 'restricted'
                  ? 'Payments, withdrawals and payout changes are paused on your account while a review is completed.'
                  : 'Please complete the requested verification to continue using payments.'}
                {user.statusReason ? ` Reason: ${user.statusReason}.` : ''} <Link to="/app/support">Contact support</Link>
              </div>
            )}
            <Suspense fallback={<Loader />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      {!inChat && <nav className="bottom-nav" aria-label="Primary">
        {nav.bottom.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <item.icon size={21} aria-hidden />
            <span>{item.short || item.label}</span>
            {item.badgeKey && badges[item.badgeKey] > 0 && <span className="badge-dot" />}
          </NavLink>
        ))}
      </nav>}
    </div>
  );
}
