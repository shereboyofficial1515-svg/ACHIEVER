import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Input } from '../ui/index.js';
import { api } from '../../services/api.js';

const CODE_RE = /^ACH-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

/**
 * Optional referral code on sign-up. The server checks the code (here for
 * feedback, and again when the account is created) and decides who referred
 * whom; the form never sends a referrer.
 */
export default function ReferralCodeField({ value, onChange, error }) {
  const [check, setCheck] = useState({ state: 'idle' });
  const code = String(value || '').trim().toUpperCase();

  useEffect(() => {
    if (!code) return setCheck({ state: 'idle' });
    if (!CODE_RE.test(code)) return setCheck({ state: code.length >= 10 ? 'invalid' : 'idle' });
    let alive = true;
    setCheck({ state: 'checking' });
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/auth/referral/validate', { code });
        if (alive) setCheck(data.valid ? { state: 'valid', referredBy: data.referredBy } : { state: 'invalid' });
      } catch {
        if (alive) setCheck({ state: 'idle' });
      }
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [code]);

  return (
    <div className="stack-sm">
      <Input
        label="Referral code (optional)"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="ACH-8F4K2Q"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={10}
        error={error || (check.state === 'invalid' ? 'This referral code is not valid' : undefined)}
        hint={check.state === 'checking' ? 'Checking code…' : undefined}
      />
      {check.state === 'valid' && (
        <p className="small referral-ok" role="status">
          <CheckCircle2 size={15} aria-hidden /> Referred by: <strong>{check.referredBy}</strong>
        </p>
      )}
    </div>
  );
}
