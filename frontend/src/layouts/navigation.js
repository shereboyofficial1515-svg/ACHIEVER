import {
  Activity, BadgeCheck, Banknote, Bell, CalendarDays, FileBarChart, FileText, HandCoins, Home, LifeBuoy,
  MessageSquare, PiggyBank, Receipt, ScrollText, Settings, ShieldAlert, User, Users, UsersRound, Wallet, Zap,
} from 'lucide-react';

/** Navigation adapts to the roles the SERVER reports for the user. */
export function buildNavigation(has) {
  const osusu = has('OSUSU_MEMBER', 'OSUSU_ADMIN');
  const saver = has('SAVER');
  const collector = has('COLLECTOR');
  const staff = has('SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN');
  const finance = has('SUPER_ADMIN', 'ADMIN');

  const main = [
    { to: '/app', label: 'Home', icon: Home, end: true },
    osusu && { to: '/app/osusu', label: 'Osusu groups', short: 'Groups', icon: UsersRound },
    collector && { to: '/app/collector', label: 'Collector desk', short: 'Savers', icon: HandCoins },
    saver && { to: '/app/savings', label: 'My savings', short: 'Savings', icon: PiggyBank },
    { to: '/app/transactions', label: 'Payments', icon: Wallet },
    { to: '/app/bills', label: 'Bills', icon: Zap },
    { to: '/app/messages', label: 'Messages', icon: MessageSquare, badgeKey: 'messages' },
    osusu && { to: '/app/meetings', label: 'Meetings', icon: CalendarDays },
    { to: '/app/notifications', label: 'Notifications', icon: Bell, badgeKey: 'notifications' },
    { to: '/app/support', label: 'Help & disputes', icon: LifeBuoy },
    { to: '/app/profile', label: 'Profile', icon: User },
  ].filter(Boolean);

  const admin = staff
    ? [
        { to: '/app/admin', label: 'Overview', icon: Activity, end: true },
        { to: '/app/admin/users', label: 'Users', icon: Users },
        { to: '/app/admin/groups', label: 'Osusu groups', icon: UsersRound },
        { to: '/app/admin/collectors', label: 'Collectors', icon: HandCoins },
        finance && { to: '/app/admin/transactions', label: 'Transactions', icon: Receipt },
        finance && { to: '/app/admin/payouts', label: 'Payouts', icon: Banknote },
        { to: '/app/admin/bills', label: 'Bill payments', icon: Zap },
        finance && { to: '/app/admin/verification', label: 'Verification', icon: BadgeCheck },
        { to: '/app/admin/support', label: 'Support', icon: LifeBuoy },
        { to: '/app/admin/risk', label: 'Risk & review', icon: ShieldAlert },
        finance && { to: '/app/admin/audit', label: 'Audit logs', icon: ScrollText },
        finance && { to: '/app/admin/reports', label: 'Reports', icon: FileBarChart },
        { to: '/app/admin/settings', label: 'Settings', icon: Settings },
      ].filter(Boolean)
    : [];

  // Five most relevant destinations for the phone bottom bar.
  let bottom;
  if (osusu && saver && !collector) {
    bottom = ['/app', '/app/osusu', '/app/savings', '/app/messages', '/app/profile'];
  } else if (collector) {
    bottom = ['/app', '/app/collector', '/app/transactions', '/app/messages', '/app/profile'];
  } else if (saver) {
    bottom = ['/app', '/app/savings', '/app/transactions', '/app/messages', '/app/profile'];
  } else {
    bottom = ['/app', '/app/osusu', '/app/transactions', '/app/messages', '/app/profile'];
  }
  const bottomItems = bottom.map((to) => main.find((m) => m.to === to)).filter(Boolean);

  return { main, admin, bottom: bottomItems, legal: { to: '/legal', label: 'Terms & privacy', icon: FileText } };
}
