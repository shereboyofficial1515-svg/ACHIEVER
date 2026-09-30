import { Link } from 'react-router-dom';
import BrandLogo from '../../components/brand/BrandLogo.jsx';
import PublicFooter from './PublicFooter.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { naira } from '../../utils/format.js';

const DEFAULTS = { rewardAmount: 1_500_000, requiredReferrals: 6, qualificationDays: 21, minActivities: 1, osusuRequired: true, verificationLevel: 1, qualifyingActivities: ['bill_payment', 'osusu_contribution'], reviewRequired: true };
const ACTIVITY = { bill_payment: 'a completed airtime, data or bill purchase', osusu_contribution: 'a verified Osusu contribution', collector_savings: 'a verified collector-savings deposit' };

/** Referral Programme Terms — shows the live values configured by ACHIEVER. */
export default function ReferralTerms() {
  const t = useAsync(() => api.get('/auth/referral/terms'), []);
  const p = { ...DEFAULTS, ...(t.data || {}) };
  const weeks = Math.round(p.qualificationDays / 7);
  return (
    <>
      <div className="section legal-doc" style={{ maxWidth: 860 }}>
        <BrandLogo variant="stacked" width={120} />
        <h1>Referral Programme Terms</h1>
        <p className="muted small">These terms explain exactly how referrals and rewards work. They are subject to final legal review before the programme is promoted publicly.</p>

        <h2>1. Your referral code</h2>
        <p>Every eligible member with a verified email receives one unique referral code (for example ACH-8F4K2Q). Share it or your invitation link. A person who creates an ACHIEVER account with your code becomes your referral. This relationship is permanent: it cannot be changed or moved to someone else after registration.</p>

        <h2>2. What makes a referral qualify</h2>
        <p>A registration on its own does <strong>not</strong> qualify. Each referred person must:</p>
        <ol>
          <li>create their account using your code;</li>
          <li>complete ACHIEVER&apos;s verification for their account{p.verificationLevel >= 1 ? ' (verified email and phone, and a complete basic profile)' : ' (verified email)'};</li>
          {p.osusuRequired && <li>be an active member of an Osusu group;</li>}
          <li>stay active for at least {weeks} weeks ({p.qualificationDays} days) after registering;</li>
          <li>complete at least {p.minActivities} qualifying activit{p.minActivities === 1 ? 'y' : 'ies'} during that time — {p.qualifyingActivities.map((a) => ACTIVITY[a]).filter(Boolean).join(' or ')};</li>
          <li>remain in good standing and not be a duplicate, self-created or fraudulent account.</li>
        </ol>

        <h2>3. The reward</h2>
        <p>When <strong>{p.requiredReferrals}</strong> of your referrals have qualified, you become eligible for a reward of <strong>{naira(p.rewardAmount)}</strong>. Each further group of {p.requiredReferrals} qualifying referrals can earn another reward. The amount is the one published when the reward becomes eligible.</p>

        <h2>4. Review and payment</h2>
        <p>{p.reviewRequired ? 'Every reward is reviewed by ACHIEVER before approval.' : 'Rewards without review flags are approved automatically; others are reviewed.'} Approved rewards are paid to your verified payout account. Approval and payment are recorded by two different authorised ACHIEVER staff members. You can follow each stage (ready for review, under review, approved, paid) on your Refer &amp; Earn page.</p>

        <h2>5. Not allowed</h2>
        <ul>
          <li>Referring yourself, including through a second account, another email address or phone number.</li>
          <li>Creating or buying accounts, or asking people to register without intending to use ACHIEVER.</li>
          <li>Sharing devices or identities to make accounts look separate.</li>
          <li>Spam, misleading claims, or offering to pay people to register.</li>
        </ul>

        <h2>6. Reviews and rejection</h2>
        <p>Some referrals are held for review, for example when two accounts use the same device. A review is <strong>not</strong> a finding of wrongdoing. After review a referral may count, or it may be rejected (for example as a duplicate or self-referral, an account closed for breaching our terms, or activity that was reversed). Rejected referrals and rewards show the outcome on your page, and you can contact support to ask for a second look.</p>

        <h2>7. Changes</h2>
        <p>ACHIEVER may change these terms, the reward amount or the requirements for future referrals by publishing the updated terms here. Changes apply only going forward and do not reduce a reward that has already been approved.</p>

        <p><Link to="/legal">Main terms and privacy notice</Link> · <Link to="/help">Help Center</Link></p>
      </div>
      <PublicFooter />
    </>
  );
}
