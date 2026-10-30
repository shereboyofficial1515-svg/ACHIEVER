import {
  BookOpen, Bell, CalendarDays, FileText, Gift, HandCoins, Home, LifeBuoy, MessageSquare, PiggyBank, Receipt, Settings, UserRound, UsersRound, Wallet, Zap,
} from 'lucide-react';

/**
 * Navigation adapts to the roles the SERVER reports for the user.
 * Items are grouped into sections for the desktop sidebar and the phone drawer;
 * `main` keeps the flat list (page titles, badges), `bottom` the phone bar.
 */
export function buildNavigation(has) {
  const osusu = has('OSUSU_MEMBER', 'OSUSU_ADMIN');
  const saver = has('SAVER');
  const collector = has('COLLECTOR');

  const home = { to: '/app', label: 'Home', icon: Home, end: true };
  const savings = [
    osusu && { to: '/app/osusu', label: 'Osusu groups', short: 'Groups', icon: UsersRound },
    collector && { to: '/app/collector', label: 'Collector desk', short: 'Savers', icon: HandCoins },
    saver && { to: '/app/savings', label: 'My savings', short: 'Savings', icon: PiggyBank },
    osusu && { to: '/app/meetings', label: 'Meetings', icon: CalendarDays },
  ].filter(Boolean);
  const money = [
    { to: '/app/wallet', label: 'ACHIEVER Wallet', short: 'Wallet', icon: Wallet },
    { to: '/app/transactions', label: 'Payments', icon: Receipt },
    { to: '/app/bills', label: 'Bills & Services', short: 'Bills', icon: Zap },
  ];
  const community = [
    { to: '/app/messages', label: 'Messages', icon: MessageSquare, badgeKey: 'messages' },
    { to: '/app/notifications', label: 'Notifications', icon: Bell, badgeKey: 'notifications' },
    { to: '/app/referrals', label: 'Refer & Earn', short: 'Refer', icon: Gift },
  ];
  const support = [
    { to: '/app/help', label: 'Help Center', icon: BookOpen },
    { to: '/app/support', label: 'Disputes & support', icon: LifeBuoy },
  ];
  const account = [
    { to: '/app/profile', label: 'My profile', short: 'Profile', icon: UserRound },
    { to: '/app/settings', label: 'Settings', short: 'Settings', icon: Settings },
  ];

  const sections = [
    { id: 'home', items: [home] },
    savings.length > 0 && { id: 'savings', label: 'Savings', items: savings },
    { id: 'money', label: 'Money', items: money },
    { id: 'community', label: 'Community', items: community },
    { id: 'support', label: 'Support', items: support },
  ].filter(Boolean);

  const main = [home, ...savings, ...money, ...community, ...support, ...account];

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

  return { main, sections, account, admin, bottom: bottomItems, legal: { to: '/legal', label: 'Terms & privacy', icon: FileText } };
}
