import { Bell, CalendarDays, CircleAlert, HandCoins, MessageSquare, ShieldCheck, Wallet } from 'lucide-react';
import { relativeTime } from '../../utils/format.js';

const ICONS = {
  payments: Wallet,
  reminders: CircleAlert,
  payouts: HandCoins,
  meetings: CalendarDays,
  messages: MessageSquare,
  security: ShieldCheck,
  account: Bell,
  system: Bell,
};

export function notificationLink(n) {
  const d = n.data || {};
  if (d.group_id) return `/app/osusu/${d.group_id}`;
  if (d.plan_id) return `/app/collector/plans/${d.plan_id}`;
  if (d.bill_payment_id) return `/app/bills/${d.bill_payment_id}`;
  if (d.meeting_id) return '/app/meetings';
  if (d.ticket_id) return `/app/support/${d.ticket_id}`;
  if (d.conversation_id) return `/app/messages/${d.conversation_id}`;
  if (d.transaction_id || d.reference) return '/app/transactions';
  return null;
}

export default function NotificationItem({ n, onOpen }) {
  const Icon = ICONS[n.category] || Bell;
  const unread = !n.read_at && !n.readAt;
  return (
    <li
      className="list-item clickable"
      onClick={() => onOpen(n)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(n)}
      tabIndex={0}
      style={unread ? { background: 'var(--navy-50)' } : undefined}
    >
      <span className="list-icon" aria-hidden>
        <Icon size={18} />
      </span>
      <div className="grow">
        <p style={{ fontWeight: unread ? 600 : 500 }}>{n.title}</p>
        <p className="small muted">{n.body}</p>
      </div>
      <span className="xsmall muted nowrap">{relativeTime(n.created_at || n.createdAt)}</span>
      {unread && <span className="sr-only">Unread</span>}
    </li>
  );
}
