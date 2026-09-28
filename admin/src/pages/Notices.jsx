import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import { Button, Card, Input, PageHeader, Select, Textarea } from '../components/ui/index.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../services/api.js';

export default function Notices() {
  const toast = useToast();
  const [form, setForm] = useState({ title: '', body: '', role: '' });
  const [pending, setPending] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setPending(true);
    try {
      const { data } = await api.post('/admin/notifications/broadcast', { title: form.title, body: form.body, role: form.role || undefined });
      toast.success(`Notice sent to ${data.recipients} user(s)`);
      setForm({ title: '', body: '', role: '' });
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="stack-lg">
      <PageHeader title="Platform notices" subtitle="In-app notices (no email or SMS) for maintenance windows or policy updates" />
      <Card>
        <form className="stack" onSubmit={send} style={{ maxWidth: 640 }}>
          <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea label="Message" rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <Select label="Audience" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
            options={[{ value: '', label: 'All active users' }, ...['OSUSU_ADMIN', 'OSUSU_MEMBER', 'COLLECTOR', 'SAVER'].map((r) => ({ value: r, label: r }))]} />
          <div>
            <Button type="submit" icon={Megaphone} loading={pending} disabled={form.title.length < 3 || form.body.length < 3}>Send notice</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
