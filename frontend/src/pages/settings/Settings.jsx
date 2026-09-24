import { useEffect, useState } from 'react';
import { NavLink, Navigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Accessibility, Bell, KeyRound, Landmark, Lock, Mail, MessageSquare, MonitorSmartphone, Phone, ShieldCheck, Trash2, User,
} from 'lucide-react';
import {
  Alert, AsyncContent, Button, Card, EmptyState, Input, KeyValue, PageHeader, Select, StatusBadge, Textarea, fieldErrors,
} from '../../components/ui/index.js';
import SecurityChallenge from '../../components/domain/SecurityChallenge.jsx';
import { Activity, Deactivate, Details, PayoutAccount, Sessions } from '../app/Profile.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { usePreferences } from '../../contexts/PreferencesContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useReveal } from '../../hooks/useMotion.js';
import { api } from '../../services/api.js';
import { formatDateTime } from '../../utils/format.js';

const SECTIONS = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'security', label: 'Security', icon: ShieldCheck },
  { key: 'password', label: 'Password', icon: KeyRound },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'phone', label: 'Phone', icon: Phone },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'messages', label: 'Messages', icon: MessageSquare },
  { key: 'accessibility', label: 'Accessibility', icon: Accessibility },
  { key: 'privacy', label: 'Privacy', icon: Lock },
  { key: 'devices', label: 'Devices & sessions', icon: MonitorSmartphone },
  { key: 'payment', label: 'Payment accounts', icon: Landmark },
  { key: 'deletion', label: 'Account deletion', icon: Trash2 },
];

/** Accessible on/off switch with a visible label and description. */
function Toggle({ label, description, checked, onChange, disabled }) {
  return (
    <div className="setting-row">
      <div className="grow">
        <strong className="small" id={`t-${label}`}>{label}</strong>
        {description && <p className="xsmall muted">{description}</p>}
      </div>
      <label className="switch">
        <input type="checkbox" role="switch" aria-labelledby={`t-${label}`} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span aria-hidden />
      </label>
    </div>
  );
}

function useSaver(section) {
  const { prefs, update } = usePreferences();
  const toast = useToast();
  const save = async (patch) => {
    try {
      await update(section, patch);
      toast.success('Setting saved');
    } catch (err) {
      toast.error(err);
    }
  };
  return [prefs[section], save];
}

// Password -------------------------------------------------------------------------------
function PasswordSection() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const submit = async ({ challengeId, code, reset }) => {
    if (form.newPassword !== form.confirm) return setError({ fields: { confirm: 'Passwords do not match' } });
    setPending(true);
    setError(null);
    try {
      await api.post('/auth/password/change', { currentPassword: form.currentPassword, newPassword: form.newPassword, challengeId, code });
      toast.success('Password changed. Other devices were signed out.');
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setDone(true);
      reset();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
    return null;
  };
  const fe = fieldErrors(error);
  return (
    <Card title="Change password">
      {done && <Alert tone="success">Your password was changed. We emailed you a confirmation and signed out your other sessions.</Alert>}
      <SecurityChallenge action="password_change" intro="For your protection, changing your password needs your current password and a security code sent to your email.">
        {(ch) => (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(ch); }}>
            {error?.message && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
            <Input label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} error={fe.currentPassword} />
            <Input label="New password" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} error={fe.newPassword} hint="At least 10 characters with upper and lower case letters and a number" />
            <Input label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={fe.confirm} />
            <div><Button type="submit" loading={pending}>Change password</Button></div>
          </form>
        )}
      </SecurityChallenge>
      <p className="xsmall muted" style={{ marginTop: 12 }}>Signed in with Google or Facebook and never set a password? Use “Forgot password” on the sign-in page to create one.</p>
    </Card>
  );
}

