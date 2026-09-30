import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Alert, Button, Card, Input, PageHeader } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';
import { useConfirm } from '../../components/ui/ConfirmProvider.jsx';
import OsusuTerms from '../../components/domain/OsusuTerms.jsx';

export default function JoinGroup() {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useAuth();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [terms, setTerms] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const confirmAction = useConfirm();

  // Step 1: show the group's terms (amount, schedule, grace period, charges) before joining.
  const viewTerms = async () => {
    setPending(true);
    setError(null);
    try {
      const { data } = await api.get('/osusu/groups/terms', { code });
      setTerms(data);
      setAccepted(false);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!terms) return viewTerms();
    if (!(await confirmAction({ type: 'join_group' }))) return undefined;
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post('/osusu/groups/join', { joinCode: code, acceptTerms: true });
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
            onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setTerms(null); }}
            style={{ letterSpacing: '0.3em', fontWeight: 600, textTransform: 'uppercase' }}
          />
          <Alert tone="info">
            Joining an Osusu group is a commitment: you contribute every cycle until every member has been paid, including after you receive
            your own payout.
          </Alert>
          {terms && <OsusuTerms terms={terms} accepted={accepted} onAccept={setAccepted} />}
          <Button type="submit" icon={KeyRound} loading={pending} disabled={code.length !== 8 || (terms && !accepted)}>
            {terms ? 'Join group' : 'Review group terms'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
