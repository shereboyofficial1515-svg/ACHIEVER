# ACHIEVER — Authentication, social sign-in and email

## Who does what

| Concern | Handled by |
|---|---|
| Credentials (password hashes), sessions and tokens, Google/Facebook identities | **Supabase Auth**, the authentication authority |
| Email verification, password reset, and email/phone change codes | ACHIEVER API (see below) |
| All ACHIEVER emails, including verification codes, security alerts, receipts, reminders and support | **Resend**, using the branded templates in `backend/src/emails/` |
| SMS codes and alerts | Termii |

**Why codes are issued by the API.** Verification, reset and change codes are generated and checked on ACHIEVER's server, then delivered by Resend. The protections:

- Codes are stored only as HMAC hashes.
- Each code expires after 10 minutes and allows 5 attempts.
- There is a 60-second resend cooldown.
- A code is bound to its purpose and to the pending new value.
- A code can be used once.

Supabase Auth still stores passwords and issues sessions. Password resets are applied with `auth.admin.updateUserById`, and email changes with `auth.admin.updateUserById({ email, email_confirm: true })`, only after the code check passes.

**Supabase's own emails are not used.** Accounts are created with `email_confirm: true`, and ACHIEVER sends its own verification code. As a result, Supabase's built-in email sender (which only reaches project team members) is never relied on. If you later want Supabase to send auth emails, set custom SMTP to Resend in Supabase: Authentication → Emails → SMTP (`smtp.resend.com`, port 465, username `resend`, password = a Resend API key). That change is optional and does not affect the current flows.

## Verification challenges (sensitive changes)

These actions require a verification challenge:

- password change
- email change
- phone change
- deletion request

**How a challenge works:**

1. `POST /api/auth/challenges { action, password }` checks the current password.
2. A 6-digit code is emailed to the verified address.
3. The protected endpoint receives `{ challengeId, code }`.

**What the server checks.** The code must belong to the same user, action and session. It must not be expired, attempts must remain, and it must not have been used already. The challenge is then consumed atomically. After 5 wrong codes the challenge locks and a security event is recorded. There is a limit of 5 challenges per user per hour. The frontend never decides whether a code is valid.

**Change flows:**

- **Email change.** A challenge code goes to the current email, then a confirmation code to the new address. Supabase Auth and the profile are updated server-side, and a notice is sent to the old address.
- **Phone change.** A challenge code goes to the email, then an SMS OTP to the new number. The phone is updated, and notices go to the old number (SMS) and the email address.
- **Password change.** The challenge code, the current password and the new password are all required. All other sessions are revoked, a history entry and a security event are written, and a confirmation email is sent.

## Google and Facebook sign-in (Supabase OAuth)

The flow runs on the server, so tokens stay in HTTP-only cookies:

```
Login page → GET /api/auth/oauth/{google|facebook}/start?next=/app
  → signed, HTTP-only state cookie (PKCE verifier) → provider consent
  → Supabase → GET /api/auth/oauth/callback?code=…
  → existing ACHIEVER profile: signed in (new-device alert, session recorded)
  → no profile yet: /complete-profile (legal name, DOB, phone, location, terms, privacy)
```

**New social users.** A social identity does not satisfy KYC. Phone verification and ID verification are still required for contributions, payouts and operator roles.

**Existing email.** If an ACHIEVER account already uses the email and Supabase did not link the identity itself, sign-in is refused with guidance. The user signs in with their password and links Google or Facebook from Settings → Security. Accounts are never merged by name.

**Linking and unlinking.** Available in Settings → Security, it needs a password step-up, and the account must keep at least one sign-in method. Supabase links a provider automatically only when the provider email matches an already verified email on the same Supabase user.

### Setup (done in the Supabase dashboard and the provider consoles)

1. **Supabase → Authentication → Sign In / Providers**: enable Google and/or Facebook, and paste the client ID and secret.
   - Google Cloud Console: OAuth client (Web). The authorised redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Meta for Developers: Facebook Login. The valid OAuth redirect URI is the same Supabase callback. Request the `email` permission.
2. **Supabase → Authentication → URL Configuration → Redirect URLs**: add ACHIEVER's callback.
   - Development: `http://localhost:5173/api/auth/oauth/callback`
   - Production: `https://<your-domain>/api/auth/oauth/callback`, or set `OAUTH_CALLBACK_URL`.
3. For account linking, enable **Manual linking** under Authentication → Settings.
4. The login and registration pages show a provider button only when Supabase reports that provider as enabled (`GET /api/auth/providers`).

## Environment variables (backend)

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Sending email (server-side only; never in the frontend) |
| `SUPPORT_EMAIL` | Reply-to address and the support address in email footers |
| `PUBLIC_SITE_URL` | Public origin serving `/brand/*` and `/*.html`, used for email images and links. Must be publicly reachable in production. Defaults to `CLIENT_URL`. |
| `OAUTH_CALLBACK_URL` | Optional; defaults to `CLIENT_URL/api/auth/oauth/callback` |
| `TERMII_API_KEY`, `TERMII_SENDER_ID` | SMS |

Frontend build (`frontend/.env`):

- `VITE_SUPPORT_EMAIL` is shown on the public pages.
- `PUBLIC_SITE_URL` enables canonical URLs and `sitemap.xml` for the public pages.

## Email template system

- **Location.** Templates live in `backend/src/emails/`:

  ```
  layouts/baseEmail.js      header (logo), card, details table, CTA, security note, footer, unsubscribe
  auth/                     verify email, reset password, security code, confirm new email, welcome, login alert,
                            password/email/phone changed
  payments/ osusu/ collector/ support/ security/   notification emails built from real records
  notifications/            notification type → template registry
  ```

- **Sending.** `services/emailService.js` exposes the sending functions, for example `sendWelcomeEmail`, `sendLoginAlert`, `sendPasswordChanged` and `sendNotificationEmail`.
- **Data.** Notification emails load the referenced transaction, group, plan, contribution or payout records. Fields that don't exist are omitted and never invented.
- **Unsubscribe.** Only non-transactional mail (platform notices and marketing) carries a signed one-click unsubscribe link and the `List-Unsubscribe` headers. Security and money emails are never unsubscribable.
