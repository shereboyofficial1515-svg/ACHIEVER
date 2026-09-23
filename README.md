# ACHIEVER

A Nigerian digital **Susu / Ajo** platform: rotational **Osusu** groups, individual **Collector** savings, verified Paystack payments, bill payments, group chat, and LiveKit voice/video calling.

> ACHIEVER is a record-keeping and payment-coordination platform. It is **not** a bank, holds no CBN licence or deposit insurance, and does not claim regulatory approval. The architecture is built so a regulated custody/payments partner and compliance modules can be added before public launch — see [docs/ARCHITECTURE.md §8–9](docs/ARCHITECTURE.md).

## Stack
| Layer | Technology |
|---|---|
| Frontend | React 18, React Router, custom CSS (no UI framework), Vite, livekit-client, lucide icons |
| Backend | Node.js, Express, zod, pino, helmet, express-rate-limit, multer + file-type |
| Data | Supabase Postgres (RLS, SECURITY DEFINER financial functions), Supabase Auth, Storage, Realtime |
| Integrations | Paystack (collection, transfers, refunds), Resend (email), Termii (SMS), LiveKit (calls), VTpass adapter (bills), pluggable BVN/NIN provider |

## What's inside
* **Osusu**: create groups, invite/approve members, payout order (join order, random draw or manual), automatic cycles, per-member paid/pending/overdue status, organiser payout approval only when a cycle is fully funded, post-payout default tracking, meetings, reports.
* **Collector**: collector accounts, invitation-based savings plans with agreed term and commission, flexible deposits, maturity, return workflow with server-side commission calculation.
* **Payments**: Paystack checkout → server-side verification → atomic ledger entry. Signed, idempotent webhooks; reconciliation; automatic refunds for duplicates, mismatches and failed bills.
* **Payouts**: instruction (approval) kept separate from movement of funds (manual finance queue or Paystack Transfers), confirmed before being marked paid.
* **Onboarding**: account type → role → details; email + phone OTP; BVN/NIN verification (only a keyed hash + last 4 digits stored); versioned operator undertaking with timestamp/IP.
* **Messaging & calls**: group, collector and direct chats with attachments (private storage, signed URLs), read receipts, SSE realtime; LiveKit one-to-one and group voice/video with server-minted tokens.
* **Notifications**: in-app + email + SMS outbox with preferences, de-duplication and SMS caps.
* **Admin console**: overview, users/roles, groups, collectors, ledger, payment attempts, payout execution queue, bills, identity verification, support/disputes, risk review, audit logs, reports (CSV), settings, broadcasts.
* **Security**: HTTP-only cookie sessions, CSRF tokens, rate limiting, lockout, RBAC from the database, zod validation, magic-byte upload checks, append-only ledger and audit log, RLS, redacted logs, no stack traces to clients.

## Quick start
```bash
# 1. Database: apply supabase/migrations/*.sql to your Supabase project (docs/SETUP.md §3)
# 2. API
cd backend && cp .env.example .env && npm install && npm run dev
# 3. Web app
cd frontend && cp .env.example .env && npm install && npm run dev
# 4. Bootstrap an administrator after registering through the app
cd backend && npm run grant-role -- you@example.com SUPER_ADMIN
```

## Tests
```bash
cd backend && npm test      # 89 tests: payments, idempotency, authorisation, sessions, payouts, HTTP security
cd frontend && npm test     # money parsing
supabase test db            # pgTAP: 46 financial-rule assertions + 14 RLS assertions
```

## Documentation
* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, database, financial engine, auth, RLS, payments, payouts, notifications, realtime, calls, flows
* [docs/API.md](docs/API.md) — endpoint specification
* [docs/SETUP.md](docs/SETUP.md) — environment variables, Supabase/Storage/RLS, Paystack, Resend, Termii, LiveKit, bills, identity, local dev, testing, deployment, security checklist, troubleshooting

## Before production
1. Decide the custody model for pooled funds with legal counsel; replace `/legal` with counsel-approved Terms and Privacy Policy.
2. Contract a BVN/NIN verification provider (or keep manual review) and a bill-payment aggregator.
3. Work through the security checklist in [docs/SETUP.md §13](docs/SETUP.md).
