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
import { playMessageSound } from '../utils/sounds.js';
import { api } from '../services/api.js';

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
  const navigate = useNavigate();
  const nav = useMemo(() => buildNavigation(has, can), [has, can]);

  const refreshMessages = () =>
    api.get('/messages/conversations').then(({ data }) => setUnreadMessages(data.reduce((s, c) => s + c.unreadCount, 0))).catch(() => {});

  useEffect(() => {
    if (user?.emailVerified) refreshMessages();
  }, [user?.emailVerified, location.pathname]);
  useRealtimeEvent('message.new', (m) => {
    if (m.senderId === user?.id || location.pathname.includes(m.conversationId)) return;
    setUnreadMessages((n) => n + 1);
    // Settings → Messages: sound and preview are the user's choice.
    if (prefs.messages.messageSound) playMessageSound();
    toast.info(prefs.messages.messagePreview && m.body ? `${m.senderName || 'New message'}: ${m.body.slice(0, 80)}` : 'You have a new message');
  });
  const pageRef = usePageTransition(location.pathname);

  useEffect(() => setDrawer(false), [location.pathname]);

  const badges = { notifications: unreadNotifications, messages: unreadMessages };
  const current = [...nav.admin, ...nav.main].find((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)));

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
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
            <Link to="/app/settings" aria-label="Your profile and settings">
              <UserAvatar name={user?.fullName} src={user?.avatarUrl} size={34} />
            </Link>
          </div>
        </header>
        <main className="main" id="main" tabIndex={-1}>
          <div ref={pageRef}>
            <Suspense fallback={<Loader />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Primary">
        {nav.bottom.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <item.icon size={21} aria-hidden />
            <span>{item.short || item.label}</span>
            {item.badgeKey && badges[item.badgeKey] > 0 && <span className="badge-dot" />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
