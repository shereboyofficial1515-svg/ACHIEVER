import {
  BookOpen, Bell, CalendarDays, FileText, Gift, HandCoins, Home, LifeBuoy, MessageSquare, PiggyBank, Receipt, Settings, UserRound, UsersRound, Wallet, Zap,
} from 'lucide-react';

/** Navigation adapts to the roles and permissions the SERVER reports for the user. */
export function buildNavigation(has) {
  const osusu = has('OSUSU_MEMBER', 'OSUSU_ADMIN');
  const saver = has('SAVER');
  const collector = has('COLLECTOR');

  const main = [
    { to: '/app', label: 'Home', icon: Home, end: true },
    osusu && { to: '/app/osusu', label: 'Osusu groups', short: 'Groups', icon: UsersRound },
    collector && { to: '/app/collector', label: 'Collector desk', short: 'Savers', icon: HandCoins },
    saver && { to: '/app/savings', label: 'My savings', short: 'Savings', icon: PiggyBank },
    { to: '/app/wallet', label: 'ACHIEVER Wallet', short: 'Wallet', icon: Wallet },
    { to: '/app/transactions', label: 'Payments', icon: Receipt },
    { to: '/app/bills', label: 'Bills & Services', short: 'Bills', icon: Zap },
    { to: '/app/referrals', label: 'Refer & Earn', short: 'Refer', icon: Gift },
    { to: '/app/messages', label: 'Messages', icon: MessageSquare, badgeKey: 'messages' },
    osusu && { to: '/app/meetings', label: 'Meetings', icon: CalendarDays },
    { to: '/app/notifications', label: 'Notifications', icon: Bell, badgeKey: 'notifications' },
    { to: '/app/help', label: 'Help Center', icon: BookOpen },
    { to: '/app/support', label: 'Disputes & support', icon: LifeBuoy },
    { to: '/app/profile', label: 'My profile', short: 'Profile', icon: UserRound },
    { to: '/app/settings', label: 'Settings', short: 'Settings', icon: Settings },
  ].filter(Boolean);

  // Site administration is a separate application (admin/), never part of the member app.
  const admin = [];

  // Five most relevant destinations for the phone bottom bar.
  let bottom;
  if (osusu && saver && !collector) {
    bottom = ['/app', '/app/osusu', '/app/savings', '/app/messages', '/app/profile'];
  } else if (collector) {
    bottom = ['/app', '/app/collector', '/app/wallet', '/app/messages', '/app/profile'];
  } else if (saver) {
    bottom = ['/app', '/app/savings', '/app/wallet', '/app/messages', '/app/profile'];
  } else {
    bottom = ['/app', '/app/osusu', '/app/wallet', '/app/messages', '/app/profile'];
  }
  const bottomItems = bottom.map((to) => main.find((m) => m.to === to)).filter(Boolean);

  return { main, admin, bottom: bottomItems, legal: { to: '/legal', label: 'Terms & privacy', icon: FileText } };
}
