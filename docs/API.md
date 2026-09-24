# ACHIEVER REST API

Base path: `/api`. JSON in, JSON out. Amounts are **integers in kobo** (₦1 = 100).

## Conventions

**Success**
```json
{ "success": true, "message": "Contribution recorded successfully", "data": {}, "meta": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 } }
```
**Error**
```json
{ "success": false, "message": "Unable to process contribution", "error": { "code": "PAYMENT_FAILED", "requestId": "…", "details": { "fields": { "amount": "…" } } } }
```

* Auth: HTTP-only cookies set by `/auth/login` / `/auth/register`. (A `Authorization: Bearer <access token>` header is also accepted for non-browser clients.)
* CSRF: every non-GET request must include `X-CSRF-Token` obtained from `GET /auth/csrf`.
* Pagination: `page` (default 1), `pageSize` (default 20, max 100). Filtering and sorting are server-side.
* Common error codes: `VALIDATION_ERROR` 400, `UNAUTHENTICATED` / `TOKEN_EXPIRED` / `SESSION_EXPIRED` / `SESSION_REVOKED` 401, `FORBIDDEN` / `EMAIL_NOT_VERIFIED` / `OPERATOR_ONBOARDING_INCOMPLETE` / `CSRF_INVALID` 403, `NOT_FOUND` 404, `CONFLICT` / `DUPLICATE` / business codes 409, 422 business rule violations, `RATE_LIMITED` 429, `SERVICE_UNAVAILABLE` 503.
* Legend: 🔓 public · 🔑 signed in · ✅ signed in + verified email · role names = additional role requirement.

## Health
`GET /health` → `{ success, message: "ACHIEVER API is running" }` (liveness) · `GET /health/ready` → 200/503 with database privilege and integration checks (names only, never secret values).

## Auth — `/auth`
| Method | Path | Access | Body / notes |
|---|---|---|---|
| GET | `/auth/csrf` | 🔓 | → `{ csrfToken }` |
| POST | `/auth/register` | 🔓 | `{ accountType: osusu\|collector\|personal, role, firstName, middleName?, lastName, preferredName?, gender, dateOfBirth (18+), nationality?, occupation?, employmentStatus?, businessName?, email, phone, stateCode, lgaId, city, address (required for organiser/collector), addressUnit?, postalCode?, password, acceptTerms: true, acceptPrivacy: true }` — LGA must belong to the state; starts a tracked session |
| POST | `/auth/login` | 🔓 | `{ email, password }` → profile |
| POST | `/auth/refresh` | cookie | rotates access/refresh cookies |
| POST | `/auth/logout` | 🔑 (optional) | clears cookies, revokes Supabase session |
| GET | `/auth/me` | 🔑 | profile, roles, onboarding status |
| POST | `/auth/email/resend` · `/auth/email/verify` | 🔑 | `{ code }` |
| POST | `/auth/phone/send` · `/auth/phone/verify` | 🔑 | `{ code }` (SMS via Termii) |
| POST | `/auth/password/forgot` | 🔓 | `{ email }` — same response whether or not the account exists |
| POST | `/auth/password/reset` | 🔓 | `{ email, code, newPassword }` — signs out all devices |
| POST | `/auth/challenges` | 🔑 | `{ action: password_change\|email_change\|phone_change\|account_deletion, password }` → `{ challengeId, sentTo, expiresAt }`; a single-use code is emailed |
| POST | `/auth/password/change` | 🔑 | `{ currentPassword, newPassword, challengeId, code }` — revokes every other session, confirmation email |
| GET | `/auth/providers` | 🔓 | `{ google, facebook }` enabled in Supabase Auth |
| GET | `/auth/oauth/{google\|facebook}/start?next=` | 🔓 | browser navigation → provider consent (PKCE state in HTTP-only cookie) |
| GET | `/auth/oauth/callback` | 🔓 | Supabase redirect target; signs in, or redirects to `/complete-profile` for a new identity |
| GET / POST | `/auth/oauth/pending` · `/auth/oauth/complete` | identity cookie | new social user: read provider identity · create the ACHIEVER profile (same fields as registration minus email/password) |
| GET · POST 🔐 · DELETE 🔐 | `/auth/identities` · `/auth/oauth/:provider/link` · `/auth/identities/:provider` | 🔑 | list / link / unlink sign-in methods (step-up required) |
| GET | `/auth/sessions` | 🔑 | active sessions (device, masked IP, last active, `current`) |
| DELETE | `/auth/sessions/:id` | 🔑 | sign out one of your sessions |
| POST | `/auth/sessions/revoke-others` | 🔑 | sign out every other session |
| POST | `/auth/step-up` | 🔑 | `{ password }` — re-authenticates this session for sensitive staff actions (valid `security.step_up_minutes`) |

