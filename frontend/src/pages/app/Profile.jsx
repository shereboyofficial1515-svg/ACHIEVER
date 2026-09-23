import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Landmark, LogOut } from 'lucide-react';
import {
  Alert, AsyncContent, Button, Card, Checkbox, Input, KeyValue, PageHeader, Select, StatusBadge, Tabs, Textarea, UserAvatar, fieldErrors,
} from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDate } from '../../utils/format.js';

const ROLE_LABEL = {
  SUPER_ADMIN: 'Super admin', ADMIN: 'Platform admin', SUPPORT_ADMIN: 'Support', OSUSU_ADMIN: 'Osusu organiser',
  OSUSU_MEMBER: 'Osusu member', COLLECTOR: 'Collector', SAVER: 'Saver',
};

function Details() {
  const { user, setUser, has } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ fullName: user.fullName, address: '', dateOfBirth: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const me = useAsync(() => api.get('/profiles/me'), []);

  useEffect(() => {
    if (me.data) setForm({ fullName: me.data.fullName, address: me.data.address || '', dateOfBirth: me.data.dateOfBirth || '' });
  }, [me.data]);

  const save = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api.patch('/profiles/me', { fullName: form.fullName, address: form.address || null, dateOfBirth: form.dateOfBirth || null });
      setUser(data);
      toast.success('Profile saved');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const onAvatar = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { data } = await api.upload('/profiles/me/avatar', file);
      setUser({ ...user, avatarUrl: data.avatarUrl });
      toast.success('Photo updated');
    } catch (err) {
      toast.error(err);
    }
  };

  const addRole = async (role) => {
    try {
      await api.post('/users/me/roles', { role });
      const { data } = await api.get('/auth/me');
      setUser(data);
      toast.success('Role added');
    } catch (err) {
      toast.error(err);
    }
  };

  const fe = fieldErrors(error);
  return (
    <div className="grid-2">
      <Card title="Personal details">
        <form className="stack" onSubmit={save}>
          <div className="row">
            <UserAvatar name={user.fullName} src={user.avatarUrl} size={64} />
            <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
              <Camera size={15} /> Change photo
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onAvatar} />
            </label>
          </div>
          <Input label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} error={fe.fullName} />
          <Input label="Email" value={user.email} disabled hint={user.emailVerified ? 'Verified' : 'Not verified'} />
          <Input label="Phone" value={user.phone} disabled hint={user.phoneVerified ? 'Verified' : 'Not verified — verify from Operator verification'} />
          <Input label="Date of birth" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} error={fe.dateOfBirth} />
          <Textarea label="Address" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} error={fe.address} />
          <div>
            <Button type="submit" loading={pending}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Roles and access">
        <div className="stack">
          <div className="row-wrap">
            {user.roles.map((r) => (
              <span key={r} className="chip">
                {ROLE_LABEL[r]}
              </span>
            ))}
          </div>
          <p className="small muted">Add a role to use more of ACHIEVER. Organiser and collector roles require identity verification.</p>
          <div className="row-wrap">
            {!has('OSUSU_MEMBER') && <Button size="sm" variant="secondary" onClick={() => addRole('OSUSU_MEMBER')}>Become an Osusu member</Button>}
            {!has('OSUSU_ADMIN') && <Button size="sm" variant="secondary" onClick={() => addRole('OSUSU_ADMIN')}>Become an organiser</Button>}
            {!has('SAVER') && <Button size="sm" variant="secondary" onClick={() => addRole('SAVER')}>Become a saver</Button>}
            {!has('COLLECTOR') && <Button size="sm" variant="secondary" onClick={() => addRole('COLLECTOR')}>Become a collector</Button>}
          </div>
          {has('OSUSU_ADMIN', 'COLLECTOR') && (
            <Button to="/app/onboarding" variant="ghost" size="sm">
              Operator verification status
            </Button>
          )}
          <p className="xsmall muted">Member since {formatDate(me.data?.createdAt)}</p>
        </div>
      </Card>
    </div>
  );
}

