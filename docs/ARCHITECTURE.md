# ACHIEVER — Architecture

ACHIEVER is a Nigerian digital Susu/Ajo platform with two **separate** financial products — **Osusu** (rotational group savings) and **Collector** (individual savings held by a collector) — plus bill payments, messaging and calling.

> **Regulatory position.** ACHIEVER is a record-keeping and payment-coordination system. It does not claim CBN licensing, deposit insurance, escrow status or any regulatory approval. The architecture separates *payment initiation*, *payment confirmation*, *ledger recording*, *payout instruction* and *movement of funds* so that a regulated custody/payments partner can be slotted in before launch (see §9).

---

## 1. System overview

```
 Browser (React SPA)                          Third parties
 ───────────────────                          ─────────────
  HTTP-only cookies ─┐                         Paystack  (collection, transfers, refunds)
  X-CSRF-Token       │                         Resend    (email)
  EventSource (SSE) ─┤                         Termii    (SMS)
  livekit-client ────┼──── WebRTC ───────────▶ LiveKit   (voice / video rooms)
                     ▼                         VTU provider (bills; adapter)
 ┌───────────────────────────────────────┐    Identity provider (BVN/NIN; adapter)
 │ Express API (Node 20+)                │
 │  middleware: helmet, CORS, rate-limit, │◀── Paystack webhooks (HMAC-SHA512)
 │   CSRF, auth, RBAC, zod validation     │◀── LiveKit webhooks (signed JWT)
 │  controllers → services → repositories │
 │  jobs (node-cron + DB job leases)      │
 │  realtime bridge (Supabase → SSE)      │
 └──────────────┬────────────────────────┘
                │ service role (server only)
 ┌──────────────▼────────────────────────┐
 │ Supabase                               │
 │  Postgres: schema, RLS, SECURITY       │
 │   DEFINER financial functions, triggers│
 │  Auth: credential store (bcrypt)       │
 │  Storage: public + private buckets     │
 │  Realtime: postgres_changes            │
 └────────────────────────────────────────┘
```

**Key decisions**

| Decision | Why |
|---|---|
| All writes go through the API; the browser never talks to Supabase directly | Server-side authorisation is the single enforcement point; secrets never reach the client |
| Money-moving logic lives in Postgres functions (`supabase/migrations/…002`) | Each financial operation is one atomic transaction with row locks; supabase-js has no multi-statement transactions |
| RLS enabled on every table anyway | Defence in depth if the anon key is ever used with a user JWT |
| Amounts stored as `BIGINT` kobo | No floating-point error |
| Ledger (`transactions`) is append-only (triggers) | Auditable; corrections are new entries |
| Session in HTTP-only cookies + CSRF token | No tokens in `localStorage` |
| SSE instead of client Supabase Realtime | Browser holds no DB token; events are filtered per user on the server |

---

## 2. Repository layout

```
backend/
  src/
    config/            env.js (validated with zod), constants.js
    integrations/      supabase/ paystack/ resend/ termii/ livekit/ bills/ identity/
    middleware/        auth, authorize, csrf, rateLimiters, validate, upload, errorHandler
    repositories/      one module per aggregate; all Supabase queries live here
    services/          business logic (auth, osusu, collector, payment, payout, bill, …)
    controllers/       thin HTTP adapters
    routes/            route tables + per-route validation / role gates
    validators/        zod schemas
    jobs/scheduler.js  background jobs with DB leases
    app.js, server.js
  scripts/grantRole.js bootstrap the first SUPER_ADMIN
  tests/               vitest + supertest
frontend/
  src/
    components/ui      Button, Input, Modal, ConfirmDialog, Toast, Loader, Skeleton, Card,
                       StatCard, DataTable, StatusBadge/PaymentStatus, UserAvatar, EmptyState, ErrorState…
    components/domain  TransactionCard, NotificationItem, ChatWindow
    components/call    CallInterface (LiveKit), IncomingCall
    contexts/          Auth, Toast, Realtime (SSE), Call
    layouts/           AppLayout (sidebar / drawer / bottom nav), AuthLayout, navigation.js
    pages/             public, auth, app, osusu, collector, payments, bills, messages, support, admin
    services/api.js    fetch wrapper (cookies, CSRF, refresh, errors)
    hooks/ utils/ styles/
supabase/
  migrations/          001 schema · 002 functions · 003 RLS · 004 storage
  tests/database/      pgTAP tests (financial rules, RLS)
docs/                  this folder
```

---

## 3. Database design