// Email / phone ------------------------------------------------------------------------------
function ContactSection({ kind }) {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [stage, setStage] = useState('verify');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const email = kind === 'email';
  const label = email ? 'email address' : 'phone number';

  const request = async ({ challengeId, code: challengeCode }) => {
    setPending(true);
    setError(null);
    try {
      await api.post(`/profiles/me/${kind}/change`, email ? { newEmail: value, challengeId, code: challengeCode } : { newPhone: value, challengeId, code: challengeCode });
      setStage('confirm');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const confirm = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post(`/profiles/me/${kind}/confirm`, { code });
      toast.success(`Your ${label} was changed`);
      setStage('done');
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const fe = fieldErrors(error);
  return (
    <Card title={`Change ${label}`}>
      <div className="stack">
        <KeyValue items={[[`Current ${label}`, `${email ? user.email : user.phone} ${(email ? user.emailVerified : user.phoneVerified) ? '(verified)' : '(not verified)'}`]]} />
        {error && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
        {stage === 'done' && <Alert tone="success">Done. We sent a security notice to your previous {label}.</Alert>}
        {stage === 'verify' && (
          <SecurityChallenge action={`${kind}_change`} intro={`To change your ${label} we first confirm it’s you: your password, then a code sent to your current email.`}>
            {(ch) => (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); request(ch); }}>
                <Input label={`New ${label}`} type={email ? 'email' : 'tel'} value={value} onChange={(e) => setValue(e.target.value)} error={fe.newEmail || fe.newPhone} hint={email ? 'We will send a confirmation code to this address.' : 'We will send an SMS code to this number.'} />
                <div><Button type="submit" loading={pending} disabled={!value}>Send code to new {email ? 'address' : 'number'}</Button></div>
              </form>
            )}
          </SecurityChallenge>
        )}
        {stage === 'confirm' && (
          <form className="stack" onSubmit={confirm}>
            <Alert tone="info">Enter the 6-digit code we sent to {value}.</Alert>
            <Input label="Confirmation code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} error={fe.code} />
            <div className="row-wrap">
              <Button variant="secondary" onClick={() => setStage('verify')}>Back</Button>
              <Button type="submit" loading={pending} disabled={code.length !== 6}>Confirm change</Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

// Security overview ------------------------------------------------------------------------------
function SignInMethods() {
  const toast = useToast();
  const [params] = useSearchParams();
  const data = useAsync(() => api.get('/auth/identities'), []);
  useEffect(() => {
    if (params.get('linked')) toast.success(`${params.get('linked') === 'google' ? 'Google' : 'Facebook'} sign-in linked`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const link = async (provider) => {
    try {
      const { data: res } = await api.post(`/auth/oauth/${provider}/link`);
      window.location.assign(res.url);
    } catch (err) {
      toast.error(err);
    }
  };
  const unlink = async (provider) => {
    try {
      await api.del(`/auth/identities/${provider}`);
      toast.success('Sign-in method removed');
      data.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const d = data.data;
  const has = (p) => d?.methods.some((m) => m.provider === p);
  const label = { email: 'Email and password', google: 'Google', facebook: 'Facebook' };
  return (
    <Card title="Sign-in methods">
      <AsyncContent loading={data.loading} error={data.error} onRetry={data.reload}>
        {d && (
          <div className="stack">
            {d.methods.map((m) => (
              <div key={m.provider} className="setting-row">
                <div className="grow">
                  <strong className="small">{label[m.provider] || m.provider}</strong>
                  <p className="xsmall muted">{m.email || ''}{m.linkedAt ? ` · linked ${formatDateTime(m.linkedAt)}` : ''}</p>
                </div>
                {m.provider !== 'email' && d.methods.length > 1 && <Button size="sm" variant="ghost" onClick={() => unlink(m.provider)}>Remove</Button>}
              </div>
            ))}
            {['google', 'facebook'].filter((p) => !has(p)).map((p) => (
              <div key={p} className="setting-row">
                <div className="grow">
                  <strong className="small">{label[p]}</strong>
                  <p className="xsmall muted">{d.providers[p] ? 'Not linked' : 'Not available yet'}</p>
                </div>
                {d.providers[p] && <Button size="sm" variant="secondary" onClick={() => link(p)}>Link</Button>}
              </div>
            ))}
            <p className="xsmall muted">Linking needs your password again. Accounts are only ever linked from here while you are signed in — never automatically by name.</p>
          </div>
        )}
      </AsyncContent>
    </Card>
  );
}

function SecuritySection() {
  const [security, save] = useSaver('security');
  return (
    <div className="stack-lg">
      <SignInMethods />
      <Card title="Sign-in alerts">
        <Select
          label="Email me when"
          value={security.loginAlerts}
          onChange={(e) => save({ loginAlerts: e.target.value })}
          options={[
            { value: 'new_device', label: 'My account is used on a new device (recommended)' },
            { value: 'every_sign_in', label: 'Every time someone signs in' },
          ]}
        />
        <p className="xsmall muted" style={{ marginTop: 8 }}>Alerts for password, email, phone and payout-account changes are always sent and cannot be turned off.</p>
      </Card>
      <Activity />
    </div>
  );
}

// Notifications --------------------------------------------------------------------------------
const GROUPS = [
  { title: 'Transactional', note: 'Money movement and obligations on your account.', keys: [['payments', 'Payment confirmations'], ['reminders', 'Contribution reminders'], ['payouts', 'Payouts, returns and commissions'], ['groups', 'Group membership updates'], ['meetings', 'Meetings'], ['support', 'Support cases and disputes'], ['account', 'Account updates'], ['messages', 'Missed calls and messages']] },
  { title: 'Updates & marketing', note: 'Optional. You can unsubscribe from any of these emails.', keys: [['system', 'Platform notices'], ['marketing', 'News and offers']] },
];

function NotificationsSection() {
  const toast = useToast();
  const prefs = useAsync(() => api.get('/notifications/preferences'), []);
  const [state, setState] = useState(null);
  const [pending, setPending] = useState(false);
  useEffect(() => { if (prefs.data) setState(prefs.data); }, [prefs.data]);
  const save = async () => {
    setPending(true);
    try {
      const { data } = await api.put('/notifications/preferences', state);
      setState(data);
      toast.success('Notification settings saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  const setCat = (key, channel, v) => setState({ ...state, categories: { ...state.categories, [key]: { ...state.categories[key], [channel]: v } } });
  return (
    <Card title="Notifications">
      <AsyncContent loading={prefs.loading || !state} error={prefs.error} onRetry={prefs.reload}>
        {state && (
          <div className="stack">
            <Alert tone="info" icon={ShieldCheck}>
              <strong>Security alerts are always on.</strong> Sign-ins from new devices and changes to your password, email, phone or payout account are always sent by email (and SMS when your phone is verified).
            </Alert>
            <p className="small muted">In-app notifications are always on. Push notifications are not available yet.</p>
            <Toggle label="Email notifications" description="Master switch for optional email" checked={state.emailEnabled} onChange={(v) => setState({ ...state, emailEnabled: v })} />
            <Toggle label="SMS notifications" description="Master switch for optional SMS (daily limit applies)" checked={state.smsEnabled} onChange={(v) => setState({ ...state, smsEnabled: v })} />
            {GROUPS.map((g) => (
              <div key={g.title} className="table-wrap">
                <h3 style={{ fontSize: 15, margin: '12px 0 2px' }}>{g.title}</h3>
                <p className="xsmall muted">{g.note}</p>
                <table className="table">
                  <thead><tr><th>Category</th><th>In-app</th><th>Email</th><th>SMS</th></tr></thead>
                  <tbody>
                    {g.keys.map(([key, name]) => (
                      <tr key={key}>
                        <td>{name}</td>
                        <td><input type="checkbox" checked disabled aria-label={`${name} in-app (always on)`} /></td>
                        <td><input type="checkbox" aria-label={`${name} by email`} checked={Boolean(state.categories[key]?.email)} disabled={!state.emailEnabled} onChange={(e) => setCat(key, 'email', e.target.checked)} /></td>
                        <td><input type="checkbox" aria-label={`${name} by SMS`} checked={Boolean(state.categories[key]?.sms)} disabled={!state.smsEnabled} onChange={(e) => setCat(key, 'sms', e.target.checked)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div><Button onClick={save} loading={pending}>Save notification settings</Button></div>
          </div>
        )}
      </AsyncContent>
    </Card>
  );
}

// Messages -----------------------------------------------------------------------------------
function MessagesSection() {
  const [m, save] = useSaver('messages');
  return (
    <Card title="Messages & calls">
      <Toggle label="Message sound" description="Play a short sound when a new message arrives in another conversation" checked={m.messageSound} onChange={(v) => save({ messageSound: v })} />
      <Toggle label="Show message previews" description="Include the message text in on-screen alerts. Turn off on shared devices." checked={m.messagePreview} onChange={(v) => save({ messagePreview: v })} />
      <Toggle label="Call ringtone" description="Ring for incoming voice and video calls (the call alert is always shown)" checked={m.callRingtone} onChange={(v) => save({ callRingtone: v })} />
      <Toggle label="Load photos automatically" description="Off: photos in chats load only when you tap them (saves data)" checked={m.autoLoadImages} onChange={(v) => save({ autoLoadImages: v })} />
      <Toggle label="Read receipts" description="Let others see when you have read their messages. If off, you won’t see theirs either." checked={m.readReceipts} onChange={(v) => save({ readReceipts: v })} />
      <p className="xsmall muted" style={{ marginTop: 8 }}>Email/SMS for missed calls and messages is under Notifications.</p>
    </Card>
  );
}

// Accessibility ---------------------------------------------------------------------------------
function AccessibilitySection() {
  const [a, save] = useSaver('accessibility');
  const ref = useReveal();
  return (
    <Card title="Accessibility">
      <div className="stack" ref={ref}>
        <p className="small muted">These settings apply across ACHIEVER on this device immediately, and follow your account when you sign in elsewhere.</p>
        <Select
          label="Text size"
          value={String(a.fontScale)}
          onChange={(e) => save({ fontScale: Number(e.target.value) })}
          options={[{ value: '0.9', label: 'Small' }, { value: '1', label: 'Default' }, { value: '1.125', label: 'Large' }, { value: '1.25', label: 'Larger' }, { value: '1.5', label: 'Largest' }]}
        />
        <Select
          label="Motion and animation"
          value={a.reducedMotion}
          onChange={(e) => save({ reducedMotion: e.target.value })}
          options={[
            { value: 'system', label: 'Follow my device setting' },
            { value: 'reduce', label: 'Reduce motion (no animations)' },
            { value: 'full', label: 'Allow subtle animations' },
          ]}
          hint="Reduced motion removes page transitions and entrance effects. Nothing ever waits for an animation."
        />
        <Toggle label="High contrast" description="Darker text and stronger borders" checked={a.highContrast} onChange={(v) => save({ highContrast: v })} />
        <Toggle label="Larger touch targets" description="Bigger buttons, fields and checkboxes" checked={a.largerTargets} onChange={(v) => save({ largerTargets: v })} />
        <Toggle label="Underline links" description="Don’t rely on colour to show links" checked={a.underlineLinks} onChange={(v) => save({ underlineLinks: v })} />
        <Toggle label="Strong focus indicator" description="A thick outline around whatever has keyboard focus" checked={a.strongFocus} onChange={(v) => save({ strongFocus: v })} />
        <p className="xsmall muted">Keyboard: press Tab to move, Enter or Space to activate, Escape to close dialogs. “Skip to main content” is the first Tab stop. Statuses always include text, not colour alone.</p>
      </div>
    </Card>
  );
}

// Privacy ------------------------------------------------------------------------------------
function PrivacySection() {
  const { user } = useAuth();
  const [p, save] = useSaver('privacy');
  return (
    <div className="stack-lg">
      <Card title="Privacy">
        <Toggle label="Show when I’m online" description="If off, others see you as offline in chats and contacts" checked={p.showOnlineStatus} onChange={(v) => save({ showOnlineStatus: v })} />
        <div className="setting-row">
          <div className="grow">
            <strong className="small">Public trust profile</strong>
            <p className="xsmall muted">Members see your display name, verification badges and on-time record only — never your contact details, address or balances. Location display is set in Settings → Profile.</p>
          </div>
          <Button size="sm" variant="secondary" to={`/app/people/${user.id}`}>View</Button>
        </div>
      </Card>
      <Card title="Your data">
        <p className="small">Read how ACHIEVER uses and protects your data in the <a href="/privacy.html">Privacy Policy</a>. You can ask us to delete your account or optional personal data from <NavLink to="/app/settings/deletion">Account deletion</NavLink>.</p>
      </Card>
    </div>
  );
}

// Deletion -------------------------------------------------------------------------------------
function DeletionSection() {
  const toast = useToast();
  const requests = useAsync(() => api.get('/privacy/deletion-requests'), []);
  const policy = useAsync(() => api.get('/privacy/policy'), []);
  const [type, setType] = useState('account');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const submit = async ({ challengeId, code, reset }) => {
    setPending(true);
    setError(null);
    try {
      await api.post('/privacy/deletion-requests', { type, reason: reason || undefined, challengeId, code });
      toast.success('Request received');
      reset();
      requests.reload();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const cancel = async (id) => {
    try {
      await api.post(`/privacy/deletion-requests/${id}/cancel`);
      toast.success('Request cancelled');
      requests.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div className="stack-lg">
      <Card title="Your requests">
        <AsyncContent loading={requests.loading} error={requests.error} onRetry={requests.reload} empty={!requests.data?.length} emptyState={<EmptyState title="No deletion requests" />}>
          <ul className="list">
            {(requests.data || []).map((r) => (
              <li key={r.id} className="list-item">
                <div className="grow">
                  <strong className="small">{r.type === 'account' ? 'Delete my account' : 'Delete optional personal data'}</strong> <StatusBadge status={r.status} />
                  <div className="xsmall muted">Requested {formatDateTime(r.createdAt)}{r.canCancel ? ` · can be cancelled until ${formatDateTime(r.cancellableUntil)}` : ''}</div>
                  {r.decisionNote && <div className="small">{r.decisionNote}</div>}
                </div>
                {r.canCancel && <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>Cancel</Button>}
              </li>
            ))}
          </ul>
        </AsyncContent>
      </Card>
      <Card title="Request deletion">
        <div className="stack">
          <p className="small">
            <strong>Account deletion</strong> closes your account and erases optional personal data. <strong>Personal data deletion</strong> erases optional data but keeps your account open.
            Both can be cancelled for 7 days. Accounts with open groups, savings plans or payouts must settle them first.
          </p>
          {policy.data && (
            <Alert tone="info">
              <strong>We must keep:</strong> {policy.data.retained.join('; ')}. This is required for legal, financial, dispute and fraud-prevention purposes. See <a href="/delete-data.html">how deletion works</a>.
            </Alert>
          )}
          <Select label="What would you like to delete?" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: 'account', label: 'My account' }, { value: 'personal_data', label: 'Optional personal data only' }]} />
          <Textarea label="Reason (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && <Alert tone="danger">{error.message}</Alert>}
          <SecurityChallenge action="account_deletion" intro="Deletion requests need your password and a security code, so nobody else can request them.">
            {(ch) => <div><Button variant="danger" loading={pending} onClick={() => submit(ch)}>Submit deletion request</Button></div>}
          </SecurityChallenge>
        </div>
      </Card>
      <Deactivate />
    </div>
  );
}

export default function Settings() {
  const { section = 'profile' } = useParams();
  if (!SECTIONS.some((s) => s.key === section)) return <Navigate to="/app/settings/profile" replace />;
  const current = SECTIONS.find((s) => s.key === section);
  return (
    <div className="stack-lg">
      <PageHeader title="Settings" subtitle={current.label} />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <NavLink key={s.key} to={`/app/settings/${s.key}`} className={({ isActive }) => (isActive ? 'active' : '')}>
              <s.icon size={16} aria-hidden /> {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="stack-lg" style={{ minWidth: 0 }}>
          {section === 'profile' && <Details />}
          {section === 'security' && <SecuritySection />}
          {section === 'password' && <PasswordSection />}
          {section === 'email' && <ContactSection kind="email" key="email" />}
          {section === 'phone' && <ContactSection kind="phone" key="phone" />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'messages' && <MessagesSection />}
          {section === 'accessibility' && <AccessibilitySection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'devices' && <Sessions />}
          {section === 'payment' && <PayoutAccount />}
          {section === 'deletion' && <DeletionSection />}
        </div>
      </div>
    </div>
  );
}
