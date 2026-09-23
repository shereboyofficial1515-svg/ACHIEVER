# Setup, configuration and deployment

## 1. Prerequisites
* Node.js 20+ (tested on 24), npm 10+
* A Supabase project (or the Supabase CLI for local development)
* Accounts for Paystack, Resend, Termii and LiveKit (Cloud or self-hosted). A bill-payment (VTU) provider account if you enable bills.

## 2. Environment variables

### Backend (`backend/.env`, template in `backend/.env.example`)
| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | | runtime |
| `CLIENT_URL` | ✔ | exact origin of the React app (CORS, email links, Paystack callback) |
| `SERVER_URL` | ✔ | public API origin |
| `CORS_EXTRA_ORIGINS` | | comma-separated extra allowed origins |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | ✔ | Project Settings → API. **Service role key is server-only.** |
| `JWT_SECRET` | ✔ (≥32 chars) | HMAC key for OTP codes and invitation tokens |
| `SESSION_SECRET` | ✔ (≥32 chars) | signs CSRF tokens and the session-start cookie |
| `IDENTITY_HASH_SECRET` | ✔ (≥32 chars) | keyed hash of BVN/NIN numbers. **Never rotate without a migration plan** — existing hashes stop matching. |
| `SESSION_MAX_AGE_HOURS` | | absolute session lifetime (default 168) |
| `PAYSTACK_SECRET_KEY` | ✔ | server-only; also used to verify webhooks |
| `PAYSTACK_PUBLIC_KEY` | | not needed by the redirect checkout; kept for future inline checkout |
| `PAYSTACK_BASE_URL`, `PAYSTACK_CHANNELS` | | defaults `https://api.paystack.co`, `card,bank,ussd,bank_transfer` |
| `PAYSTACK_TRANSFERS_ENABLED` | | `true` only once Transfers are enabled on your Paystack business |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPPORT_EMAIL` | email | without a key emails are skipped (logged in development) |
| `TERMII_API_KEY`, `TERMII_SENDER_ID`, `TERMII_BASE_URL`, `TERMII_CHANNEL` | SMS | base URL is account-specific in the Termii dashboard |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` | calls | `LIVEKIT_URL` is the `wss://…` URL |
| `BILL_PROVIDER` | | `disabled` (default) or `vtpass` |
| `VTPASS_BASE_URL`, `VTPASS_API_KEY`, `VTPASS_PUBLIC_KEY`, `VTPASS_SECRET_KEY` | if vtpass | sandbox: `https://sandbox.vtpass.com/api` |
| `IDENTITY_PROVIDER` | | `manual` (staff document review) until an adapter is added |
| `ENABLE_JOBS`, `ENABLE_REALTIME_BRIDGE` | | background jobs / realtime fan-out |

Generate secrets with `openssl rand -hex 32`.

### Frontend (`frontend/.env`, template in `frontend/.env.example`)
`VITE_API_URL` (empty when the API is served under the same origin at `/api`) and `VITE_SUPPORT_EMAIL`. **Never place secrets in `VITE_*` variables** — they are bundled into public JavaScript.

## 3. Supabase

1. Create a project. In **Authentication → Providers → Email**: enable email/password; set minimum password length ≥ 10. ACHIEVER sends its own verification emails, so Supabase confirmation emails are unnecessary (users are created with `email_confirm: true` server-side).
2. **Authentication → Sessions**: consider enabling refresh-token rotation and reuse detection (default on).
3. Apply migrations in order:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
   or run the five files in `supabase/migrations/` in the SQL editor in filename order.
   Migration `…005_api_role_grants.sql` is required: newer Supabase projects do not grant table privileges to the API roles automatically, and without it every API query fails with `permission denied for table …`. `GET /api/health/ready` reports this as `DATABASE_PRIVILEGES`.
4. **Storage**: migration `…004_storage.sql` creates buckets. Public: `avatars`, `group-images`. Private: `message-attachments`, `verification-documents`, `receipts`. No storage policies are granted to browser roles; the API uploads with the service role after validating type/size, and serves private files via short-lived signed URLs.
5. **Realtime**: migration `…003` adds `messages`, `notifications`, `calls`, `call_participants` to the `supabase_realtime` publication. Confirm under **Database → Replication**.
6. Create your first user through the app, then grant platform access from a trusted machine:
   ```bash
   cd backend && npm run grant-role -- you@example.com SUPER_ADMIN
   ```

