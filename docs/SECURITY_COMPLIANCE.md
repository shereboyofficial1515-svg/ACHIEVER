# ACHIEVER — Security, Identity & Compliance

This document records the gap analysis done before the security/trust work, and how each requirement is now implemented. Everything here extends the existing schema and services; no parallel (`_v2`) tables or systems were created.

Migrations: `20260924000006_ng_locations.sql` (Nigerian states and LGAs) and `20260924000007_identity_security_compliance.sql` (everything else).

## 1. Gap analysis (state before this work)

| Area | Existed | Gap closed by |
|---|---|---|
| Roles | SUPER_ADMIN, ADMIN, SUPPORT_ADMIN; checks by role name | 9 staff roles + `permissions` / `role_permissions`; every admin route checks a permission |
| User profile | `full_name`, free-text `address`, optional `date_of_birth` | Legal names, preferred name, gender enum, nationality, occupation, employment, business, structured Nigerian address (state → LGA → city) with an LGA-belongs-to-state trigger |
| KYC | `verification_records` for BVN/NIN only | Passport, driver's licence, voter's card; expiry/issue dates; masked number; `kyc_profiles` (levels 0–3, derived by `recompute_kyc`) + append-only `kyc_events`; liveness columns (provider not configured, reported honestly) |
| Sessions | Supabase tokens + a signed "session start" cookie; revoke-all only | `user_devices`, `user_sessions`; cookie binds the session id; per-session revocation; new-device alerts; step-up re-authentication |
| Contact changes | Not possible | Email/phone change with password + OTP to the **new** contact, alert to the old one, history |
| Payout account | Overwritten in place, no OTP | OTP bound to the new account, cool-down, `payment_account_changes` history, alerts, destination snapshots on payouts |
| Account history | Audit log only | Append-only `account_change_history` |
| Security events | None | `security_events` with neutral statuses; the observation is immutable (trigger) |
| Risk | `risk_flags` per incident | Explainable `risk_profile_factors` view + `risk_profiles` (normal / review_required / restricted); restriction blocks payments; lifting needs two people |
| Withdrawal security | Payout executed if approved | `evaluateDisbursement`: holds for restriction, KYC level, account cool-down, large amounts; manual override needs a reason; large payouts need a second approver |
| Collectors | active / suspended | pending_review → verified → active; restricted / suspended / revoked / rejected; `collector_status_history`; revocation needs two people; KYC level 2 before approval |
| Ledger corrections | None | `reverse_transaction` / `record_adjustment` behind approved `sensitive_action_requests` (requester ≠ approver, single use, 48 h expiry); linked rows, originals never edited |
| Traceability | Partial | `transactions` gain session, channel, collector, counterparty, destination, processed/settled, created_by; trace API for transactions and cases |
| Disputes | Support tickets | `CASE-YYYY-NNNNNN` numbers, respondent, amount, resolution/outcome, append-only `case_events`, `case_transactions`, `dispute_evidence` (SHA-256, supersede instead of edit), private evidence bucket |
| Sensitive data access | Audit of document views | Append-only `data_access_logs` with a mandatory reason, written **before** data is returned |
| Deactivation | Staff "closed" only | Self-service deactivation with obligation checks; all records retained |
| Trust | None | `user_trust_profile` view (safe fields only) and collector trust statistics |
| Compliance jobs | None | `run_compliance_checks()` daily: expire IDs, flag late collector settlements, expire stale approvals |

## 2. Roles and permissions (least privilege)

Permissions live in `role_permissions` and are loaded by `permissionService` (cached 60 s). The UI hides what a user cannot do, but the API enforces every check (`requirePermission`).

| Role | Can |
|---|---|
| SUPER_ADMIN | Everything, including `roles.manage` and `settings.manage` |
| ADMIN (legacy) | Operations: users, ledger, payouts, reversal request/approve, reports, broadcast, support, trace. **Not** KYC documents, biometrics or settings |
| COMPLIANCE_ADMIN | KYC review, identity documents, biometrics, collector review/status, risk review, sensitive profile data, audit, trace |
| FINANCE_ADMIN | Ledger, payouts, reversal request/approve, reports, trace |
| DISPUTE_ADMIN | Disputes, evidence, support, ledger read, reversal request, trace |
| SECURITY_ADMIN | Security events (read/manage), sessions, account status, risk review, sensitive profile data, evidence, audit, trace |
| SUPPORT_ADMIN | Support tickets, basic user info (contact details masked) |
| AUDITOR | Read-only ledger, audit log, data-access log, security events, evidence, reports, trace |
| READ_ONLY_ADMIN | Overview and basic user info |

