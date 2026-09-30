import { Checkbox } from '../ui/index.js';
import { formatDate, naira } from '../../utils/format.js';

const FREQUENCY = { daily: 'every day', weekly: 'every week', biweekly: 'every two weeks', monthly: 'every month' };

/**
 * What a member agrees to before joining an Osusu group. Wording is neutral:
 * no threats, no presumption of guilt. Final wording is subject to legal review.
 */
export default function OsusuTerms({ terms, accepted, onAccept }) {
  return (
    <div className="stack osusu-terms">
      <h3 style={{ fontSize: 16 }}>Terms of “{terms.groupName}”</h3>
      <dl className="confirm-details">
        <div className="confirm-row"><dt>Contribution</dt><dd>{naira(terms.contributionAmount)} {FREQUENCY[terms.frequency] || terms.frequency}</dd></div>
        <div className="confirm-row"><dt>First due date</dt><dd>{terms.startDate ? formatDate(terms.startDate) : 'When the organiser starts the group'}</dd></div>
        <div className="confirm-row"><dt>Members</dt><dd>{terms.members} of {terms.maxMembers}</dd></div>
        <div className="confirm-row"><dt>Grace period</dt><dd>{terms.gracePeriodDays ? `${terms.gracePeriodDays} day(s) after each due date` : 'None'}</dd></div>
        <div className="confirm-row"><dt>Default charge</dt><dd>{terms.defaultCharge ? `${naira(terms.defaultCharge)} per missed contribution` : 'No default charge set for this group'}</dd></div>
      </dl>
      <ul className="small terms-list">
        <li>You contribute the stated amount on every due date until <strong>every</strong> member has received their payout, including after you receive yours.</li>
        <li>Payouts follow the order shown in the group. A contribution counts only after Paystack confirms it.</li>
        <li>If a contribution is late, you will be reminded. After the grace period the contribution is recorded as missed and the organiser and ACHIEVER may contact you to agree how it will be paid.</li>
        <li>Failure to meet agreed contribution obligations may result in applicable contractual/default charges and recovery action in accordance with the applicable terms and Nigerian law. Where lawful and necessary, information and documents provided during verification may be used as evidence in a dispute or legal recovery process.</li>
        <li>Disputes are handled through ACHIEVER support (Disputes &amp; support), where both sides can add evidence. Legal action is considered only after other steps have failed.</li>
      </ul>
      <Checkbox checked={accepted} onChange={(e) => onAccept(e.target.checked)}
        label={<>I have read these terms and the <a href="/terms.html" target="_blank" rel="noreferrer">Terms of Service</a>, and I agree to contribute as stated.</>} />
      <p className="xsmall muted">Terms version {terms.termsVersion}. Final wording is subject to legal review.</p>
    </div>
  );
}