All tables live in `public`. Primary keys are UUIDs (`gen_random_uuid()`), except `audit_logs` (identity bigint). Every mutable table has `created_at` / `updated_at` (trigger).

### 3.1 Tables by domain

| Domain | Tables |
|---|---|
| Identity & access | `profiles` (1:1 `auth.users`), `roles`, `user_roles`, `otp_codes`, `payout_accounts` |
| Osusu | `osusu_groups`, `osusu_members`, `osusu_cycles`, `osusu_contributions`, `osusu_payouts` |
| Collector | `collector_accounts`, `collector_savers` (a savings *plan*), `collector_contributions`, `collector_returns`, `collector_commissions` |
| Ledger & payments | `transactions`, `payment_attempts`, `payment_webhooks` |
| Bills | `bill_payments` |
| Notifications | `notifications` (also the email/SMS outbox), `notification_preferences` |
| Messaging & calls | `conversations`, `conversation_members`, `messages`, `message_attachments`, `calls`, `call_participants`, `meetings` |
| Onboarding | `invites`, `verification_records`, `admin_undertakings` |
| Risk & support | `risk_flags`, `support_tickets`, `ticket_messages`, `ticket_assignments` |
| Platform | `audit_logs`, `app_settings`, `job_locks` |

`ticket_status` and `ticket_priority` are enforced as CHECK-constrained columns on `support_tickets`.

### 3.2 Relationships (abridged)

```
auth.users 1─1 profiles 1─* user_roles *─1 roles
profiles 1─* osusu_groups (admin_id)
osusu_groups 1─* osusu_members *─1 profiles
osusu_groups 1─* osusu_cycles 1─1 osusu_payouts
osusu_cycles 1─* osusu_contributions *─1 osusu_members
osusu_cycles *─1 osusu_members (recipient_member_id)
profiles 1─1 collector_accounts 1─* collector_savers *─1 profiles (saver_id)
collector_savers 1─* collector_contributions | collector_returns 1─0..1 collector_commissions
transactions *─1 profiles, 0..1 osusu_groups, 0..1 collector_savers, 0..1 bill_payments
osusu_contributions.transaction_id → transactions      (the ledger entry that paid it)
payment_attempts.transaction_id / refund_transaction_id → transactions
conversations 0..1 osusu_groups | 0..1 collector_savers | direct_key
conversations 1─* conversation_members, messages 1─* message_attachments
conversations 1─* calls 1─* call_participants; meetings 0..1 calls
```

### 3.3 Important constraints

* `osusu_members (group_id, user_id)` unique; `(group_id, payout_position)` unique (deferrable).
* `osusu_cycles (group_id, cycle_number)` unique; `osusu_payouts.cycle_id` unique → **one payout per cycle**.
* `osusu_contributions (cycle_id, member_id)` unique → one contribution per member per cycle.
* `collector_returns`: partial unique index — only one open return per plan.
* `collector_savers.balance >= 0`; commission percentage ≤ 20% (2000 bps).
* `payment_attempts.reference` unique; `payment_webhooks.event_key` unique → webhook idempotency.
* `verification_records`: unique `(id_type, id_number_hash)` where verified → one identity per account.
* `calls`: partial unique index — one live call per conversation.
* `transactions`: immutable amount/type/user/reference; final statuses cannot change (trigger); no deletes.
* `audit_logs`: no updates or deletes (trigger).

---

## 4. Financial engine (Postgres functions)

All are `SECURITY DEFINER`, executable **only by `service_role`**, lock the rows they touch, and raise `ACH:<status>:<CODE>:<message>` errors that the API maps to HTTP responses.

| Function | Purpose |
|---|---|
| `start_osusu_group` | Validates organiser, fixes payout order (join order / random / manual), creates every cycle + payout row, opens cycle 1 |
| `_open_osusu_cycle`, `open_due_osusu_cycles` | Creates contribution rows for all active members when a cycle opens |
| `confirm_payment` | **The only way money is recorded.** Locks the attempt, rejects amount/currency mismatch, applies to the target (contribution / savings plan / bill) or queues a refund for duplicates, writes the ledger entry, notification and audit row |
| `mark_payment_failed` | Failed/abandoned checkouts; flags repeated failures |
| `approve_osusu_payout` | Organiser-only; requires the cycle to be fully funded (re-derived from contribution rows), earlier payouts completed, recipient eligible and not yet paid |
| `complete_osusu_payout` | Writes the payout ledger entry, marks the recipient as paid out, opens the next cycle or completes the group; idempotent |
| `mark_overdue_contributions` | Default tracking: overdue members who **already received a payout** get `review_required` and a `post_payout_default` risk flag |
| `request/approve/reject/complete_collector_return` | Saver return workflow; commission recalculated at approval |
| `complete_collector_commission` | Pays the collector's commission |
| `mark_disbursement_processing / complete_disbursement / fail_disbursement / retry_disbursement` | One state machine for payouts, returns and commissions |
| `mature_collector_plans` | Moves plans to `matured` on their end date and notifies both parties |
| `record_bill_result` | Delivered → ledger success; failed → refund queued |
| `enqueue_notification` | Transactional outbox honouring preferences and de-duplication keys |
| `post_message`, `conversation_summaries` | Atomic message + attachments; inbox with unread counts |
| `osusu_group_summary`, `platform_overview` | Server-side figures for dashboards |

