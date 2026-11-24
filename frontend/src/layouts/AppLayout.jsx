import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BookOpen, ChevronDown, LogOut, Menu, Settings, UserRound, X } from 'lucide-react';
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
    : <BrandLogo variant="stacked" width={92} to="/app" />;
}

function NavItem({ item, badges, onNavigate }) {
  const count = item.badgeKey ? badges[item.badgeKey] : 0;
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onNavigate}>
      <item.icon size={18} aria-hidden />
      <span>{item.label}</span>
      {count > 0 && <span className="count" aria-label={`${count} unread`}>{count > 99 ? '99+' : count}</span>}
    </NavLink>
  );
}

/** Grouped navigation (Savings, Money, Community, Support); `withAccount` adds Profile and Settings (phone drawer). */
function NavList({ nav, badges, onNavigate, withAccount }) {
  const sections = withAccount ? [...nav.sections, { id: 'account', label: 'Account', items: nav.account }] : nav.sections;
  return (
    <>
      {sections.map((s) => (
        <div key={s.id} className="nav-group" role="group" aria-label={s.label || 'Home'}>
          {s.label && <div className="nav-section" aria-hidden>{s.label}</div>}
          {s.items.map((item) => <NavItem key={item.to} item={item} badges={badges} onNavigate={onNavigate} />)}
        </div>
      ))}
    </>
  );
}

/** Top-bar account menu: profile, settings, help and sign out. Escape, outside click and the Android back button close it. */
function ProfileMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    const pop = pushOverlay(() => setOpen(false));
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); pop?.(); };
  }, [open]);
  const first = user?.fullName?.split(' ')[0] || 'Account';
  return (
    <div className="profile-menu" ref={ref}>
      <button type="button" className="profile-trigger" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((v) => !v)}>
        <UserAvatar name={user?.fullName} src={user?.avatarUrl} size={34} />
        <span className="profile-trigger-name">{first}</span>
        <ChevronDown size={16} aria-hidden className="profile-trigger-chev" />
      </button>
      {open && (
        <div className="profile-dropdown" role="menu">
          <div className="profile-dropdown-head">
            <UserAvatar name={user?.fullName} src={user?.avatarUrl} size={40} />
            <div className="grow">
              <p className="truncate" style={{ fontWeight: 600 }}>{user?.fullName}</p>
              <p className="xsmall muted truncate">{user?.email}</p>
            </div>
          </div>
          <Link role="menuitem" to="/app/profile" className="profile-dropdown-item"><UserRound size={17} aria-hidden /> My profile</Link>
          <Link role="menuitem" to="/app/settings" className="profile-dropdown-item"><Settings size={17} aria-hidden /> Settings</Link>
          <Link role="menuitem" to="/app/help" className="profile-dropdown-item"><BookOpen size={17} aria-hidden /> Help Center</Link>
          <button role="menuitem" type="button" className="profile-dropdown-item is-danger" onClick={() => { setOpen(false); onLogout(); }}>
            <LogOut size={17} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const { user, has, logout } = useAuth();
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
  const nav = useMemo(() => buildNavigation(has), [has]);

  const refreshMessages = () =>
    api.get('/messages/conversations').then(({ data }) => {
      const unread = data.reduce((s, c) => s + c.unreadCount, 0);
      setUnreadMessages(unread);
      // Messages that waited while the app was closed have now reached this device: two grey
      // ticks for their senders (never "read" — that happens only when a chat is viewed).
      if (unread > 0) api.post('/messages/delivered').catch(() => {});
    }).catch(() => {});

  // The badge is kept current by realtime events; the full count is fetched only on start,
  // after a reconnect (resync) and when leaving a chat (reading it lowers the count) —
  // not on every navigation (that re-downloaded the whole conversation list each time).
  const wasInChat = useRef(false);
  useEffect(() => {
    if (user?.emailVerified) refreshMessages();
  }, [user?.emailVerified]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wasInChat.current && !inChat && user?.emailVerified) refreshMessages();
    wasInChat.current = inChat;
  }, [inChat]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back after a dropped connection or from the background: recount what arrived meanwhile.
  useRealtimeEvent('resync', () => { if (user?.emailVerified) refreshMessages(); });
  // Notification sound: security alerts always sound; other notifications follow the settings.
  useRealtimeEvent('notification.new', (n) => {
    if (n?.category === 'security') playSound('notification', {});
    else playSound('notification', prefs.messages);
  });
  useRealtimeEvent('message.new', (m) => {
    if (m.senderId === user?.id) return;
    // The app received it: the sender sees "delivered" (two grey ticks), not "read".
    api.post(`/messages/conversations/${m.conversationId}/delivered`, { upTo: m.id }).catch(() => {});
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
  useEffect(() => {
    if (!drawer) return undefined;
    const pop = pushOverlay(() => setDrawer(false));
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', onKey);
    return () => { pop(); document.removeEventListener('keydown', onKey); };
  }, [drawer]);

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
          <NavLink to="/app/profile" className={({ isActive }) => `sidebar-user ${isActive ? 'active' : ''}`}>
            <UserAvatar name={user?.fullName} src={user?.avatarUrl} size={36} />
            <span className="grow">
              <span className="sidebar-user-name truncate">{user?.fullName}</span>
              <span className="sidebar-user-sub truncate">View profile</span>
            </span>
          </NavLink>
          <NavLink to="/app/settings" className="sidebar-icon-link" aria-label="Settings" title="Settings"><Settings size={18} aria-hidden /></NavLink>
          <button type="button" className="sidebar-icon-link" onClick={onLogout} aria-label="Sign out" title="Sign out"><LogOut size={18} aria-hidden /></button>
        </div>
      </aside>

      {drawer && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <aside className="drawer" aria-label="Menu" role="dialog" aria-modal="true">
            <div className="drawer-head">
              <Brand />
              <IconButton icon={X} label="Close menu" onClick={() => setDrawer(false)} />
            </div>
            <Link to="/app/profile" className="drawer-user" onClick={() => setDrawer(false)}>
              <UserAvatar name={user?.fullName} src={user?.avatarUrl} size={40} />
              <span className="grow">
                <span className="sidebar-user-name truncate">{user?.fullName}</span>
                <span className="sidebar-user-sub truncate">{user?.email}</span>
              </span>
            </Link>
            <nav>
              <NavList nav={nav} badges={badges} onNavigate={() => setDrawer(false)} withAccount />
              <button type="button" className="nav-link nav-signout" onClick={onLogout}>
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
            <IconButton icon={Bell} label={unreadNotifications ? `Notifications, ${unreadNotifications} unread` : 'Notifications'} count={unreadNotifications} onClick={() => navigate('/app/notifications')} />
            <ProfileMenu user={user} onLogout={onLogout} />
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