## Public status
`GET /status` → `{ maintenance, signInProviders: { google, facebook } }`

## Reference data (public)
`GET /reference/states` → 37 states (+FCT) · `GET /reference/states/:code/lgas` → LGAs of a state (774 total).

## Profiles & users
| Method | Path | Access | Notes |
|---|---|---|---|
| GET/PATCH | `/profiles/me` | 🔑 | identity/address fields (`firstName`, `lastName`, `middleName`, `dateOfBirth` locked once KYC ≥ 2), `preferredName`, `gender`, `occupation`, `employmentStatus`, `businessName`, `stateCode`, `lgaId`, `city`, `address`, `addressUnit`, `postalCode`, `showPublicLocation`; GET includes `kyc` and `permissions` |
| GET | `/profiles/me/security` | 🔑 | your account-change history and security notices |
| POST | `/profiles/me/email/change` · `/email/confirm` | 🔑 | `{ newEmail, challengeId, code }` → code to the new address · `{ code }`; old address alerted |
| POST | `/profiles/me/phone/change` · `/phone/confirm` | 🔑 | `{ newPhone, challengeId, code }` → SMS code · `{ code }`; old number and email alerted |
| GET / PUT | `/profiles/me/preferences` | 🔑 | `{ accessibility, messages, privacy, security }` settings (partial updates) |
| GET | `/privacy/policy` | 🔑 | what is erased vs retained |
| GET / POST | `/privacy/deletion-requests` | 🔑 | list · `{ type: account\|personal_data, reason?, challengeId, code }` |
| POST | `/privacy/deletion-requests/:id/cancel` | 🔑 | within the 7-day window |
| GET · POST | `/notifications/unsubscribe?u=&c=&t=` | signed link | one-click unsubscribe from platform notices / marketing email |
| POST | `/profiles/me/deactivate` | 🔑 | `{ password, reason? }` — refused while groups/plans/payouts are open (`OPEN_OBLIGATIONS`); records retained |
| GET | `/users/:id/trust` | ✅ | public-safe trust profile |
| POST | `/profiles/me/avatar` | 🔑 | multipart `file` (jpeg/png/webp ≤ 2 MB) |
| GET | `/users/me/dashboard` | ✅ | role-aware dashboard figures |
| GET/PUT | `/users/me/payout-account` | ✅ | `{ bankCode, accountNumber }` — resolved with Paystack; first account saved directly; a **change** returns `{ otpRequired: true }` and emails a code |
| POST | `/users/me/payout-account/confirm` | ✅ | `{ bankCode, accountNumber, code }` — code is bound to that account; starts the payout cool-down |
| POST | `/users/me/roles` | ✅ | `{ role: OSUSU_ADMIN\|OSUSU_MEMBER\|COLLECTOR\|SAVER }` |

