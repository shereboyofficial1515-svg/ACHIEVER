import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellOff, CheckCheck } from 'lucide-react';
import { AsyncContent, Button, Card, EmptyState, PageHeader, Pagination, SkeletonList, Tabs } from '../../components/ui/index.js';
import NotificationItem, { notificationLink } from '../../components/domain/NotificationItem.jsx';
import { useRealtime, useRealtimeEvent } from '../../contexts/RealtimeContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { useReveal } from '../../hooks/useMotion.js';

export default function Notifications() {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const { refreshUnread, setUnreadNotifications } = useRealtime();
  const list = useAsync(() => api.get('/notifications', { page, pageSize: 20, unreadOnly: filter === 'unread' }), [page, filter]);
  const listRef = useReveal({ children: true, deps: [list.data] });

  useRealtimeEvent('notification.new', () => {
    if (page === 1) list.reload();
  });

  const open = async (n) => {
    if (!n.read_at) {
      await api.post(`/notifications/${n.id}/read`).catch(() => {});
      refreshUnread();
    }
    const link = notificationLink(n);
    if (link) navigate(link);
    else list.reload();
  };

  const readAll = async () => {
    await api.post('/notifications/read-all');
    setUnreadNotifications(0);
    list.reload();
  };

  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <PageHeader title="Notifications" actions={<Button variant="secondary" size="sm" icon={CheckCheck} onClick={readAll}>Mark all as read</Button>} />
      <Card flush>
        <div style={{ padding: '0 16px' }}>
          <Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} tabs={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} />
        </div>
        <AsyncContent
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={!list.data?.length}
          skeleton={<SkeletonList />}
          emptyState={<EmptyState icon={BellOff} title="No notifications" message="Reminders, payment confirmations and payout updates will appear here." />}
        >
          <ul className="list" ref={listRef}>
            {list.data?.map((n) => (
              <NotificationItem key={n.id} n={n} onOpen={open} />
            ))}
          </ul>
          <Pagination meta={list.meta} onPage={setPage} />
        </AsyncContent>
      </Card>
    </div>
  );
}
