import {
  Activity, BadgeCheck, Banknote, Bell, CalendarDays, FileBarChart, FileText, HandCoins, Home, LifeBuoy,
  MessageSquare, PiggyBank, Receipt, ScrollText, Settings, ShieldAlert, Users, UsersRound, Wallet, Zap,
  ShieldCheck, Stamp, Route as RouteIcon, Eye, Trash2,
} from 'lucide-react';

const STAFF = ['SUPER_ADMIN', 'ADMIN', 'COMPLIANCE_ADMIN', 'FINANCE_ADMIN', 'DISPUTE_ADMIN', 'SECURITY_ADMIN', 'SUPPORT_ADMIN', 'AUDITOR', 'READ_ONLY_ADMIN'];

/** Navigation adapts to the roles and permissions the SERVER reports for the user. */
export function buildNavigation(has, can = () => false) {
  const osusu = has('OSUSU_MEMBER', 'OSUSU_ADMIN');
  const saver = has('SAVER');
  const collector = has('COLLECTOR');
  const staff = has(...STAFF);

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
    { to: '/app/settings', label: 'Settings', short: 'Settings', icon: Settings },
  ].filter(Boolean);

  // Each admin page appears only when the user holds a permission for it (least privilege).
  const admin = staff
    ? [
        { to: '/app/admin', label: 'Overview', icon: Activity, end: true },
        can('security.events.read', 'kyc.review', 'risk.review', 'audit.read') && { to: '/app/admin/compliance', label: 'Security & compliance', icon: ShieldCheck },
        can('users.read') && { to: '/app/admin/users', label: 'Users', icon: Users },
        { to: '/app/admin/groups', label: 'Osusu groups', icon: UsersRound },
        can('collectors.review', 'collectors.status', 'overview.read') && { to: '/app/admin/collectors', label: 'Collectors', icon: HandCoins },
        can('kyc.review') && { to: '/app/admin/verification', label: 'Verification', icon: BadgeCheck },
        can('finance.ledger.read') && { to: '/app/admin/transactions', label: 'Transactions', icon: Receipt },
        can('finance.payouts.execute') && { to: '/app/admin/payouts', label: 'Payouts', icon: Banknote },
        can('finance.reversal.request', 'finance.reversal.approve', 'collectors.status', 'risk.review', 'finance.payouts.execute') && { to: '/app/admin/approvals', label: 'Approvals', icon: Stamp },
        can('finance.ledger.read', 'support.tickets') && { to: '/app/admin/bills', label: 'Bill payments', icon: Zap },
        can('support.tickets', 'disputes.manage') && { to: '/app/admin/support', label: 'Cases & disputes', icon: LifeBuoy },
        can('trace.read') && { to: '/app/admin/trace', label: 'Trace', icon: RouteIcon },
        can('risk.review', 'security.events.read') && { to: '/app/admin/risk', label: 'Risk & review', icon: ShieldAlert },
        can('audit.read') && { to: '/app/admin/audit', label: 'Audit logs', icon: ScrollText },
        can('data_access.read') && { to: '/app/admin/data-access', label: 'Data access log', icon: Eye },
        can('privacy.requests.manage') && { to: '/app/admin/privacy', label: 'Deletion requests', icon: Trash2 },
        can('reports.platform') && { to: '/app/admin/reports', label: 'Reports', icon: FileBarChart },
        { to: '/app/admin/settings', label: 'Settings', icon: Settings },
      ].filter(Boolean)
    : [];

  // Five most relevant destinations for the phone bottom bar.
  let bottom;
  if (osusu && saver && !collector) {
    bottom = ['/app', '/app/osusu', '/app/savings', '/app/messages', '/app/settings'];
  } else if (collector) {
    bottom = ['/app', '/app/collector', '/app/transactions', '/app/messages', '/app/settings'];
  } else if (saver) {
    bottom = ['/app', '/app/savings', '/app/transactions', '/app/messages', '/app/settings'];
  } else {
    bottom = ['/app', '/app/osusu', '/app/transactions', '/app/messages', '/app/settings'];
  }
  const bottomItems = bottom.map((to) => main.find((m) => m.to === to)).filter(Boolean);

  return { main, admin, bottom: bottomItems, legal: { to: '/legal', label: 'Terms & privacy', icon: FileText } };
}