### Osusu cycle state machine

```
upcoming → open → funded → payout_pending → paid_out
                     ▲ all members paid     ▲ organiser approval   ▲ transfer confirmed
```

Payout: `scheduled → approved → processing → paid` (or `failed → approved` via retry).

### Collector plan state machine

```
active → matured → return_requested → return_processing → returned
   └──────────────┘ (early return)       ▲ collector/admin approval
```

Savings that arrive while a return is processing are **refunded, not added**, so the approved amount can never drift.

---

## 5. Authentication & authorisation

* **Credentials**: Supabase Auth (bcrypt). Users are created server-side with `auth.admin.createUser`. Supabase's own confirmation emails are not used; ACHIEVER verifies email and phone with its own OTPs (HMAC-hashed, 10-minute expiry, 5 attempts, 60-second resend cooldown).
* **Session**: on login the API sets three HTTP-only, `SameSite=Lax`, `Secure` (production) cookies:
  * `ach_at` access token, `ach_rt` refresh token (path `/api/auth`), `ach_ss` signed session-start time.
  * Absolute lifetime `SESSION_MAX_AGE_HOURS`. Password change/reset or suspension sets `profiles.sessions_revoked_at`, which invalidates every older session (including refresh).
* **CSRF**: signed double-submit token. `GET /api/auth/csrf` returns a token in the body and stores its HMAC in an HTTP-only cookie; mutating requests must send `X-CSRF-Token`.
* **Brute force**: IP rate limits on auth routes; per-account lockout after 5 failures for 15 minutes (with an email alert). Login errors never reveal whether an email exists.
* **Roles**: `SUPER_ADMIN, ADMIN, SUPPORT_ADMIN, OSUSU_ADMIN, OSUSU_MEMBER, COLLECTOR, SAVER`, always loaded from `user_roles` — never from the client or token.
* **Operator activation**: `OSUSU_ADMIN` / `COLLECTOR` may only create groups or savings relationships once phone is verified, identity is verified and the current undertaking is accepted (`requireActiveOperator`).
* **Resource authorisation** is enforced in services (organiser of *this* group, saver/collector of *this* plan, member of *this* conversation, participant of *this* call).

## 6. Row Level Security strategy

See `supabase/migrations/20260923000003_rls.sql`.

* RLS enabled on every table; only `SELECT` policies exist for `authenticated`.
* Financial and security tables additionally have `INSERT/UPDATE/DELETE` **revoked** from `anon` and `authenticated`.
* `otp_codes`, `payment_webhooks`, `job_locks` are not readable at all by browser roles.
* Users may update only `full_name`, `address`, `date_of_birth` on their own profile (column grant).
* Helper predicates (`is_group_member`, `is_group_admin`, `is_conversation_member`, `is_plan_party`, `has_role`) are `SECURITY DEFINER STABLE` with a fixed `search_path`.
* `EXECUTE` on all business functions is revoked from `public/anon/authenticated`.

## 7. Payments (Paystack)

```
User ─ Pay ─▶ API: initialize()                     (1) initiation
               ├─ insert payment_attempts (reference, server-side amount)
               └─ Paystack /transaction/initialize → authorization_url
User ─▶ Paystack checkout ─▶ redirect /app/payments/callback?reference=…
Callback page ─▶ API /payments/status/:ref ─▶ Paystack /transaction/verify   (2) confirmation
Paystack ─▶ POST /api/paystack/webhook (HMAC-SHA512 verified on raw body)
               └─ stored once (unique event_key) → verify via API again
confirm_payment() in one DB transaction                                      (3) ledger
```

