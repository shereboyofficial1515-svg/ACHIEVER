# ACHIEVER Site Administration

The admin platform is a **separate application** (`admin/`) with its own sign-in,
session, permissions, CSRF token, rate limits and deployment. The member app
(`frontend/`) contains no admin pages or links.

```
Member app (Vercel)  ── /api/*        ──┐
                                        ├──▶ ACHIEVER API (Render) ──▶ Supabase
Admin app  (Vercel)  ── /api/admin/*  ──┘        admin session only
```

## Separation guarantees

| Boundary | How it is enforced |
|---|---|
| Identity | An admin needs an **active `admin_accounts` row** *and* a staff role. A staff role alone opens nothing. |
| Sign-in | Email + password, then an **authenticator app code (TOTP)** or a single-use backup code. SMS is never used for admin sign-in. First sign-in enrols the authenticator. |
| Session | Opaque token in an HTTP-only cookie `ach_adm` (`SameSite=Strict`, `Path=/api/admin`), stored as an HMAC in `admin_sessions`. Idle timeout (default 30 min) and absolute lifetime (default 12 h). |
| API | `/api/admin/*` authenticates **only** with the admin cookie. Member cookies and bearer tokens are ignored, whatever roles the account holds. |
| Member sessions | Never carry staff roles or permissions (`/auth/me` strips them). |
| Database | `has_permission()` / `is_platform_staff()` return false, so a staff member's ordinary Supabase token grants no extra rows through RLS. All admin data flows through the API. |
| CSRF | Separate signed double-submit token (`/api/admin/auth/csrf`, cookie `ach_adm_csrf`). |
| Sensitive actions | Permission **and** an authenticator code entered in the last few minutes (`STEP_UP_REQUIRED` → the admin app asks for the code). |

## Roles and permissions

Authorisation is `role → permissions` (table `role_permissions`); code checks permissions, never role names.

| Role | Can | Cannot |
|---|---|---|
| SUPER_ADMIN | Everything, incl. administrators and settings | Erase audit history (append-only for everyone) |
| COMPLIANCE_ADMIN | KYC reviews, identity documents (logged), collectors, risk | Move money, change settings |
| FINANCE_ADMIN | Ledger, payouts, reversals (two-person), exports | Open identity documents, manage security |
| SECURITY_ADMIN | Security events, sessions, restrictions, admin activity | Payouts or reversals |
| SUPPORT_ADMIN | Support tickets, SMS status | KYC, ledger, security, audit |
| DISPUTE_ADMIN | Dispute cases and evidence (logged) | Settings, admins |
| CONTENT_ADMIN | Platform notices | Financial, KYC or security data |
| AUDITOR | Read-only ledger, audit/access logs, security events, exports | Any change |
| READ_ONLY_ADMIN | Read-only overview | Any change |

New permissions in migration 009: `admins.read`, `admins.manage`, `settings.read`,
`sms.read`, `sms.configure`, `reports.export`.

## Creating the first administrator

There is no default admin account or seeded password.

1. The person registers in the member app and verifies their email.
2. From a trusted machine with the target environment's `backend/.env`:
   ```bash
   cd backend
   npm run admin:create -- someone@yourdomain.com SUPER_ADMIN
   ```
3. They sign in at the admin app, set up an authenticator app, and save their backup codes.

Further administrators: **Administrators → Add administrator** (needs `admins.manage` and an authenticator code).

Guards:
- nobody can change their own admin access;
- only a super admin can grant, change or disable a super admin;
- the last active super admin cannot be demoted or disabled.

## Recovery

- **Forgot password:** use "Forgot your password?" on the admin sign-in page (emailed code). Every admin session ends; the authenticator is still required.
- **Lost phone:** sign in with a backup code, then create new backup codes under **My admin account**.
- **Lost phone and backup codes:** another administrator uses **Reset MFA** (reason required, audited, emailed). The person enrols a new authenticator at the next sign-in.

## Audit and data access

- Every admin action writes `audit_logs` (append-only) with:
  - actor, permission used and reason;
  - previous and new state;
  - request ID and admin session ID, plus IP and user agent.
- Opening sensitive data writes `data_access_logs` **before** the data is released, with the reason. This covers private profile fields, identity documents and dispute evidence.
- **Admin security** shows sign-ins and failures, sessions, role changes, configuration changes, sensitive access and financial overrides.

## Account states