### RLS explained
The API uses the service role and enforces authorisation in code. RLS is enabled on every table as a second barrier: authenticated users can only `SELECT` rows they are entitled to (own ledger rows, groups they belong to, conversations they are in); writes to financial tables are revoked outright; business functions cannot be executed by browser roles. `supabase/tests/database/rls.test.sql` proves these rules.

## 4. Paystack
1. Dashboard → Settings → API Keys & Webhooks: copy the secret key to `PAYSTACK_SECRET_KEY`.
2. Webhook URL: `https://<api-host>/api/paystack/webhook`. The endpoint verifies `x-paystack-signature` (HMAC-SHA512 of the raw body with your secret key). Optionally restrict by Paystack's published webhook IPs at your load balancer.
3. Callback URL is sent per transaction (`${CLIENT_URL}/app/payments/callback`) — no dashboard setting needed.
4. Refunds use `POST /refund`. Transfers (automated payouts) additionally require: Transfers enabled on your business, sufficient balance, **transfer OTP disabled** for API-initiated transfers, `PAYSTACK_TRANSFERS_ENABLED=true`, and switching `payouts.execution_mode` to `paystack_transfer` in Admin → Settings.
5. Use test keys first. Paystack test cards and bank-transfer simulations are documented at paystack.com/docs.

## 5. Resend
Verify your sending domain (SPF/DKIM), create an API key, set `RESEND_FROM_EMAIL` to an address on that domain. Templates live in `backend/src/integrations/resend/templates.js`.

## 6. Termii
Register an alphanumeric Sender ID (approval required for Nigerian networks), then set `TERMII_API_KEY`, `TERMII_SENDER_ID`, and `TERMII_BASE_URL` from your dashboard. Use the `dnd` channel for OTPs so they reach DND-registered numbers. SMS failures never break a financial flow; they are retried from the outbox.