## Verification — `/verification`
| Method | Path | Notes |
|---|---|---|
| GET | `/verification/status` | email/phone/identity/undertaking status, `kyc` summary |
| GET | `/verification/kyc` | KYC level 0–3, status, next step, allowed activities |
| POST | `/verification/identity` | `{ idType: bvn\|nin\|passport\|drivers_licence\|voters_card, idNumber, firstName, lastName, dateOfBirth, issuingCountry?, issueDate?, expiryDate? (required for passport/licence) }` — number hashed, only last 4 kept |
| POST | `/verification/liveness` | returns `503 LIVENESS_PROVIDER_NOT_CONFIGURED` until a provider is integrated |
| POST | `/verification/identity/document` | multipart `file` (jpeg/png/pdf ≤ 5 MB) → private bucket |
| GET/POST | `/verification/undertaking` | POST `{ role: OSUSU_ADMIN\|COLLECTOR, accept: true }` — stores version, text hash, time, IP, user agent |

## Osusu — `/osusu`
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/osusu/groups` | ✅ | `scope=mine\|admin, status, search, page` |
| POST | `/osusu/groups` | active OSUSU_ADMIN | `{ name, description?, contributionAmount, frequency: daily\|weekly\|biweekly\|monthly, maxMembers, startDate, gracePeriodDays?, payoutOrderMethod?: join_order\|random\|manual, requiresApproval?, adminParticipates?, meetingSchedule? }` |
| POST | `/osusu/groups/join` | ✅ | `{ joinCode }` |
| GET/PATCH | `/osusu/groups/:groupId` | member/organiser/staff | GET includes server-computed `summary` (expected, collected, outstanding, paid/unpaid, current & next recipient, completed/remaining cycles). Financial terms locked after start. |
| POST | `/osusu/groups/:groupId/image` | organiser | multipart `file` |
| POST | `/osusu/groups/:groupId/start` · `/cancel` · `/leave` | organiser / member | leave only before start |
| GET | `/osusu/groups/:groupId/members` | member | risk status visible to organiser/staff only |
| PUT | `/osusu/groups/:groupId/payout-order` | organiser | `{ memberIds: [...] }` before start |
| POST/GET | `/osusu/groups/:groupId/invites` | organiser | `{ email? , phone? }` |
| POST | `/osusu/members/:memberId/approve` · `/remove` | organiser | `{ reason? }`; removal only before start |
| GET | `/osusu/groups/:groupId/cycles` | member | |
| GET | `/osusu/cycles/:cycleId` | member | per-member paid status for the cycle |
| POST | `/osusu/cycles/:cycleId/payout/approve` | organiser | requires fully funded cycle; one approval per payout |
| GET | `/osusu/groups/:groupId/contributions` | member (own) / organiser (all) | `status, cycleNumber, userId, page` |
| GET | `/osusu/contributions/mine` | ✅ | |
| POST | `/osusu/contributions/:contributionId/pay` | contribution owner | → `{ reference, authorizationUrl, reused }` (amount from server) |
| GET | `/osusu/groups/:groupId/payouts` | member | |
| GET | `/osusu/groups/:groupId/activity` · `/risk` | organiser/staff | |

## Collector — `/collector`
| Method | Path | Access | Notes |
|---|---|---|---|
| GET/PATCH | `/collector/account` | COLLECTOR | |
| POST | `/collector/account` | active COLLECTOR | `{ businessName, description?, operatingArea?, defaultCommissionType: percentage\|fixed, defaultCommissionValue }` (percentage in basis points, max 2000) |
| GET | `/collector/dashboard` | COLLECTOR | total savers, total held, maturing, commission, pending returns |
| GET | `/collector/savers` | COLLECTOR | `status, search, page` |
| POST | `/collector/savers/invite` | active COLLECTOR | `{ email?, phone?, planName, frequency, expectedAmount?, startDate, endDate, commissionType?, commissionValue? }` |
| GET | `/collector/invites` · `/collector/commissions` | COLLECTOR | |
| GET | `/collector/plans/mine` | ✅ | saver's plans |
| GET | `/collector/plans/:planId` | saver/collector/staff | balance, expected return, days remaining, open return |
| POST | `/collector/plans/:planId/cancel` | party | only if nothing saved |
| GET | `/collector/plans/:planId/contributions` | party | |
| POST | `/collector/plans/:planId/returns` | party | `{ reason? }` |
| POST | `/collector/contributions` | saver | `{ planId, amount }` (flexible amount) → checkout |
| GET | `/collector/returns` | ✅ | `status, as=collector\|saver, planId` |
| POST | `/collector/returns/:returnId/approve` · `/reject` | collector (or finance staff) | matured returns cannot be declined by the collector |

## Invites — `/invites`
`GET /invites/:token` (preview) · `POST /invites/:token/accept` · `POST /invites/:token/decline` · `DELETE /invites/manage/:id` (revoke). Accepting requires the signed-in email or phone to match the invitation.

## Payments
| Method | Path | Notes |
|---|---|---|
| GET | `/payments/status/:reference` | verifies with Paystack if still open; owner only |
| GET | `/payments/transactions` | `type, status, from, to, search, page` |
| GET | `/payments/transactions/:id` | receipt; owner only |
| GET | `/payments/banks` | Nigerian banks from Paystack (cached) |
| POST | `/paystack/webhook` | Paystack only. Raw body, `x-paystack-signature` HMAC-SHA512. Not CSRF-protected. |

## Bills — `/bills`
`GET /bills/catalog` · `GET /bills/variations?serviceId=` · `POST /bills/verify-customer { serviceId, customerId, meterType }` · `POST /bills` (airtime `{ category, serviceId, phone, amount }`; data `{ category, serviceId, phone, variationCode }`; electricity `{ category, serviceId, meterType, customerId, phone, amount }`) · `GET /bills` · `GET /bills/:id` · `POST /bills/:id/requery`.

## Notifications — `/notifications` (🔑)
`GET /notifications?unreadOnly=` · `GET /notifications/unread-count` · `POST /notifications/:id/read` · `POST /notifications/read-all` · `GET/PUT /notifications/preferences { emailEnabled, smsEnabled, categories: { payments: { email, sms }, … } }`.

## Messages — `/messages`
`GET /messages/conversations` · `POST /messages/conversations/direct { userId }` · `GET /messages/contacts` · `GET /messages/conversations/:conversationId` · `GET …/messages?before=&limit=` · `POST …/messages { body }` · `POST …/attachments` (multipart `file`, `caption?`; jpeg/png/webp/pdf ≤ 10 MB) · `POST …/read` · `GET /messages/attachments/:id/url` (10-minute signed URL).

## Calls — `/calls` (LiveKit)
`POST /calls { conversationId, callType: voice|video }` → `{ call, token, url, roomName }` · `GET /calls/history` · `GET /calls/:callId` · `POST /calls/:callId/accept|join|token|reject|leave|end` · `POST /calls/livekit/webhook` (LiveKit only, signed).

## Meetings — `/meetings`
`GET /meetings?groupId=&upcomingOnly=` · `POST /meetings { groupId, title, description?, startsAt, durationMinutes?, callEnabled? }` (organiser) · `PATCH /meetings/:id` · `POST /meetings/:id/cancel` · `POST /meetings/:id/start { callType }` (organiser; opens group call) · `POST /meetings/:id/join`.

## Support — `/support`
`POST /support/tickets { category, subject, description, amount?, relatedTransactionId?, relatedGroupId?, relatedPlanId? }` → case with `caseNumber` (CASE-YYYY-NNNNNN) · `GET /support/tickets` (cases you reported or are respondent in) · `GET /support/tickets/:id` · `POST /support/tickets/:id/messages { body, internal? }` · `POST /support/tickets/:id/evidence` multipart `file` + `evidenceType`, `description?`, `supersedesId?` (SHA-256 computed server-side, append-only) · `GET /support/evidence/:id/url?reason=` (reason required for staff; logged).

## Realtime — `/events/stream` (🔑, SSE)
Events: `ready`, `message.new`, `notification.new`, `call.incoming`, `call.updated`.

## Reports — `/reports`
`GET /reports/types` · `GET /reports/osusu/:groupId?type=contributions|members|defaults|payouts|cycles&format=json|csv` (organiser/finance staff) · `GET /reports/collector?type=contributions|balances|commissions|maturity` (COLLECTOR) · `GET /reports/platform?type=transactions|bills|user-growth|failed-payments|revenue&from=&to=` (SUPER_ADMIN, ADMIN).

## Admin — `/admin`
Any staff role may enter; each route requires a **permission** (see `docs/SECURITY_COMPLIANCE.md`). 🔐 = also requires a recent step-up (`POST /auth/step-up`); the API answers `403 STEP_UP_REQUIRED` otherwise.

| Method | Path | Permission |
|---|---|---|
| GET | `/admin/overview` | overview.read |
| GET | `/admin/compliance/overview` | security.events.read / kyc.review / risk.review / audit.read |
| GET | `/admin/users` · `/admin/users/:id` (contact masked) | users.read |
| GET | `/admin/users/:id/sensitive?reason=` (logged) | users.read_sensitive |
| GET · POST 🔐 | `/admin/users/:id/security` · `/admin/users/:id/sessions/revoke { reason }` | security.events.read · security.events.manage |
| PATCH 🔐 | `/admin/users/:id/status { status, reason }` | users.manage_status |
| POST/DELETE 🔐 | `/admin/users/:id/roles` · `/admin/users/:id/roles/:role` (staff roles need roles.manage) | users.manage_status / roles.manage |
| GET · POST 🔐 | `/admin/kyc` · `/admin/kyc/:id/history` · `/admin/kyc/:id/restriction { restricted, reason }` | kyc.review |
| GET · POST 🔐 | `/admin/verification` · `/admin/verification/:id/decision` | kyc.review |
| GET | `/admin/verification/:id/document?reason=` (logged) | kyc.documents.view |
| GET · PATCH 🔐 | `/admin/collectors?status=` · `/admin/collectors/:id` (trust stats, history) · `/admin/collectors/:id/status { status: verified\|active\|restricted\|suspended\|rejected, reason }` | collectors.review / collectors.status |
| GET | `/admin/transactions` · `/admin/payments` | finance.ledger.read |
| GET · POST 🔐 | `/admin/payouts` · `/admin/payouts/:kind/:id/confirm { externalReference, note?, overrideReason?, approvalRequestId? }` · `/fail` · `/retry` | finance.payouts.execute |
| GET · POST 🔐 | `/admin/approvals` · `/admin/approvals { action, targetId, reason, payload }` · `/:id/decision { decision: approve\|reject }` · `/:id/execute` · `/:id/cancel` | per action (two-person rule) |
| GET · PATCH · POST | `/admin/support/tickets` · `/:id { status, priority, resolution?, resolutionOutcome? }` · `/:id/assign` | support.tickets / disputes.manage |
| POST | `/admin/support/tickets/:id/transactions { transactionId }` · `/:id/evidence { evidenceType, linkedRecordType, linkedRecordId }` | disputes.manage |
| GET | `/admin/trace/transactions/:id` · `/admin/trace/cases/:id` | trace.read |
| GET · PATCH | `/admin/risk` · `/admin/risk/:id` | risk.review |
| GET · PUT 🔐 | `/admin/risk-profiles` · `/admin/risk-profiles/:id` · PUT `{ status, reason, approvalRequestId? }` (lifting a restriction needs an approval) | risk.review |
| GET · PATCH | `/admin/security/events` · `/admin/security/events/:id { status, resolution? }` | security.events.read · security.events.manage |
| GET | `/admin/audit-logs` | audit.read |
| GET | `/admin/data-access-logs` | data_access.read |
| GET · PUT 🔐 | `/admin/settings` · `/admin/settings/:key { value }` | overview.read · settings.manage |
| POST | `/admin/notifications/broadcast` | notifications.broadcast |
| GET · POST 🔐 | `/admin/privacy/requests` · `/admin/privacy/requests/:id/decision { decision: in_review\|complete\|reject, note? }` | privacy.requests.manage |
| GET | `/reports/platform` | reports.platform |
