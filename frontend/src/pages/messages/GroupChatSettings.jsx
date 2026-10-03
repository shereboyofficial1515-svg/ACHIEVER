import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, ChevronRight, Lock } from 'lucide-react';
import { Button, Card, Checkbox, ErrorState, Loader, Select, Textarea, UserAvatar } from '../../components/ui/index.js';
import { useConfirm } from '../../components/ui/ConfirmProvider.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE = 3 * 1024 * 1024;

const OPTIONS = {
  send: { label: 'Who can send messages', options: [{ value: 'all', label: 'All members' }, { value: 'admins', label: 'Only admins' }] },
  pin: { label: 'Who can pin messages', options: [{ value: 'admins', label: 'Only admins' }, { value: 'selected', label: 'Admins and selected members' }] },
  change_picture: { label: 'Who can change the group picture', options: [{ value: 'admins', label: 'Only admins' }, { value: 'selected', label: 'Admins and selected members' }] },
  invite: { label: 'Who can invite people', options: [{ value: 'all', label: 'All members' }, { value: 'admins', label: 'Only admins' }] },
  member_list: { label: 'Who can see the member list', options: [{ value: 'all', label: 'All members' }, { value: 'admins', label: 'Only admins' }] },
  show_online: { label: 'Who can see who is online', options: [{ value: 'all', label: 'All members' }, { value: 'admins', label: 'Only admins' }] },
};

function Section({ title, children }) {
  return <Card title={title}><div className="stack">{children}</div></Card>;
}

/** Group settings: a full page, admin only. Every change is checked and audited by the server. */
export default function GroupChatSettings() {
  const { conversationId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirmAction = useConfirm();
  const conv = useAsync(() => api.get(`/messages/conversations/${conversationId}`), [conversationId]);
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const c = conv.data;
  useEffect(() => {
    if (!c) return;
    setDescription(c.description || '');
    setRules(c.group?.rules || '');
    setSettings(c.settings);
  }, [c]);

  if (conv.loading && !c) return <Loader label="Loading group settings..." />;
  if (conv.error) return <ErrorState error={conv.error} onRetry={conv.reload} />;
  if (!c) return null;
  if (c.type !== 'group' || !c.permissions?.canManageSettings) return <Navigate to={`/app/messages/${conversationId}/info`} replace />;
  const g = c.group;
  const back = `/app/messages/${conversationId}/info`;

  const saveDescription = async () => {
    setSaving('description');
    try {
      await api.patch(`/messages/conversations/${conversationId}/group-settings`, { description: description.trim() || null });
      toast.success('Description saved');
      conv.reload();
    } catch (err) { toast.error(err); } finally { setSaving(null); }
  };
  const saveRules = async () => {
    setSaving('rules');
    try {
      await api.patch(`/osusu/groups/${g.id}`, { rules: rules.trim() || null });
      toast.success('Group rules saved');
      conv.reload();
    } catch (err) { toast.error(err); } finally { setSaving(null); }
  };
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
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) { toast.error('Use a JPG, PNG or WebP image'); return; }
    if (file.size > MAX_IMAGE) { toast.error('The picture must be 3 MB or smaller'); return; }
    setUploading(true);
    try {
      await api.upload(`/osusu/groups/${g.id}/image`, file);
      toast.success('Group picture updated');
      conv.reload();
    } catch (err) { toast.error(err); } finally { setUploading(false); }
  };

  const selected = settings && (settings.pin === 'selected' || settings.change_picture === 'selected');
  const others = c.members.filter((m) => m.id !== user.id && m.role !== 'admin');

  return (
    <div className="stack-lg info-page">
      <div className="info-topbar">
        <button type="button" className="icon-button" onClick={() => navigate(back)} aria-label="Back to group info"><ArrowLeft size={20} /></button>
        <span className="grow">Group settings</span>
      </div>

      <Section title="Profile & appearance">
        {g ? (
          <div className="row" style={{ gap: 16 }}>
            <UserAvatar name={c.title} src={g.imageUrl} size={72} />
            <div className="stack-sm">
              <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} hidden onChange={onImage} />
              <Button variant="secondary" size="sm" icon={Camera} loading={uploading} onClick={() => fileRef.current?.click()}>Change group picture</Button>
              <span className="xsmall muted">JPG, PNG or WebP, up to 3 MB. Members see the group initials until a picture is set.</span>
            </div>
          </div>
        ) : <p className="small muted">This chat is not linked to an OSUSU group.</p>}
        <Textarea label="Description" maxLength={500} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} hint={`${description.length}/500 · shown on Group info`} />
        <div><Button size="sm" loading={saving === 'description'} onClick={saveDescription} disabled={(c.description || '') === description}>Save description</Button></div>
      </Section>

      {settings && (
        <Section title="Messaging & members">
          {Object.entries(OPTIONS).map(([key, o]) => (
            <Select key={key} label={o.label} options={o.options} value={settings[key]} onChange={(e) => saveSetting(key, e.target.value)} />
          ))}
          <p className="xsmall muted">Announcements are always admin-only. Changes are recorded in the group's audit log.</p>
        </Section>
      )}

      {selected && others.length > 0 && (
        <Section title="Selected members">
          <p className="xsmall muted">Choose who else may pin messages or change the picture.</p>
          <ul className="info-members">
            {others.map((m) => (
              <li key={m.id} className="info-member">
                <UserAvatar name={m.name} src={m.avatarUrl} size={36} />
                <span className="grow truncate">{m.name}</span>
                <span className="stack-sm">
                  {settings.pin === 'selected' && <Checkbox label="Pin" checked={Boolean(m.canPin)} onChange={(e) => setMember(m.id, { canPin: e.target.checked })} />}
                  {settings.change_picture === 'selected' && <Checkbox label="Picture" checked={Boolean(m.canChangePicture)} onChange={(e) => setMember(m.id, { canChangePicture: e.target.checked })} />}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {g && (
        <Section title="Group rules">
          <Textarea label="Rules members should follow" maxLength={4000} rows={6} value={rules} onChange={(e) => setRules(e.target.value)} hint={`${rules.length}/4000`} />
          <div><Button size="sm" loading={saving === 'rules'} onClick={saveRules} disabled={(g.rules || '') === rules}>Save rules</Button></div>
        </Section>
      )}

      {g && (
        <Section title="OSUSU">
          <p className="small"><Lock size={14} aria-hidden /> Contribution amount, frequency, payout order and penalties are managed on the group page. Financial terms lock once the group starts, and every payment goes through the wallet ledger.</p>
          <Link to={`/app/osusu/${g.id}`} className="info-link">Manage contributions, members and payouts <ChevronRight size={16} aria-hidden /></Link>
        </Section>
      )}

      <Section title="Privacy">
        <p className="small muted">Members choose whether to share their online status and read receipts in Settings → Privacy. The options above can further limit what members see in this group.</p>
      </Section>

      {g && (
        <Section title="Danger zone">
          <p className="small muted">Removing members, cancelling the group (only before it starts) and transferring responsibilities are done on the group page so contributions and payouts stay correct. Each action asks for confirmation and a reason.</p>
          <Link to={`/app/osusu/${g.id}`} className="info-link danger">Open group management <ChevronRight size={16} aria-hidden /></Link>
        </Section>
      )}
    </div>
  );
}