## 7. LiveKit
Create a LiveKit Cloud project (or self-host). Set `LIVEKIT_URL` (`wss://…`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Add a webhook to `https://<api-host>/api/calls/livekit/webhook` (signed with the same key/secret). Browsers require HTTPS for camera/microphone except on `localhost`.

## 8. Bill payments (VTpass adapter)
Set `BILL_PROVIDER=vtpass` and the VTpass keys; start with the sandbox base URL. Service IDs and response codes are in `backend/src/integrations/bills/vtpassProvider.js` — confirm against current VTpass documentation for your account. To use another aggregator, implement the interface documented in `backend/src/integrations/bills/index.js` and register it there.

## 9. Identity verification (BVN/NIN)
The default `manual` provider queues every submission for staff review of an uploaded document (Admin → Verification). To automate, contract a licensed Nigerian identity provider and add an adapter implementing `verify()` (see `backend/src/integrations/identity/index.js`). Adapters must never persist or log raw numbers.

## 10. Local development
```bash
# backend
cd backend && cp .env.example .env   # fill in values
npm install
npm run dev                           # http://localhost:4100

# frontend (second terminal)
cd frontend && cp .env.example .env
npm install
npm run dev                           # http://localhost:5173 (proxies /api → 127.0.0.1:4100)
```
ACHIEVER's API uses port 4100 so it does not collide with other local APIs on the common 4000/5000 ports (on Windows two servers can bind the same port on different interfaces and silently split traffic). If you change `PORT`, set `API_PROXY_TARGET` for the Vite dev server to match. Check the backend with `GET /api/health` (liveness) and `GET /api/health/ready` (database privileges and integration status). Without Resend/Termii configured in development, OTP codes are written to the API log (never in production).

## 11. Testing
```bash
cd backend && npm test          # unit, service and HTTP security tests (vitest + supertest)
cd frontend && npm test         # money parsing/formatting
supabase test db                # pgTAP: financial rules + RLS (needs `supabase start`)
```
Covered edge cases include: webhook delivered twice, amount mismatch, duplicate payment for a paid contribution, pending/failed payments, user refreshing the callback page, second approval of the same payout, completing a payout twice, member paying late, member defaulting after payout, collector plan maturity, savings arriving during a return, commission maths, cross-user access attempts, CSRF, CORS, and LiveKit tokens for non-participants.

## 12. Production deployment
* **API**: any Node host (Render, Railway, Fly.io, ECS, a VM). `npm ci --omit=dev && npm start`. Set `NODE_ENV=production`. Run behind HTTPS; `app.set('trust proxy', 1)` assumes exactly one proxy hop — adjust if different.
* **Frontend**: `npm run build` → static `frontend/dist` on any CDN/static host. Configure SPA fallback to `index.html`.
* **Same-site cookies**: serve both under one registrable domain (e.g. `app.example.ng` + `api.example.ng`, or reverse-proxy `/api` on the app domain). Cross-site deployments will break cookie auth by design.
* **Scaling**: jobs take DB leases (`job_locks`), so multiple instances are safe; set `ENABLE_JOBS=false` on web-only instances if preferred. Rate limiting is in-memory per instance — use a shared store (e.g. `rate-limit-redis`) behind a load balancer. SSE needs proxies with buffering disabled and idle timeouts > 60 s.
* **Backups**: enable Supabase PITR. The ledger and audit tables are append-only; never truncate them.
* **Monitoring**: ship pino JSON logs; alert on `webhook processing failed`, `transfer initiation failed`, `database error`, and growth in `payment_webhooks.status='failed'` or `bill_payments.status='processing'`.

## 13. Security checklist (pre-launch)
- [ ] All secrets set via the host's secret manager; `.env` never committed; different keys per environment
- [ ] `NODE_ENV=production`, HTTPS everywhere, HSTS enabled (automatic in production)
- [ ] `CLIENT_URL` exact; no wildcard CORS
- [ ] Paystack webhook URL set; test signature rejection
- [ ] Transfer OTP settings reviewed; payout mode deliberately chosen
- [ ] Supabase: service role key only on the API; anon key unused by the browser; RLS tests pass
- [ ] First SUPER_ADMIN bootstrapped; staff accounts use strong unique passwords
- [ ] Undertaking text and legal pages reviewed by counsel; regulatory/custody model decided
- [ ] Rate limiting backed by a shared store if running more than one instance
- [ ] Log retention and PII redaction verified (pino redaction list in `utils/logger.js`)
- [ ] Backups/PITR enabled; restore tested
- [ ] Dependency audit (`npm audit`) reviewed

## 14. Troubleshooting
| Symptom | Likely cause |
|---|---|
| `Invalid environment configuration` on start | a required variable is missing/short — the message lists which |
| Vite shows `http proxy error … ECONNRESET/ECONNREFUSED` | the API is not running on the proxy target, was restarting, or another local server shares the port. Check `http://127.0.0.1:4100/api/health` returns `ACHIEVER API is running` |
| `permission denied for table …` / readiness `DATABASE_PRIVILEGES` | apply `supabase/migrations/20260923000005_api_role_grants.sql` |
| Payments return `PAYMENTS_NOT_CONFIGURED` | `PAYSTACK_SECRET_KEY` is not an `sk_test_…`/`sk_live_…` key |
| Every POST returns `CSRF_INVALID` | cookies blocked (cross-site deployment) or the client did not call `/auth/csrf` |
| Login works but next request is 401 | API and app on different sites; cookies not sent. Use same-site hosting |
| Payment stuck on "Processing payment…" | webhook not reaching the API; the reconciliation job verifies after 10 minutes. Check Paystack webhook logs |
| `PAYOUT_ALREADY_PROCESSED` | payout was approved once already (by design) |
| `CYCLE_NOT_FUNDED` | not every member has paid the cycle |
| Calls return `CALLS_NOT_CONFIGURED` | LiveKit variables missing |
| Bills show "not available yet" | `BILL_PROVIDER=disabled` |
| No realtime updates | `ENABLE_REALTIME_BRIDGE=false`, tables missing from `supabase_realtime` publication, or a proxy buffering SSE |
| Emails not delivered | Resend domain not verified; see `notifications.email_status='failed'` and `last_error` |
