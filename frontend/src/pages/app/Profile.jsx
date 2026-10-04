import { resizeImageFile } from '../../utils/imageResize.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Copy, Gift, Landmark, Lock, Mail, MonitorSmartphone, Pencil, Settings as SettingsIcon, Share2, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import {
  Alert, AsyncContent, BankSelect, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, KeyValue, PageHeader, Select, Skeleton, StatusBadge, Textarea,
  UserAvatar, fieldErrors,
} from '../../components/ui/index.js';
import LocationPicker from '../../components/domain/LocationPicker.jsx';
import { GroupListItem, ProfileListItem, ProfileSection, StatGrid, VerificationCard, VerifiedBadge, WalletSummaryCard } from '../../components/domain/ProfileParts.jsx';
import { shareContent } from '../../platform/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { useConfirm } from '../../components/ui/ConfirmProvider.jsx';
import { formatDate, formatDateTime } from '../../utils/format.js';

const ROLE_LABEL = {
  SUPER_ADMIN: 'Super admin', ADMIN: 'Platform admin', COMPLIANCE_ADMIN: 'Compliance', FINANCE_ADMIN: 'Finance',
  DISPUTE_ADMIN: 'Disputes', SECURITY_ADMIN: 'Security', SUPPORT_ADMIN: 'Support', AUDITOR: 'Auditor', READ_ONLY_ADMIN: 'Read-only admin',
  OSUSU_ADMIN: 'Osusu organiser', OSUSU_MEMBER: 'Osusu member', COLLECTOR: 'Collector', SAVER: 'Saver',
};
const GENDERS = [
  { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];
const EMPLOYMENT = [
  { value: 'employed', label: 'Employed' }, { value: 'self_employed', label: 'Self-employed' }, { value: 'business_owner', label: 'Business owner / trader' },
  { value: 'student', label: 'Student' }, { value: 'unemployed', label: 'Not currently working' }, { value: 'retired', label: 'Retired' }, { value: 'other', label: 'Other' },
];

function toForm(p) {
  return {
    firstName: p.firstName || '', middleName: p.middleName || '', lastName: p.lastName || '', preferredName: p.preferredName || '',
    gender: p.gender || '', dateOfBirth: p.dateOfBirth || '', occupation: p.occupation || '', employmentStatus: p.employmentStatus || '',
    businessName: p.businessName || '', stateCode: p.state?.code || '', lgaId: p.lga?.id ? String(p.lga.id) : '', city: p.city || '',
    address: p.address || '', addressUnit: p.addressUnit || '', postalCode: p.postalCode || '', showPublicLocation: p.showPublicLocation ?? true,
  };
}

export function KycCard({ kyc }) {
  if (!kyc) return null;
  return (
    <Card title="Verification level">
      <div className="stack">
        <div className="row-between">
          <strong style={{ fontSize: '1.6rem' }}>Level {kyc.level}</strong>
          <StatusBadge status={kyc.restricted ? 'restricted' : kyc.status} />
        </div>
        <div className="progress" aria-label={`Verification level ${kyc.level} of 3`}>
          <span style={{ width: `${(kyc.level / 3) * 100}%` }} />
        </div>
        {kyc.nextStep && <p className="small">Next: {kyc.nextStep}.</p>}
        {kyc.expiresAt && <p className="xsmall muted">Your ID document expires on {formatDate(kyc.expiresAt)}.</p>}
        <KeyValue
          items={Object.entries(kyc.requiredLevels || {}).map(([activity, min]) => [
            { contribute: 'Make contributions', receive_payout: 'Receive payouts', withdraw: 'Withdraw', operator: 'Organise / collect' }[activity] || activity,
            kyc.allowed?.[activity] ? 'Available' : `Needs level ${min}`,
          ])}
        />
        <Button to="/app/onboarding" variant="secondary" size="sm">
          Continue verification
        </Button>
      </div>
    </Card>
  );
}

export function Details() {
  const { user, setUser, has } = useAuth();
  const toast = useToast();
  const me = useAsync(() => api.get('/profiles/me'), []);
  const [form, setForm] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (me.data) setForm(toForm(me.data));
  }, [me.data]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const p = me.data;
    const patch = {};
    const original = toForm(p);
    for (const [k, v] of Object.entries(form)) {
      if (v !== original[k]) patch[k] = k === 'lgaId' ? Number(v) : v;
    }
    if (p.identityLocked) ['firstName', 'middleName', 'lastName', 'dateOfBirth'].forEach((k) => delete patch[k]);
    if (!Object.keys(patch).length) {
      setPending(false);
      toast.success('Nothing to save');
      return;
    }
    try {
      const { data } = await api.patch('/profiles/me', patch);
      setUser({ ...user, ...data });
      me.reload();
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
      const { data } = await api.upload('/profiles/me/avatar', await resizeImageFile(file));
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
  const locked = me.data?.identityLocked;
  return (
    <AsyncContent loading={me.loading || !form} error={me.error} onRetry={me.reload}>
      {form && (
        <div className="grid-2">
          <Card title="Identity & address">
            <form className="stack" onSubmit={save}>
              <div className="row">
                <UserAvatar name={user.fullName} src={user.avatarUrl} size={64} />
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  <Camera size={15} /> Change photo
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onAvatar} />
                </label>
              </div>
              {error && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
              {locked && (
                <Alert tone="info" icon={ShieldCheck}>
                  Your legal name and date of birth are verified against your ID. To correct them, <Link to="/app/support">contact support</Link>.
                </Alert>
              )}
              <div className="grid-2">
                <Input label="First name" value={form.firstName} onChange={set('firstName')} error={fe.firstName} disabled={locked} />
                <Input label="Last name" value={form.lastName} onChange={set('lastName')} error={fe.lastName} disabled={locked} />
              </div>
              <div className="grid-2">
                <Input label="Middle name" value={form.middleName} onChange={set('middleName')} error={fe.middleName} disabled={locked} />
                <Input label="Preferred name" value={form.preferredName} onChange={set('preferredName')} error={fe.preferredName} hint="Shown to other members" />
              </div>
              <div className="grid-2">
                <Input label="Date of birth" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} error={fe.dateOfBirth} disabled={locked} hint={me.data.age ? `Age ${me.data.age}` : undefined} />
                <Select label="Gender" placeholder="Choose" options={GENDERS} value={form.gender} onChange={set('gender')} error={fe.gender} />
              </div>
              <div className="grid-2">
                <Select label="Employment" placeholder="Choose" options={EMPLOYMENT} value={form.employmentStatus} onChange={set('employmentStatus')} error={fe.employmentStatus} />
                <Input label="Occupation" value={form.occupation} onChange={set('occupation')} error={fe.occupation} />
              </div>
              <LocationPicker stateCode={form.stateCode} lgaId={form.lgaId} errors={fe} onChange={({ stateCode, lgaId }) => setForm({ ...form, stateCode, lgaId })} />
              <Input label="City / town" value={form.city} onChange={set('city')} error={fe.city} />
              <Textarea label="Residential address" rows={2} value={form.address} onChange={set('address')} error={fe.address} hint={`Private. Status: ${me.data.addressVerification}. Changing it requires re-verification.`} />
              <div className="grid-2">
                <Input label="Flat / house no." value={form.addressUnit} onChange={set('addressUnit')} error={fe.addressUnit} />
                <Input label="Postal code" inputMode="numeric" value={form.postalCode} onChange={set('postalCode')} error={fe.postalCode} />
              </div>
              <Checkbox label="Show my city and state on my public trust profile" checked={form.showPublicLocation} onChange={set('showPublicLocation')} />
              <div>
                <Button type="submit" loading={pending}>
                  Save changes
                </Button>
              </div>
            </form>
          </Card>
          <div className="stack">
            <KycCard kyc={me.data.kyc} />
            <Card title="Roles and access">
              <div className="stack">
                <div className="row-wrap">
                  {user.roles.map((r) => (
                    <span key={r} className="chip">
                      {ROLE_LABEL[r] || r}
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
                <div className="row-wrap">
                  <Button to={`/app/people/${user.id}`} variant="ghost" size="sm">
                    View my public trust profile
                  </Button>
                </div>
                <p className="xsmall muted">Member since {formatDate(me.data.createdAt)}</p>
              </div>
            </Card>
          </div>
        </div>
      )}
    </AsyncContent>
  );
}

export function PayoutAccount() {
  const toast = useToast();
  const account = useAsync(() => api.get('/users/me/payout-account'), []);
  const banks = useAsync(() => api.get('/payments/banks'), []);
  const [form, setForm] = useState({ bankCode: '', accountNumber: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [challenge, setChallenge] = useState(null); // pending change awaiting the emailed code
  const [code, setCode] = useState('');

  const reset = () => {
    setForm({ bankCode: '', accountNumber: '' });
    setEditing(false);
    setChallenge(null);
    setCode('');
    account.reload();
  };

  const save = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api.put('/users/me/payout-account', form);
      if (data.otpRequired) {
        setChallenge(data);
      } else {
        toast.success('Account verified and saved');
        reset();
      }
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
      await api.post('/users/me/payout-account/confirm', { ...form, code });
      toast.success('Payout account changed. A security alert was sent to you.');
      reset();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const fe = fieldErrors(error);
  const a = account.data;
  return (
    <div className="grid-2">
      <Card title="Payout account">
        <AsyncContent loading={account.loading} error={account.error} onRetry={account.reload}>
          <div className="stack">
            <p className="small muted">Osusu payouts, savings returns and commissions are sent to this account. The account name is confirmed with your bank.</p>
            {a && !editing ? (
              <>
                {a.status === 'cooldown' && (
                  <Alert tone="warning">
                    This account was changed recently. For your protection, automated payouts to it start after {formatDateTime(a.cooldownUntil)}.
                  </Alert>
                )}
                <KeyValue
                  items={[
                    ['Bank', a.bankName],
                    ['Account name', a.accountName],
                    ['Account number', `•••• ${a.last4}`],
                    ['Verified', formatDate(a.verifiedAt)],
                  ]}
                />
                <div>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                    Change account
                  </Button>
                </div>
              </>
            ) : challenge ? (
              <form className="stack" onSubmit={confirm}>
                <Alert tone="info" icon={Landmark}>
                  We sent a 6-digit code to your email to confirm the change to {challenge.bankName} •••• {challenge.last4} ({challenge.accountName}).
                </Alert>
                {error && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
                <Input label="Confirmation code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} error={fe.code} />
                <div className="row">
                  <Button variant="secondary" onClick={reset}>
                    Cancel
                  </Button>
                  <Button type="submit" loading={pending} disabled={code.length !== 6}>
                    Confirm change
                  </Button>
                </div>
              </form>
            ) : (
              <form className="stack" onSubmit={save}>
                {error && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
                <BankSelect
                  banks={banks.data || []}
                  loading={banks.loading}
                  placeholder="Select your bank"
                  value={form.bankCode}
                  onChange={(code) => setForm({ ...form, bankCode: code })}
                  error={fe.bankCode || (banks.error ? 'Could not load banks' : undefined)}
                />
                <Input label="Account number (NUBAN)" inputMode="numeric" maxLength={10} value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value.replace(/\D/g, '') })} error={fe.accountNumber} />
                {a && (
                  <Alert tone="info" icon={Landmark}>
                    Changing your payout account needs a code sent to your email, triggers a security alert, and pauses automated payouts to the new account for a short cool-down period.
                  </Alert>
                )}
                <div className="row">
                  {a && (
                    <Button variant="secondary" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" loading={pending} loadingText="Verifying with bank..." disabled={!form.bankCode || form.accountNumber.length !== 10}>
                    Verify and continue
                  </Button>
                </div>
              </form>
            )}
          </div>
        </AsyncContent>
      </Card>
      {a?.history?.length > 0 && (
        <Card title="Payout account history">
          <ul className="list">
            {a.history.map((h) => (
              <li key={h.id} className="list-item">
                <div className="grow">
                  <strong className="small">
                    {h.previous_bank_name ? `${h.previous_bank_name} •••• ${h.previous_last4} → ` : 'Added '}
                    {h.new_bank_name} •••• {h.new_last4}
                  </strong>
                  <div className="xsmall muted">{formatDateTime(h.created_at)} · confirmed by {h.verification_method.replace('_', ' ')}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function Sessions() {
  const toast = useToast();
  const sessions = useAsync(() => api.get('/auth/sessions'), []);
  const revoke = async (id) => {
    try {
      await api.del(`/auth/sessions/${id}`);
      toast.success('Session signed out');
      sessions.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const confirmAction = useConfirm();
  const revokeOthers = async () => {
    if (!(await confirmAction({ type: 'sign_out_others' }))) return;
    try {
      const { data } = await api.post('/auth/sessions/revoke-others');
      toast.success(`${data.revoked} other session(s) signed out`);
      sessions.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Card title="Where you're signed in" actions={<Button size="sm" variant="secondary" onClick={revokeOthers}>Sign out other sessions</Button>}>
      <AsyncContent loading={sessions.loading} error={sessions.error} onRetry={sessions.reload} empty={!sessions.data?.length} emptyState={<EmptyState title="No active sessions recorded yet. Sign in again to start tracking sessions." />}>
        <ul className="list">
          {(sessions.data || []).map((s) => (
            <li key={s.id} className="list-item">
              <span className="list-icon"><MonitorSmartphone size={18} /></span>
              <div className="grow">
                <strong className="small">{s.device}{s.current && ' · this device'}</strong>
                <div className="xsmall muted">
                  Signed in {formatDateTime(s.createdAt)} · last active {formatDateTime(s.lastActiveAt)}{s.approximateIp ? ` · IP ${s.approximateIp}` : ''}
                </div>
              </div>
              {!s.current && <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>Sign out</Button>}
            </li>
          ))}
        </ul>
      </AsyncContent>
    </Card>
  );
}

export function Activity() {
  const activity = useAsync(() => api.get('/profiles/me/security'), []);
  const items = [
    ...(activity.data?.changes || []).map((c) => ({ id: `c${c.id}`, text: c.label, sub: c.byYou ? 'by you' : 'by ACHIEVER staff', at: c.createdAt })),
    ...(activity.data?.alerts || []).map((a) => ({ id: `a${a.id}`, text: a.description, sub: 'security notice', at: a.createdAt })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 30);
  return (
    <Card title="Recent security activity">
      <AsyncContent loading={activity.loading} error={activity.error} onRetry={activity.reload} empty={!items.length} emptyState={<EmptyState title="No security activity yet." />}>
        <ul className="list">
          {items.map((i) => (
            <li key={i.id} className="list-item">
              <div className="grow">
                <strong className="small">{i.text}</strong>
                <div className="xsmall muted">{formatDateTime(i.at)} · {i.sub}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="small">Don&apos;t recognise something? <Link to="/app/support">Report unauthorised activity</Link></p>
      </AsyncContent>
    </Card>
  );
}

export function Deactivate() {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await api.post('/profiles/me/deactivate', { password, reason: reason || undefined });
      await logout().catch(() => {});
    } catch (err) {
      setError(err);
      setPending(false);
    }
  };
  return (
    <Card title="Deactivate account">
      <div className="stack">
        <p className="small muted">
          Deactivation signs you out everywhere and stops all activity. Your transaction, contribution and dispute records are kept, as required for
          members&apos; protection and the law. You must first settle open groups, savings plans and payouts.
        </p>
        <div>
          <Button variant="danger" icon={Trash2} onClick={() => setOpen(true)}>Deactivate my account</Button>
        </div>
      </div>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} onConfirm={submit} pending={pending} tone="danger" title="Deactivate your account?" confirmLabel="Deactivate">
        <div className="stack">
          {error && <Alert tone="danger">{error.message}</Alert>}
          <Input label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Textarea label="Reason (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </ConfirmDialog>
    </Card>
  );
}

/**
 * My Profile: a financial identity dashboard. One request for the profile summary
 * (stats, verification, groups) plus the wallet (always fresh from the server).
 * The signed-in user's details come from the session (no extra request).
 */
export default function Profile() {
  const { user } = useAuth();
  const toast = useToast();
  const summary = useAsync(() => api.get('/users/me/profile-summary'), [user.id], { cacheKey: `profile-summary:${user.id}` });
  const wallet = useAsync(() => api.get('/wallet'), []);
  const s = summary.data;
  const verified = Boolean(s && s.verification?.identity && s.verification?.email && user.status === 'active');
  const name = user.preferredName ? `${user.preferredName} ${user.lastName || ''}`.trim() : user.fullName;
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast.success('Wallet account number copied'); } catch { toast.error('Could not copy'); }
  };
  const share = async () => {
    try {
      const how = await shareContent({ title: `${name} on ACHIEVER`, text: `Connect with ${name} on ACHIEVER.`, url: `${window.location.origin}/app/people/${user.id}` });
      if (how === 'copied') toast.success('Profile link copied');
    } catch { toast.error('Could not share'); }
  };

  return (
    <div className="profile-page stack-lg">
      <section className="profile-header" aria-label="My profile">
        <div className="profile-banner" aria-hidden />
        <div className="profile-header-body">
          <UserAvatar name={user.fullName} src={user.avatarUrl} size={104} eager label={`${user.fullName} profile photo`} className="profile-header-avatar" />
          <div className="profile-header-text">
            <h1 className="profile-name">{name} <VerifiedBadge verified={verified} /></h1>
            {[user.occupation, s?.location].filter(Boolean).length > 0 && (
              <p className="profile-sub">{[user.occupation, s?.location].filter(Boolean).join(' · ')}</p>
            )}
            <p className="profile-sub muted">{s ? `Member since ${formatDate(s.memberSince)}` : '\u00a0'}</p>
          </div>
          <div className="profile-actions">
            <Button to="/app/profile/edit" icon={Pencil}>Edit profile</Button>
            <Button variant="secondary" icon={Share2} onClick={share}>Share</Button>
            <Button to="/app/settings" variant="secondary" icon={SettingsIcon} aria-label="Profile settings">Settings</Button>
          </div>
        </div>
        {s ? (
          <StatGrid items={[
            { label: 'Groups', value: s.stats.groups },
            { label: 'Completed', value: s.stats.completedGroups },
            { label: 'Contributions', value: s.stats.contributions },
            { label: 'Referrals', value: s.stats.referrals },
          ]} />
        ) : summary.error ? (
          <p className="small muted" style={{ padding: '0 16px 16px' }}>Statistics are unavailable right now. <button type="button" className="link-button" onClick={summary.reload}>Try again</button></p>
        ) : <div className="stat-grid is-loading" aria-busy="true"><Skeleton height={44} /><Skeleton height={44} /><Skeleton height={44} /><Skeleton height={44} /></div>}
      </section>

      <div className="profile-columns">
        <div className="stack-lg">
          <WalletSummaryCard wallet={wallet.data} loading={wallet.loading} error={wallet.error} />
          {s ? <VerificationCard verification={s.verification} status={user.status} /> : <Skeleton height={76} />}

          <ProfileSection title="My OSUSU groups" action={<Link to="/app/osusu" className="section-link">See all</Link>}>
            {!s ? <><Skeleton height={56} /><Skeleton height={56} /></>
              : s.groups.length ? s.groups.map((g) => <GroupListItem key={g.id} group={g} />)
                : <p className="small muted section-note">You are not in an OSUSU group yet. <Link to="/app/osusu/join">Join a group</Link> or <Link to="/app/osusu/new">create one</Link>.</p>}
          </ProfileSection>
        </div>

        <div className="stack-lg">
          <ProfileSection title="Account">
            <ProfileListItem to="/app/profile/edit" icon={UserRound} title="Personal information" description="Name, date of birth, occupation, address" />
            <ProfileListItem to="/app/settings/email" icon={Mail} title="Contact information" description="Email address and phone number" />
            <ProfileListItem to="/app/settings/security" icon={Lock} title="Security" description="Password, transaction PIN, biometrics" />
            <ProfileListItem to="/app/settings/payment" icon={Landmark} title="Bank accounts" description="Payout account for withdrawals" />
            <ProfileListItem to="/app/referrals" icon={Gift} title="Referral & earnings" description="Your referral code and rewards" />
            <ProfileListItem to="/app/settings/privacy" icon={ShieldCheck} title="Privacy" description="What other members can see" />
          </ProfileSection>

          {wallet.data?.walletId && (
            <ProfileSection title="Wallet account number">
              <div className="row-between section-note">
                <span className="mono" style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{wallet.data.walletId}</span>
                <Button variant="secondary" size="sm" icon={Copy} onClick={() => copy(wallet.data.walletId)}>Copy</Button>
              </div>
              <p className="xsmall muted section-note">Share it to receive money from other ACHIEVER members. It is not a bank account number.</p>
            </ProfileSection>
          )}

          <p className="xsmall muted section-note">Other members see your name, photo, location (if you allow it) and payment record. Your email, phone, address, ID documents and balances are never shown to them.</p>
        </div>
      </div>
    </div>
  );
}

/** Edit profile (moved here from Settings → Profile). */
export function ProfileEdit() {
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/profile', label: 'My profile' }} title="Edit profile" />
      <Details />
    </div>
  );
}