function PayoutAccount() {
  const toast = useToast();
  const account = useAsync(() => api.get('/users/me/payout-account'), []);
  const banks = useAsync(() => api.get('/payments/banks'), []);
  const [form, setForm] = useState({ bankCode: '', accountNumber: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.put('/users/me/payout-account', form);
      toast.success('Account verified and saved');
      setForm({ bankCode: '', accountNumber: '' });
      setEditing(false);
      account.reload();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const fe = fieldErrors(error);
  return (
    <Card title="Payout account" className="grow">
      <AsyncContent loading={account.loading} error={account.error} onRetry={account.reload}>
        <div className="stack">
          <p className="small muted">Osusu payouts, savings returns and commissions are sent to this account. The account name is confirmed with your bank.</p>
          {account.data && !editing ? (
            <>
              <KeyValue
                items={[
                  ['Bank', account.data.bankName],
                  ['Account name', account.data.accountName],
                  ['Account number', `•••• ${account.data.last4}`],
                  ['Verified', formatDate(account.data.verifiedAt)],
                ]}
              />
              <div>
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  Change account
                </Button>
              </div>
            </>
          ) : (
            <form className="stack" onSubmit={save}>
              {error && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
              <Select
                label="Bank"
                placeholder={banks.loading ? 'Loading banks...' : 'Select your bank'}
                value={form.bankCode}
                onChange={(e) => setForm({ ...form, bankCode: e.target.value })}
                options={(banks.data || []).map((b) => ({ value: b.code, label: b.name }))}
                error={fe.bankCode || (banks.error ? 'Could not load banks' : undefined)}
              />
              <Input label="Account number (NUBAN)" inputMode="numeric" maxLength={10} value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value.replace(/\D/g, '') })} error={fe.accountNumber} />
              <Alert tone="info" icon={Landmark}>
                For your protection, changing your payout account sends a security alert to your email and phone.
              </Alert>
              <div className="row">
                {account.data && (
                  <Button variant="secondary" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" loading={pending} loadingText="Verifying with bank..." disabled={!form.bankCode || form.accountNumber.length !== 10}>
                  Verify and save
                </Button>
              </div>
            </form>
          )}
        </div>
      </AsyncContent>
    </Card>
  );
}

function Security() {
  const toast = useToast();
  const { logout } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setError({ fields: { confirm: 'Passwords do not match' } });
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.post('/auth/password/change', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Password changed. Other devices were signed out.');
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const fe = fieldErrors(error);
  return (
    <div className="grid-2">
      <Card title="Change password">
        <form className="stack" onSubmit={submit}>
          {error?.message && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
          <Input label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} error={fe.currentPassword} />
          <Input label="New password" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} error={fe.newPassword} hint="At least 10 characters with upper and lower case letters and a number" />
          <Input label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={fe.confirm} />
          <div>
            <Button type="submit" loading={pending}>
              Change password
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Session">
        <div className="stack">
          <p className="small muted">Your session is stored in a secure, HTTP-only cookie and ends automatically after a period of time. Changing your password signs out every other device.</p>
          <div>
            <Button variant="secondary" icon={LogOut} onClick={logout}>
              Sign out of this device
            </Button>
          </div>
          <p className="small">
            Something wrong? <Link to="/app/support">Report unauthorised activity</Link>
          </p>
        </div>
      </Card>
    </div>
  );
}

const CATEGORY_LABEL = {
  payments: 'Payment confirmations', reminders: 'Contribution reminders', payouts: 'Payouts and returns',
  meetings: 'Meetings', messages: 'Messages', account: 'Account updates', system: 'Platform notices',
};

function NotificationPrefs() {
  const toast = useToast();
  const prefs = useAsync(() => api.get('/notifications/preferences'), []);
  const [state, setState] = useState(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (prefs.data) setState(prefs.data);
  }, [prefs.data]);

  const save = async () => {
    setPending(true);
    try {
      const { data } = await api.put('/notifications/preferences', state);
      setState(data);
      toast.success('Preferences saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card title="Notification preferences">
      <AsyncContent loading={prefs.loading || !state} error={prefs.error} onRetry={prefs.reload}>
        {state && (
          <div className="stack">
            <p className="small muted">In-app notifications are always on. Security alerts are always sent by email and SMS.</p>
            <div className="row-wrap">
              <Checkbox label="Email notifications" checked={state.emailEnabled} onChange={(e) => setState({ ...state, emailEnabled: e.target.checked })} />
              <Checkbox label="SMS notifications" checked={state.smsEnabled} onChange={(e) => setState({ ...state, smsEnabled: e.target.checked })} />
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Email</th>
                    <th>SMS</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(state.categories).map(([key, v]) => (
                    <tr key={key}>
                      <td>{CATEGORY_LABEL[key]}</td>
                      <td>
                        <input type="checkbox" aria-label={`${CATEGORY_LABEL[key]} by email`} checked={v.email} disabled={!state.emailEnabled} onChange={(e) => setState({ ...state, categories: { ...state.categories, [key]: { ...v, email: e.target.checked } } })} />
                      </td>
                      <td>
                        <input type="checkbox" aria-label={`${CATEGORY_LABEL[key]} by SMS`} checked={v.sms} disabled={!state.smsEnabled} onChange={(e) => setState({ ...state, categories: { ...state.categories, [key]: { ...v, sms: e.target.checked } } })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <Button onClick={save} loading={pending}>
                Save preferences
              </Button>
            </div>
          </div>
        )}
      </AsyncContent>
    </Card>
  );
}

export default function Profile() {
  const [tab, setTab] = useState('details');
  const { user } = useAuth();
  return (
    <div className="stack-lg">
      <PageHeader title="Profile" subtitle={<>Account status: <StatusBadge status={user.status} /></>} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'details', label: 'Details' },
          { value: 'payout', label: 'Payout account' },
          { value: 'notifications', label: 'Notifications' },
          { value: 'security', label: 'Security' },
        ]}
      />
      {tab === 'details' && <Details />}
      {tab === 'payout' && <PayoutAccount />}
      {tab === 'notifications' && <NotificationPrefs />}
      {tab === 'security' && <Security />}
    </div>
  );
}