* A contribution is never marked paid because the browser says so; both the callback and the webhook trigger an **API-side verification**, and `confirm_payment` is idempotent.
* Duplicate payments and amount mismatches are recorded, flagged, and refunded via Paystack `/refund`.
* Reconciliation job verifies checkouts older than 10 minutes whose webhook never arrived.
* Gift cards are **not** supported: Paystack does not process arbitrary gift cards. A future gift-card feature would be a separate provider/service.

## 8. Payout instruction vs. movement of funds

1. Organiser/collector **approves** (SQL, audited) → instruction only.
2. Execution rail from `app_settings.payouts.execution_mode`:
   * `manual` (default): platform finance admins see the queue at **Admin → Payouts**, move funds through the custody/bank partner, and record the bank reference.
   * `paystack_transfer`: requires `PAYSTACK_TRANSFERS_ENABLED=true`, a Paystack business with Transfers, OTP for transfers disabled for API use, and a verified recipient (`payout_accounts.paystack_recipient_code`).
3. The record is marked **paid only on confirmation** (`transfer.success` webhook or admin confirmation). Reversals after completion raise a high-severity review case; the ledger stays final.

## 9. Custody & compliance readiness

Pooled funds collected via Paystack settle to the merchant account configured in Paystack. Before production the operator must decide (with counsel) on a regulated custody model — e.g. a licensed partner holding funds in a designated account. The `execution_mode` switch, the disbursement state machine, the append-only ledger, `risk_flags`, `support_tickets`, `verification_records` and `admin_undertakings` are the extension points for KYC/AML monitoring, regulatory reporting and escrow integration.

## 10. Notifications

`enqueue_notification` writes an in-app row and decides email/SMS delivery from preferences (security alerts always go out). The dispatcher (`notificationService.dispatchPending`, every minute and after each event) claims each channel with an optimistic lock, sends via Resend (idempotency key = notification id) or Termii, retries up to 3 times, and enforces a daily SMS cap. De-duplication keys prevent repeat reminders.

## 11. Realtime, chat and calling

* **Realtime**: each API instance subscribes to Supabase Realtime `postgres_changes` for `messages`, `notifications`, `calls`, `conversation_members`, and forwards events to authorised users over `GET /api/events/stream` (SSE).
* **Chat**: group conversations are created with each Osusu group; collector plans get a saver↔collector chat; direct chats are only allowed between people who share a group or plan. Attachments are validated by magic bytes, stored in a private bucket, and served via 10-minute signed URLs. Read receipts use `conversation_members.last_read_at`.
* **Calls (LiveKit)**: `POST /api/calls` creates the call and participants; direct calls ring (`call.incoming` SSE), group calls are immediately joinable. Tokens are minted server-side per participant (`/api/calls/:id/accept|join|token`), scoped to one room, 2-hour TTL. Missed-call and stale-call cleanup runs every minute; LiveKit webhooks (`/api/calls/livekit/webhook`) keep state correct if a client disappears. Meetings can be started as group calls.

## 12. Bills

`bill_payments` → Paystack checkout → `confirm_payment` marks it paid → provider adapter delivers with our `provider_request_id` as the idempotency key. Unknown outcomes (timeouts) become `processing` and are re-queried with exponential backoff; definitive failures are refunded automatically. The default provider is `disabled` (no charge possible); `vtpass` is the included adapter.

## 13. Fraud / default monitoring

Neutral review statuses only (`review_required`, `risk_review`, `payment_overdue`) — never accusations. Automatic flags: post-payout default, amount mismatch, duplicate payment, large collector contributions (threshold in settings), repeated failed payments, collector-initiated early returns, repeated complaints against a collector, reversed transfers.

## 14. User flows (summary)

* **Registration**: account type (Osusu / Collector / Personal) → role → details → email OTP → dashboard. Operators then complete phone OTP → BVN/NIN → document review → undertaking.
* **Osusu organiser**: create group → invite / share code → approve members → (optional) set payout order → start → monitor cycle → approve payout when funded → payout executed/confirmed → next cycle opens automatically.
* **Osusu member**: accept invite or join by code → pay each cycle via Paystack → see paid/pending/overdue → receive payout in turn → keep contributing until the group completes.
* **Collector**: create collector account → invite saver with term and commission → monitor balances/maturities → approve returns → commission paid.
* **Saver**: accept invitation (terms visible) → save flexible amounts → plan matures → request return → receive balance minus commission.
* **Bills**: choose service → (electricity: verify meter) → Paystack → delivery or automatic refund → receipt/token.
* **Admin**: overview → verification queue → payout queue → risk review → support cases → audit logs → reports → settings.
