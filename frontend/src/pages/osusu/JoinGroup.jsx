import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Alert, Button, Card, Input, PageHeader } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';

export default function JoinGroup() {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useAuth();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post('/osusu/groups/join', { joinCode: code });
      toast.success(data.status === 'active' ? 'You have joined the group' : 'Request sent. The organiser will review it.');
      refresh();
      navigate(`/app/osusu/${data.groupId}`, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="stack-lg" style={{ maxWidth: 560 }}>
      <PageHeader title="Join a group" back={{ to: '/app/osusu', label: 'Groups' }} />
      <Card>
        <form className="stack" onSubmit={submit}>
          <p className="muted small">Enter the 8-character code your organiser shared with you.</p>
          {error && <Alert tone="danger">{error.message}</Alert>}
          <Input
            label="Group code"
            value={code}
            maxLength={8}
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            style={{ letterSpacing: '0.3em', fontWeight: 600, textTransform: 'uppercase' }}
          />
          <Alert tone="info">
            Joining an Osusu group is a commitment: you contribute every cycle until every member has been paid, including after you receive
            your own payout.
          </Alert>
          <Button type="submit" icon={KeyRound} loading={pending} disabled={code.length !== 8}>
            Join group
          </Button>
        </form>
      </Card>
    </div>
  );
}