| State | Sign in | Money movement | Notes |
|---|---|---|---|
| active | yes | yes | |
| pending_verification | yes | limited by KYC | until email is verified |
| verification_required | yes | **no** | set by staff |
| restricted | yes | **no** (payments, withdrawals, payout changes) | set by staff |
| suspended | **no** | no | sessions revoked |
| closed (deactivated) | **no** | no | records retained |

Each change has:
- a reason, actor and timestamp;
- an optional end date (a job restores the account when it passes);
- a row in `account_status_history` (append-only), an audit record and a notification to the user.

## SMS verification (Termii)

Termii is not removed; SMS verification is switched and monitored.

| State | Meaning | Phone verification |
|---|---|---|
| `SMS_ENABLED` | switch on, provider working | SMS code |
| `SMS_DISABLED` | switch off (**default in migration 009**) | the verified email covers the phone step; phone can be verified by SMS later |
| `SMS_PROVIDER_ERROR` | switch on but Termii not configured or failing | email fallback offered: "SMS verification is temporarily unavailable. Please use email verification." |

- **Settings → SMS verification (Termii):**
  - switches for verification and for notifications;
  - status: Operational, Degraded, Unavailable or Configuration required;
  - sender ID, last success and failure, failure counts and response time. API keys are never shown.
- **Changing a switch:**
  - needs `sms.configure`, a confirmation, a reason and an authenticator code;
  - it is audited as `admin.sms.verification_enabled` / `admin.sms.verification_disabled`;
  - it cannot be turned on while Termii credentials are missing.
- **Circuit breaker:** after 3 consecutive failures Termii is not called again for a back-off period (1 → 30 minutes). Users are offered the email fallback immediately.
- **Where the fallback applies:**
  - **Registration:** email verification is always required; the phone step follows the state above.
  - **Phone change:** always needs the current password plus an emailed code. With SMS working, a code is then sent to the new number. Otherwise the emailed code confirms the change and the number is marked "not yet verified by SMS". The owner is alerted either way.
- **Always recorded:** the fallback is stored on the profile (`phone_verification_waived_at`, `phone_verification_waiver`) and in the audit log.
- **Not weakened:** the fallback does not relax controls on withdrawals, payout-account changes, admin actions, collector approval or KYC (level 2+ still needs a verified government ID).

## Platform settings

`app_settings` rows are typed:
- **Type:** `value_type` is boolean, integer, string, enum or object, with min/max and options enforced by a database trigger.
- **Metadata:** category, label and a critical flag.
- **Every change:**
  - needs a reason;
  - adds a row to `app_setting_changes` (append-only);
  - writes an audit record;
  - for critical settings, needs an authenticator code.
- **Rules the database cannot check:**
  - withdrawals and operators need at least KYC level 2;
  - SMS cannot be enabled without Termii.

Wired settings include:
- SMS switches, maintenance mode, registration on/off;
- password minimum length (never below 10);
- sign-in attempts before a lock, and lockout duration;
- code expiry, attempts and resend cooldown;
- admin idle timeout, admin session lifetime and admin re-confirmation window.

Maintenance mode blocks the member API (except the status page) and never the admin API.

## Deployment (admin app)

| | |
|---|---|
| Vercel project | Root Directory `admin` (commands come from `admin/vercel.json`) |
| Vercel env | `VITE_ADMIN_API_URL` empty (the admin host forwards `/api` to Render) |
| `admin/vercel.json` | `/api/:path*` → your Render URL; SPA fallback; strict CSP (no external scripts or fonts), `noindex`, `no-store`, frame blocking |
| Render env | `ADMIN_CLIENT_URL=https://<admin domain>` (CORS), `ADMIN_SESSION_SECRET`, `ADMIN_MFA_ENCRYPTION_KEY` (32+ random chars each) |

`ADMIN_MFA_ENCRYPTION_KEY` encrypts authenticator secrets: changing it forces every
admin to re-enrol. If the two admin secrets are unset they are derived from
`SESSION_SECRET` (a warning is logged). Set dedicated values in production.

Apply `supabase/migrations/20260928000009_admin_platform.sql` **before** deploying
the API. The migration is backward compatible with the previous API version.

## Local development

```bash
cd admin && npm install && npm run dev      # http://localhost:5174, /api proxied to :4100
```
Add `ADMIN_CLIENT_URL=http://localhost:5174` to `backend/.env`.
