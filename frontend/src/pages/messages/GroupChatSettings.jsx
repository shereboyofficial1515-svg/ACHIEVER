import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, ClipboardList, Lock, LogOut, ScrollText, ShieldCheck, UsersRound, Wallet } from 'lucide-react';
import { Button, Checkbox, ErrorState, GroupAvatar, Input, Select, Skeleton, Textarea, UserAvatar } from '../../components/ui/index.js';
import { ProfileListItem, ProfileSection } from '../../components/domain/ProfileParts.jsx';
import { useConfirm } from '../../components/ui/ConfirmProvider.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { resizeImageFile } from '../../utils/imageResize.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE = 3 * 1024 * 1024;

// Only permissions the server actually enforces are offered here (announcements are always admin-only).
const OPTIONS = {
  send: { label: 'Who can send messages', options: [{ value: 'all', label: 'All members' }, { value: 'admins', label: 'Only admins' }] },
  pin: { label: 'Who can pin messages', options: [{ value: 'admins', label: 'Only admins' }, { value: 'selected', label: 'Admins and selected members' }] },
  change_picture: { label: 'Who can change the group picture', options: [{ value: 'admins', label: 'Only admins' }, { value: 'selected', label: 'Admins and selected members' }] },
  invite: { label: 'Who can invite people', options: [{ value: 'all', label: 'All members' }, { value: 'admins', label: 'Only admins' }] },
  member_list: { label: 'Who can see the member list', options: [{ value: 'all', label: 'All members' }, { value: 'admins', label: 'Only admins' }] },
  show_online: { label: 'Who can see who is online', options: [{ value: 'all', label: 'All members' }, { value: 'admins', label: 'Only admins' }] },
};

