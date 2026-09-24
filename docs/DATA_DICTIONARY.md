# ACHIEVER — Data dictionary (identity, security & compliance)

Classification:

- **Public:** may appear on a trust profile.
- **Internal:** visible to the account owner and authorised staff.
- **Private:** visible to the owner and staff holding `users.read_sensitive`; every staff access is logged.
- **Restricted:** identity documents, biometrics and evidence; logged access with a reason.
- **Secret:** never returned by the API.

Money is always integer kobo (`BIGINT`). Times are `timestamptz` (UTC), and business dates use Africa/Lagos.

## profiles (extended)

| Column | Type | Class | Notes |
|---|---|---|---|
| full_name | text | Internal | Composed from legal names at registration |
| first_name / middle_name / last_name | text | Private | Legal names as on ID; locked once KYC ≥ 2 |
| preferred_name | text | Public | Shown in groups and on the trust profile |
| gender | enum female/male/other/prefer_not_to_say | Private | |
| date_of_birth | date | Private | Must be 18+; age is derived by `age_years()` and never stored |
| nationality, country | char(2) ISO | Private | Default NG |
| occupation, employment_status, business_name | text / enum | Private | Optional |
| state_code → ng_states, lga_id → ng_lgas | FK | Private (public if `show_public_location`) | Trigger enforces the LGA belongs to the state |
| city | text | Private (public if `show_public_location`) | |
| address, address_unit, postal_code | text | Private | Never shown publicly |
| address_verification_status | enum unverified/pending/verified/failed | Internal | Reset to unverified when the address changes |
| show_public_location | boolean | Internal | Controls city/state on the trust profile |
| deactivated_at, deactivation_reason | | Internal | Self-service deactivation; records are retained |

## Reference data

- `ng_states` (code, name): 37 rows (36 states + FCT).
- `ng_lgas` (id, state_code, name): 774 rows.
- Both are public and read-only.

## Identity & KYC

| Table | Class | Purpose |
|---|---|---|
| verification_records | Restricted | See notes below the table |
| kyc_profiles | Internal | Level 0–3 and status (derived by `recompute_kyc`); provider, reference, attempts, restriction flag and reason |
| kyc_events | Internal (append-only) | Every change of KYC level or status |

`verification_records` holds one row per identity submission:

- `id_type`: BVN, NIN, passport, driver's licence or voter's card.
- `id_number_hash`: an HMAC of the number (**Secret**).
- `id_last4` and `document_number_masked`: the only parts of the number kept in readable form.
- Also stored: issuing country, issue and expiry dates, liveness fields, and the path to the document in a private bucket.

## Devices & sessions

| Table | Class | Purpose |
|---|---|---|
| user_devices | Internal | `device_id_hash` (HMAC of the device cookie; **Secret**), label, type, OS, browser, first/last seen |
| user_sessions | Internal | One row per sign-in: auth method, device, IP (masked in user views), user agent, last active, step-up time, revocation |
| otp_codes | Secret | HMAC codes; `pending_value` binds a code to the new email, phone or account |

## Security, risk & history

| Table | Class | Purpose |
|---|---|---|
| account_change_history | Internal (append-only) | Password, phone, email, name, DOB, address, payout account, collector status, device, risk, deactivation and KYC-restriction changes |
| security_events | Internal | Neutral observations (new device, locked account, OTP failures, payout-account change, repeated disputes, takeover report…), severity, investigation status |
| risk_profiles | Internal | risk_status normal/review_required/restricted, reason, reviewer |
| risk_profile_factors (view) | Internal | Explainable signals: account age, KYC level, security events, disputes, failed payments/verifications, overdue contributions, recent payout-account change |
| risk_flags (extended) | Internal | Per-incident review cases; new reason codes |
| data_access_logs | Internal (append-only) | Who viewed which sensitive record, which fields, why, session, IP |

## Payments & ledger

| Table / columns | Class | Purpose |
|---|---|---|
| payout_accounts (+status, cooldown_until, provider, change_count) | Internal | Bank name, account name, last 4; full account number never stored |
| payment_account_changes | Internal (append-only) | Previous/new bank and last 4, verification method, session, IP, cool-down |
| osusu_payouts / collector_returns / collector_commissions (+destination_*, hold_reason, risk_evaluation) | Internal | Destination snapshot at approval; withdrawal-security evaluation |
| transactions (+related_transaction_id, counterparty_user_id, collector_id, channel, session_id, processed_at, settled_at, failure_reason, dispute_case_id, destination_bank_name, destination_last4, created_by) | Internal | Full traceability; new types `reversal`, `adjustment`, `fee`, `settlement` |
| payment_attempts (+session_id) | Internal | Checkout bound to the authenticated session |
| sensitive_action_requests | Internal | Two-person approvals (see SECURITY_COMPLIANCE.md) |

## Collectors

- `collector_accounts` gains: status (pending_review, verified, active, restricted, suspended, revoked or rejected), `approved_by`, `approved_at`, `rejection_reason`, `status_reason` and `status_changed_at`.
- `collector_status_history` is append-only and records every status change with its reason and approval request.
- `collector_trust_stats` is a view of:
  - savers managed
  - money collected and settled
  - outstanding and overdue settlements
  - complaints and open disputes
  - suspensions

## Disputes

| Table / columns | Class | Purpose |
|---|---|---|
| support_tickets (+case_number, respondent_user_id, collector_id, amount, resolution, resolution_outcome) | Internal | Case record; the respondent can see money disputes about them |
| case_events | Internal (append-only) | Case timeline |
| case_transactions | Internal (append-only) | Ledger entries linked to a case |
| dispute_evidence | Restricted (append-only) | File in the private bucket or a linked record; SHA-256; `supersedes_id` for corrections |

## Settings, challenges and deletion (migration 008)

| Table | Class | Purpose |
|---|---|---|
| user_preferences | Internal | `accessibility`, `messages`, `privacy`, `security` JSON settings; erased on personal-data deletion |
| security_challenges | Secret (no browser access) | Verification codes for sensitive changes: HMAC only, action, channel, masked destination, attempts, session, expiry, verified/consumed times |
| data_deletion_requests | Internal (never deleted) | Account or personal-data deletion: status, reason, cancellation window, reviewer, decision note, retained summary |

## Trust (public-safe)

`user_trust_profile` exposes only these fields:

- display name (preferred or first name plus last initial) and avatar
- city and state, only if the user opted in
- member since
- email, phone, ID and payout-account verified flags
- completed groups, contributions paid and on-time contributions
- whether the account is active

It contains no contact details, address, ID numbers, balances or security data.

## Retention

Financial, audit, security, KYC-event, dispute and data-access records are retained when an account is deactivated. Identity document files stay in private storage and are only reachable through logged, 120-second signed URLs.
