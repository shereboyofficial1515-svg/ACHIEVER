# Deploying ACHIEVER (Vercel + Render)

```
Browser ──HTTPS──▶ Vercel (React/Vite static build, frontend/)
                     │  /api/*  (rewrite in frontend/vercel.json)
                     ▼
                   Render web service (Express API, backend/)
                     ├─ Supabase (Postgres, Auth, Storage)
                     ├─ Paystack (payments + webhook)
                     ├─ Resend (email)   ├─ Termii (SMS)
                     └─ LiveKit (calls: tokens minted here)
```

All secrets live on Render. Vercel only holds public build settings (`VITE_*`).

## 1. Choose how the browser reaches the API

Sign-in uses HTTP-only cookies. Browsers only send them reliably when the web app
and the API are on the **same site**. `*.vercel.app` and `*.onrender.com` are
different sites.

| Mode | VITE_API_URL (Vercel) | API_PUBLIC_URL (Render) | Cookies | Works in |
|---|---|---|---|---|
| **A. Forward /api through Vercel (recommended)** | *empty* | *empty* | SameSite=Lax, first-party | All browsers |
| B. Custom domains on one site (`app.achiever.ng` + `api.achiever.ng`) | `https://api.achiever.ng` | `https://api.achiever.ng` | SameSite=Lax | All browsers |
| C. Call Render directly (`*.vercel.app` → `*.onrender.com`) | `https://achiever-api-uu08.onrender.com` | same | SameSite=None; Secure (automatic) | Chrome/Edge. **Safari blocks; Firefox isolates** (Google/Facebook sign-in fails) |

Mode A needs one line in `frontend/vercel.json`: the `/api/:path*` rewrite
destination must be your Render URL (default `https://achiever-api-uu08.onrender.com`,
matching the service name in `render.yaml`). In mode B or C that rewrite is unused
and harmless.

## 2. Backend on Render

1. Render → **New → Blueprint** → select the repository (uses `render.yaml`), or
   create a Web Service manually with:
   - Root directory `backend`
   - Build command `npm ci --omit=dev` (plain Node.js, no build step)
   - Start command `npm start` (`node src/server.js`; never `npm run dev`)
   - Health check path `/api/health`
   - Node 22 recommended (`NODE_VERSION=22`); Node 20.3+ also works
2. Fill in the environment variables:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | set by Render automatically — do not set |
| `CLIENT_URL` | `https://<your-app>.vercel.app` (later your custom domain) |
| `SERVER_URL` | `https://achiever-api-uu08.onrender.com` |
| `API_PUBLIC_URL` | empty in mode A; the API URL in modes B/C |
| `TRUST_PROXY_HOPS` | `4` in mode A (Vercel → Cloudflare → Render proxy → API); `3` when browsers call Render directly. Check with `/api/health/client`: `ip` must be your own address. |
| `PUBLIC_SITE_URL` | same as `CLIENT_URL` (email logos and links) |
| `CORS_EXTRA_ORIGINS` | optional, e.g. the old domain while moving to a custom domain |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `JWT_SECRET`, `SESSION_SECRET`, `IDENTITY_HASH_SECRET` | 32+ random characters. They key hashes stored in the database (devices, payout accounts, invites, BVN/NIN). Use the **same values** as any environment that already wrote to this Supabase project; new values are only safe on a fresh database. |
| `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_SECRET_KEY` | Paystack → Settings → API Keys (test keys until go-live) |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPPORT_EMAIL` | Resend, with a verified sending domain, e.g. `ACHIEVER <no-reply@achiever.ng>` |
| `TERMII_API_KEY`, `TERMII_SENDER_ID` | Termii; the sender ID (e.g. `ACHIEVER`) must be approved |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit Cloud project (`wss://…livekit.cloud`) |
| `ENABLE_JOBS` | `true` on exactly one instance |

The server refuses to start if a required variable is missing (it prints the
variable **names** only), and logs an error if `CLIENT_URL`/`SERVER_URL` are not
`https://` in production.

3. Check `https://achiever-api-uu08.onrender.com/api/health` (liveness) and
   `/api/health/ready` (database + which integrations are configured).

Render free instances sleep when idle; the first request after a sleep can take
30–60 s. Use a paid instance for production.

## 3. Frontend on Vercel

1. Vercel → **Add New Project** → the repository → **Root Directory `frontend`**.
   Framework, install/build commands and output (`dist`) come from `vercel.json`.
2. Environment variables (Production):

