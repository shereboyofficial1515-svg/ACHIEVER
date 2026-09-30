# Referral programme

## How it works

1. Every member with a verified email gets one referral code, such as `ACH-8F4K2Q`. The code is 6 random characters from a 32-character alphabet that leaves out easily confused characters (0, O, 1, I). It is created by `ensure_referral_code`, is unique, and is never sequential.
2. A new user enters the code at sign-up, or opens `/register?ref=CODE`. The server checks the code **before** the account is created and shows a masked name ("Referred by: John A.", or "An ACHIEVER member" if the referrer turned that off with the privacy setting `showNameToReferrals`).
3. After registration, `create_referral(referred, code)` creates the relationship. The client never sends a referrer ID.
   - A user can't refer themselves, and can't be referred twice.
   - A referral can only be attached within one day of account creation.
   - `referrer_id` can never change and a referral can't be deleted (database trigger).
4. `evaluate_referral` (run hourly by the `referrals.qualify` job, or on demand with "Update progress") decides each referral's status:

| Status | Meaning |
|---|---|
| REGISTERED | Account not yet verified to the required level (setting `referral.verification_level`, default 1 = email + phone + basic profile) |
| QUALIFYING | Verified, but still missing Osusu membership, the qualifying activity or the qualification period |
| QUALIFIED | Verified, active Osusu member (if `referral.require_osusu`), at least `referral.qualification_days` (21) since registering, at least `referral.min_activity_count` (1) qualifying activity (delivered bill or verified Osusu contribution; configurable), and account in good standing |
| DISQUALIFIED | Referral rejected after review, or account closed |

5. `evaluate_referrer_rewards` groups the oldest **6** (`referral.required_referrals`) qualified, cleared referrals into one reward of **₦15,000** (`referral.reward_amount_kobo`, default 1,500,000 kobo). Each further group of 6 makes another reward.

## Anti-fraud (flags, not verdicts)

- **Signals:** the same device on both accounts (`shared_device`); the same mailbox across Gmail dot and `+alias` variants (`same_email_identity`); the same phone (`same_phone`).
- **Effect:** a flag holds the referral (`SUSPICIOUS`, `PENDING_REVIEW` or `UNDER_REVIEW`) until an administrator records APPROVED or REJECTED with a reason. Flagged referrals are never counted automatically.
- **Wording:** members see only "being reviewed". The word "fraud" is never shown to them, and there is no numeric risk score.

## Reward lifecycle

```
ELIGIBLE ─► UNDER_REVIEW ─► APPROVED ─► PAID ─► (REVERSED)
    └────────────┴──► REJECTED ◄──┘
```

- **One function:** every change goes through `transition_referral_reward` and needs a reason (5+ characters). Each change is written to `referral_events` and `audit_logs`, both append-only.
- **Approve and reject** need the `referrals.review` permission. **Record payment and reverse** need `referrals.pay` plus a payment reference. The administrator who approved a reward can't record its payment (two-person rule).
- **Admin checks:** the admin API also requires a fresh authenticator code (step-up), and the admin app asks for a confirmation.
- **Recorded fields:** `approved_by/at`, `approval_reason`, `payment_reference`, `paid_by/at`.
- **Payment:** the transfer itself is made outside ACHIEVER, for example a bank transfer by Finance, and its reference is recorded here.
- **Notifications:** referral registered, progressing, qualified, ready for review, approved, paid. None of them contains personal details.

## Where to find it

- **Member:** Refer & Earn (`/app/referrals`).
- **Public:** Referral Programme Terms (`/referral-terms`, linked from `/legal`).
- **Admin:** Referrals, with filters (all, pending, qualifying, qualified, flagged, under review, rejected, not eligible), search by user ID, email, phone, code or bill reference, and a Rewards tab. Contact details are masked unless the role has `users.read_sensitive`.
- **Settings:** Admin → Settings → Referral programme. Every change needs a confirmation, a reason and the right role, and is audited.

## Tests

`supabase/tests/database/bills_referrals.test.sql` covers:
- valid, invalid, self and duplicate referrals;
- five vs six qualified referrals, and a referral still under 3 weeks;
- unverified and suspended referrals, and qualifying activity;
- shared-device flags;
- approval, rejection and payment, including the two-person rule;
- RLS.