/** Group settings: a full page, admin only. Every change is checked and audited by the server. */
export default function GroupChatSettings() {
  const { conversationId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirmAction = useConfirm();
  const conv = useAsync(() => api.get(`/messages/conversations/${conversationId}`), [conversationId], { cacheKey: `conversation:${conversationId}` });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const c = conv.data;
  useEffect(() => {
    if (!c) return;
    setName(c.group?.name || c.title || '');
    setDescription(c.description || '');
    setRules(c.group?.rules || '');
    setSettings(c.settings);
  }, [c]);

  if (conv.loading && !c) return <div className="stack-lg info-page" aria-busy="true"><Skeleton height={56} /><Skeleton height={220} /><Skeleton height={320} /></div>;
  if (conv.error && !c) return <ErrorState error={conv.error} onRetry={conv.reload} />;
  if (!c) return null;
  if (c.type !== 'group' || !c.permissions?.canManageSettings) return <Navigate to={`/app/messages/${conversationId}/info`} replace />;
  const g = c.group;
  const back = `/app/messages/${conversationId}/info`;
  const recruiting = g?.status === 'recruiting';

  const run = async (key, fn, message) => {
    setSaving(key);
    try {
      await fn();
      toast.success(message);
      conv.reload();
    } catch (err) { toast.error(err); } finally { setSaving(null); }
  };
  const saveName = () => {
    const value = name.trim();
    if (value.length < 3) { toast.error('The group name needs at least 3 characters'); return; }
    run('name', () => api.patch(`/osusu/groups/${g.id}`, { name: value }), 'Group name saved');
  };
  const saveDescription = () => run('description', () => api.patch(`/messages/conversations/${conversationId}/group-settings`, { description: description.trim() || null }), 'Description saved');
  const saveRules = () => run('rules', () => api.patch(`/osusu/groups/${g.id}`, { rules: rules.trim() || null }), 'Group rules saved');
  const saveSetting = async (key, value) => {
    const prev = settings[key];
    if (prev === value) return;
    // Restricting who can talk is announced to the whole group: confirm it first.
    if (key === 'send') {
      const ok = await confirmAction({
        severity: 'warning',
        title: value === 'admins' ? 'Only admins can send messages?' : 'Let all members send messages?',
        message: 'A notice is posted in the group chat so everyone knows.',
        confirmLabel: 'Change',
      });
      if (!ok) return;
    }
    setSettings((s) => ({ ...s, [key]: value }));
    try {
      await api.patch(`/messages/conversations/${conversationId}/group-settings`, { settings: { [key]: value } });
      toast.success('Setting saved');
    } catch (err) {
      setSettings((s) => ({ ...s, [key]: prev }));
      toast.error(err);
    }
  };
  const setMember = async (memberId, patch) => {
    try {
      await api.patch(`/messages/conversations/${conversationId}/members/${memberId}/permissions`, patch);
      conv.reload();
    } catch (err) { toast.error(err); }
  };
  const onImage = async (e) => {
    const original = e.target.files?.[0];
    e.target.value = '';
    if (!original) return;
    if (!IMAGE_TYPES.includes(original.type)) { toast.error('Use a JPG, PNG or WebP image'); return; }
    setUploading(true);
    try {
      const file = await resizeImageFile(original);   // 512 px, so it is small and loads fast everywhere
      if (file.size > MAX_IMAGE) { toast.error('The picture must be 3 MB or smaller'); return; }
      await api.upload(`/osusu/groups/${g.id}/image`, file);
      toast.success('Group picture updated');
      conv.reload();
    } catch (err) { toast.error(err); } finally { setUploading(false); }
  };

  const selected = settings && (settings.pin === 'selected' || settings.change_picture === 'selected');
  const others = c.members.filter((m) => m.id !== user.id && m.role !== 'admin');

  return (
    <div className="stack-lg info-page">
      <header className="info-topbar">
        <button type="button" className="icon-button" onClick={() => navigate(back)} aria-label="Back to group info"><ArrowLeft size={20} /></button>
        <h1 className="grow info-topbar-title">Group settings</h1>
      </header>

      <ProfileSection title="Profile & appearance">
        {g ? (
          <div className="settings-avatar-row">
            <GroupAvatar name={c.title} src={g.imageUrl} size="large" label={`${c.title} picture`} />
            <div className="stack-sm">
              <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} hidden onChange={onImage} />
              <Button variant="secondary" size="sm" icon={Camera} loading={uploading} onClick={() => fileRef.current?.click()}>Change group picture</Button>
              <span className="xsmall muted">JPG, PNG or WebP. Resized automatically. Members see the group initials until a picture is set.</span>
            </div>
          </div>
        ) : <p className="small muted section-note">This chat is not linked to an OSUSU group.</p>}
        <div className="settings-fields">
          {g && (
            <div className="stack-sm">
              <Input label="Group name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={!recruiting}
                hint={recruiting ? 'Can be changed until the group starts' : 'Locked once the group has started (members joined under this name)'} />
              {recruiting && <div><Button size="sm" loading={saving === 'name'} onClick={saveName} disabled={name.trim() === (g.name || '')}>Save name</Button></div>}
            </div>
          )}
          <div className="stack-sm">
            <Textarea label="Group description" maxLength={500} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} hint={`${description.length}/500 · shown on Group info`} />
            <div><Button size="sm" loading={saving === 'description'} onClick={saveDescription} disabled={(c.description || '') === description}>Save description</Button></div>
          </div>
        </div>
      </ProfileSection>

      {settings && (
        <ProfileSection title="Group permissions">
          <div className="settings-fields">
            {Object.entries(OPTIONS).map(([key, o]) => (
              <Select key={key} label={o.label} options={o.options} value={settings[key]} onChange={(e) => saveSetting(key, e.target.value)} />
            ))}
            <p className="xsmall muted" style={{ margin: 0 }}>Announcements, editing group information and managing members are admin-only. Every change is recorded in the group’s audit log.</p>
          </div>
        </ProfileSection>
      )}

      {selected && others.length > 0 && (
        <ProfileSection title="Selected members">
          <p className="xsmall muted section-note">Choose who else may pin messages or change the picture.</p>
          {others.map((m) => (
            <div key={m.id} className="list-row" style={{ cursor: 'default' }}>
              <UserAvatar name={m.name} src={m.avatarUrl} size={36} />
              <span className="list-row-text"><span className="list-row-title">{m.name}</span></span>
              <span className="stack-sm">
                {settings.pin === 'selected' && <Checkbox label="Pin" checked={Boolean(m.canPin)} onChange={(e) => setMember(m.id, { canPin: e.target.checked })} />}
                {settings.change_picture === 'selected' && <Checkbox label="Picture" checked={Boolean(m.canChangePicture)} onChange={(e) => setMember(m.id, { canChangePicture: e.target.checked })} />}
              </span>
            </div>
          ))}
        </ProfileSection>
      )}

      {g && (
        <ProfileSection title="Group rules">
          <div className="settings-fields">
            <Textarea label="Rules members should follow" maxLength={4000} rows={6} value={rules} onChange={(e) => setRules(e.target.value)} hint={`${rules.length}/4000`} />
            <div><Button size="sm" loading={saving === 'rules'} onClick={saveRules} disabled={(g.rules || '') === rules}>Save rules</Button></div>
          </div>
        </ProfileSection>
      )}

      {g && (
        <ProfileSection title="OSUSU settings">
          <p className="small section-note"><Lock size={14} aria-hidden /> Contribution amount, frequency, deadlines, grace period, payout order and member approval are managed on the group page. Financial terms lock once the group starts, and every payment goes through the wallet ledger.</p>
          <ProfileListItem to={`/app/osusu/${g.id}`} icon={Wallet} title="Contributions, schedule and payouts" description="Amount, frequency, grace period, payout order" />
          <ProfileListItem to={`/app/osusu/${g.id}`} icon={UsersRound} title="Members and approvals" description="Approve, remove, payout positions" />
        </ProfileSection>
      )}

      <ProfileSection title="Security & administration">
        {g && <ProfileListItem to={`/app/osusu/${g.id}`} icon={ClipboardList} title="Group activity and history" description="Contributions, payouts and changes" />}
        <ProfileListItem to="/app/settings/privacy" icon={ShieldCheck} title="Privacy" description="Online status and read receipts are each member’s choice" />
        {g && <ProfileListItem to={`/app/osusu/${g.id}`} icon={ScrollText} title="Cancel group (before it starts)" description="Done on the group page, with confirmation and a reason" />}
        {!g && <ProfileListItem as="button" danger icon={LogOut} title="Leave chat" onClick={() => navigate(back)} />}
      </ProfileSection>
    </div>
  );
}
