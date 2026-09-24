import { useParams } from 'react-router-dom';
import { BadgeCheck, CircleSlash, Mail, MapPin, Phone, ShieldCheck, Wallet } from 'lucide-react';
import { AsyncContent, Card, PageHeader, StatCard, UserAvatar } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDate } from '../../utils/format.js';

function Check({ ok, icon: Icon, label }) {
  return (
    <div className="row small" style={{ color: ok ? 'var(--green-700)' : 'var(--gray-500)' }}>
      {ok ? <Icon size={16} aria-hidden /> : <CircleSlash size={16} aria-hidden />}
      <span>{label}: {ok ? 'verified' : 'not verified'}</span>
    </div>
  );
}

/**
 * Public trust profile: only safe, member-facing information (no contact
 * details, address, ID numbers, balances or security data).
 */
export default function TrustProfile() {
  const { id } = useParams();
  const trust = useAsync(() => api.get(`/users/${id}/trust`), [id]);
  const t = trust.data;
  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <PageHeader title="Trust profile" subtitle="What ACHIEVER can confirm about this member" />
      <AsyncContent loading={trust.loading} error={trust.error} onRetry={trust.reload}>
        {t && (
          <>
            <Card>
              <div className="row" style={{ gap: 16 }}>
                <UserAvatar name={t.displayName} src={t.avatarUrl} size={72} />
                <div className="stack-sm">
                  <h2>{t.displayName}</h2>
                  <p className="small muted">
                    Member since {formatDate(t.memberSince)}
                    {t.location && <> · <MapPin size={13} aria-hidden /> {t.location}</>}
                  </p>
                  {!t.active && <p className="small" style={{ color: 'var(--red-600)' }}>This account is not currently active.</p>}
                </div>
              </div>
            </Card>
            <Card title="Verification">
              <div className="grid-2">
                <Check ok={t.verification.email} icon={Mail} label="Email" />
                <Check ok={t.verification.phone} icon={Phone} label="Phone" />
                <Check ok={t.verification.identity} icon={BadgeCheck} label="Government ID" />
                <Check ok={t.verification.paymentAccount} icon={Wallet} label="Payout account" />
              </div>
            </Card>
            <div className="grid-3">
              <StatCard icon={ShieldCheck} label="Completed Osusu groups" value={t.completedGroups} />
              <StatCard label="Contributions paid" value={t.contributionsPaid} />
              <StatCard label="Paid on time" value={t.onTimeRate === null ? '—' : `${t.onTimeRate}%`} />
            </div>
            <p className="xsmall muted">
              Trust information reflects verified records on ACHIEVER only. It is not a credit rating and says nothing about activity elsewhere.
            </p>
          </>
        )}
      </AsyncContent>
    </div>
  );
}