### Sensitive staff actions

These need the permission **and** a password step-up on the current session within `security.step_up_minutes` (default 10). The UI prompts for the password automatically when the API returns `STEP_UP_REQUIRED`:

- account status and role changes
- collector status changes
- KYC decisions and restrictions
- risk status changes
- payout confirm/fail/retry
- approval request/decision/execute
- revoking another user's sessions
- settings changes

### Two-person rule (`sensitive_action_requests`)

| Action | Request permission | Approve permission |
|---|---|---|
| `transaction_reversal` | finance.reversal.request | finance.reversal.approve |
| `transaction_adjustment` | finance.reversal.request | finance.reversal.approve |
| `collector_revoke` | collectors.status | collectors.status |
| `risk_restriction_lift` | risk.review | risk.review |
| `large_payout_confirm` | finance.payouts.execute | finance.reversal.approve |

The database enforces that the approver differs from the requester, that there is one open request per target, the 48-hour expiry, and single use (`_consume_approval`). Nobody can request, approve or review an action about their own account.

## 3. KYC levels

| Level | Requirements |
|---|---|
| 0 | Email verified |
| 1 | + phone verified, legal first/last name, date of birth, state, LGA, city |
| 2 | + a verified, unexpired government ID |
| 3 | + liveness passed and address verified |

Required levels per activity are set in `app_settings.kyc.required_levels` (default: contribute 1, receive_payout 2, withdraw 2, operator 2). The level is always derived by `recompute_kyc`; the API never sets it directly.

- **Liveness:** no provider is configured, so `POST /verification/liveness` returns `503 LIVENESS_PROVIDER_NOT_CONFIGURED`. Level 3 cannot be reached until a provider is integrated; nothing is simulated.
- **Document checks:** NIN and BVN go through the identity provider adapter. Other document types, and NIN/BVN while no automated provider is configured, go to manual review by compliance staff.

## 4. Sessions and devices

- **Device cookie.** `ach_did` is a random, HTTP-only device identifier. Only an HMAC of it is stored (`user_devices.device_id_hash`).
- **Session marker.** `ach_ss` has the format `<startedAt>.<sessionId>.<hmac>`. The legacy format `<startedAt>.<hmac>` is still accepted, so existing sign-ins are not forced out.
- **Per-request check.** Each request checks that the bound session exists, belongs to the user and is not revoked (15-second cache per instance).
- **New device.** A sign-in from an unknown device (after the first) records a `new_device` security event and a `device_added` history entry, and sends an in-app and email alert.
- **Revocation.** Changing or resetting the password, suspension, deactivation and security-staff action revoke every session. Users can revoke individual sessions or all other sessions.

## 5. Payment-account protection

1. **First account.** Saved after the account name is resolved with the bank.
2. **Change, step 1.** The new account is resolved and an OTP is emailed. The OTP is bound to an HMAC of the bank code and account number, and the full number is never stored.
3. **Change, step 2.** The code is verified and the binding must match. The change is then recorded in several places:
   - `payment_account_changes`
   - `account_change_history` (`payment_account_changed`)
   - `security_events` (`payment_account_change`)
   - an email alert to the user
4. **Cool-down.** A cool-down of `security.payment_account_cooldown_hours` (default 24) starts. During it, automated payouts are held.
5. **Destination snapshot.** When a payout is approved, the destination bank and last four digits are snapshotted onto the payout row by a trigger. The ledger row copies them.

## 6. Withdrawal security

`riskService.evaluateDisbursement` returns explainable hold reasons:

- the recipient is under review or restricted
- the recipient's KYC is restricted, or their level is below `receive_payout`
- the recipient has no payout account, or it is disabled
- the payout account is in its cool-down
- the amount is at or above `risk.withdrawal_review_threshold_kobo`

The results are handled as follows:

- **Recording.** Reasons are stored on the instruction (`hold_reason`, `risk_evaluation`).
- **Automated transfers.** Held items are not sent.
- **Manual confirmation.** Confirming a held item needs an override reason, which is audited.
- **Large payouts.** Amounts at or above `finance.large_payout_threshold_kobo` need an approved `large_payout_confirm` request.
- **Self-payout.** Staff can never confirm or retry a payout to themselves.

## 7. Disputes and evidence

- **Case numbers.** Every case gets a `CASE-YYYY-NNNNNN` number from a sequence, assigned by a trigger.
- **Respondents.** For money disputes about a group or plan, the organiser or collector is recorded as respondent. They can see the case and add evidence and replies. Account-security reports are never shown to other members.
- **Evidence integrity.** Evidence files go to the private `dispute-evidence` bucket. The server computes a SHA-256 of each file, and rows are append-only. A correction is a new file that supersedes the old one.
- **Evidence access.** Staff opening another person's evidence must give a reason, which is written to `data_access_logs`. Signed URLs last 120 seconds.
- **Case history.** Status, assignment, evidence and linked transactions are recorded in `case_events`. Resolving a case requires a written resolution and an outcome.
- **Repeat complaints.** Three or more cases about the same collector in 30 days create a neutral review flag and a `repeated_disputes` security event ("no finding has been made").

## 8. Neutral language

Flags are prompts for review, never findings. The statuses are:

- **Users and risk:** `normal`, `review_required`, `restricted`
- **Security events:** `flagged`, `review_required`, `suspicious_activity`, `account_security_review`, `resolved`, `dismissed`

User-facing notices say a "routine review" is in progress. `riskService.explain` lists concrete factors and never uses words such as "fraud".

## 9. Records that cannot be erased

These tables are append-only: they reject UPDATE and DELETE through triggers.

- `audit_logs`, `account_change_history`, `kyc_events`
- `payment_account_changes`, `collector_status_history`
- `case_events`, `case_transactions`, `dispute_evidence`
- `data_access_logs`

`security_events` rejects DELETE, and only its investigation fields may be updated.

Ledger rows are never edited except for their status. Corrections are always new linked rows (`reversal`, `adjustment`).

Deactivation keeps all financial and security records.

## 10. Verification challenges, deletion requests and settings (migration 008)

- **Sensitive changes.** Changing your password, email or phone, and requesting deletion, all need the current password plus a single-use emailed security code (`security_challenges`). The code is bound to the user, the action and the session. It expires after 10 minutes, allows 5 attempts and is consumed atomically. Wrong codes are recorded as security events. See `AUTH_AND_EMAIL.md`.
- **Deletion requests** (`data_deletion_requests`):
  - Two types: account deletion and personal-data deletion.
  - A 7-day cancellation window, one open request per type, and no self-decision.
  - Completion by `privacy.requests.manage` staff with step-up.
  - Completing a request erases optional data only (`erase_optional_personal_data`). Identity, ledger, dispute, audit and security records are retained. Requests are never deleted.
- **User settings** (`user_preferences`) are all wired to behaviour:
  - Accessibility (UI-wide).
  - Messages: sound, ringtone, previews, automatic image loading, and reciprocal read receipts enforced by the server.
  - Privacy: online status enforced by the server.
  - Security: sign-in alerts for a new device or for every sign-in.
- **Social sign-in** creates `user_sessions` with `auth_method = oauth_google | oauth_facebook`. Linking and unlinking are recorded in the account history.
- **Notification categories** gain `groups`, `support` and `marketing`. `security` stays mandatory.

## 11. Operational notes

- **Deployment order.** Apply migrations 006, 007 and 008 **before** deploying this backend. Sign-in creates a `user_sessions` row, and reference data and permissions are read from the new tables.
- **Existing accounts.** Accounts created before this change have KYC level 0 until they add legal names, DOB and location (Profile → Details) and verify their phone. Until then, savings contributions return `KYC_LEVEL_REQUIRED` with the next step.
- **Payouts to unverified recipients.** Payouts to recipients below KYC level 2 are held for manual review; a finance admin can override with a reason.
- **Existing staff.** Existing ADMIN users keep operations access but lose KYC documents and settings. Grant COMPLIANCE_ADMIN or another specific role as needed.