| Variable | Value |
|---|---|
| `VITE_API_URL` | empty (mode A) or the API URL (modes B/C) |
| `VITE_PUBLIC_SITE_URL` | `https://<your-app>.vercel.app` (canonical links and share images on the public pages) |
| `VITE_SUPPORT_EMAIL` | your support address (otherwise the pages show `support@example.com`) |

   Never add Supabase, Paystack, Resend, Termii, LiveKit or JWT secrets here: every
   `VITE_*` value is visible to anyone in the JavaScript bundle. The web app does
   not need any Supabase key.
3. `vercel.json` provides:
   - SPA fallback: `/login`, `/app/...` etc. load `index.html` on refresh.
   - Static files are served first, so `/documentation.html`, `/terms.html`, … and
     `/brand/*` are never intercepted; `/documentation`, `/terms`, … also work.
   - Security headers: CSP (no inline scripts), `X-Frame-Options: DENY`,
     `nosniff`, `Referrer-Policy`, `Permissions-Policy` (camera/microphone allowed
     for calls on this site only), HSTS.

## 4. Supabase

- Apply every file in `supabase/migrations/` in order (SQL editor or `supabase db push`).
  `/api/health/ready` reports a missing schema or missing privileges by name.
- **Auth → URL Configuration**
  - Site URL: `CLIENT_URL`
  - Redirect URLs: `<CLIENT_URL>/api/auth/oauth/callback` (mode A) or
    `<API_PUBLIC_URL>/api/auth/oauth/callback` (modes B/C). Remove localhost
    entries from the production project.
- **Auth → Providers**: enable Google and Facebook with their client ID/secret.
- Storage buckets are created by the migrations. `verification-documents`,
  `message-attachments`, `receipts` and `dispute-evidence` are private (signed URLs);
  `avatars` and `group-images` are public by design.
- Do not load seed or test data into production. The repository has no seed file.

## 5. OAuth providers

- **Google Cloud Console → OAuth client**: Authorized redirect URI =
  `https://<project-ref>.supabase.co/auth/v1/callback`; Authorized JavaScript
  origin = `CLIENT_URL`.
- **Meta for Developers → Facebook Login**: Valid OAuth Redirect URI =
  `https://<project-ref>.supabase.co/auth/v1/callback`; App Domains = your frontend
  domain; the app must be switched to **Live** mode.

## 6. Paystack

- Webhook URL: `https://achiever-api-uu08.onrender.com/api/paystack/webhook` (call Render
  directly, not through Vercel). The API checks the HMAC signature, stores each event
  once (duplicates are ignored), and confirms charges by querying Paystack
  server-side before crediting.
- Callback after checkout is `<CLIENT_URL>/app/payments/callback` (automatic).

## 7. LiveKit

- Webhook (optional): `https://achiever-api-uu08.onrender.com/api/calls/livekit/webhook`.
- Tokens are minted by the API (`/api/calls/...`); the secret never reaches the browser.

## 8. First administrator

No default admin exists. After the person has registered and verified their account:

```bash
cd backend
npm run grant-role -- <email> SUPER_ADMIN
```

Run it from a trusted machine with the production `backend/.env` (or a Render
shell). ACHIEVER has no two-step (MFA) sign-in yet, so give staff accounts long unique
passwords, and protect the Supabase, Render, Vercel and Paystack dashboards with MFA.

## 9. Moving to a custom domain later

1. Add the domain in Vercel.
2. Render: `CLIENT_URL` and `PUBLIC_SITE_URL` → new domain; add the old domain to
   `CORS_EXTRA_ORIGINS` during the switch.
3. Vercel: `VITE_PUBLIC_SITE_URL` → new domain; redeploy.
4. Supabase Site URL and Redirect URLs, Google/Facebook domains → new domain.

No code changes are required.

## 10. After each deployment

1. Open the site; open `/api/health` through the site (`https://<app>/api/health`).
2. Register → verify email → verify phone → sign in → refresh the dashboard →
   sign out → sign in again.
3. Google and Facebook sign-in.
4. Paystack test payment → the webhook is shown as processed in Admin → Transactions.
5. Start a voice call between two accounts.
6. Open `/documentation.html`, `/terms.html`, `/privacy.html`, `/support.html`.

## Local production check

```bash
cd frontend && npm ci && npm run build
cd ../backend && npm ci --omit=dev && NODE_ENV=production PORT=4200 npm start
```

## Operational notes

- Every response carries `X-Request-Id`; error responses include it and the same id
  appears in the Render logs.
- Logs redact passwords, codes, tokens, cookies, BVN/NIN and account numbers.
- External calls time out: Supabase 30 s, Paystack 20 s, Termii 15 s, Resend 15 s,
  LiveKit clean-up 10 s.
- Rate limits are in memory per instance. When running more than one instance, plug
  a shared store into `backend/src/middleware/rateLimiters.js`.
