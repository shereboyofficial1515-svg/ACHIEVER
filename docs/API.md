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
| POST | `/auth/register` | 🔓 | `{ accountType: osusu\|collector\|personal, role: organizer\|member\|collector\|saver\|personal, fullName, email, phone, password, address?, dateOfBirth?, acceptTerms: true }` |
| POST | `/auth/login` | 🔓 | `{ email, password }` → profile |
| POST | `/auth/refresh` | cookie | rotates access/refresh cookies |
| POST | `/auth/logout` | 🔑 (optional) | clears cookies, revokes Supabase session |
| GET | `/auth/me` | 🔑 | profile, roles, onboarding status |
| POST | `/auth/email/resend` · `/auth/email/verify` | 🔑 | `{ code }` |
| POST | `/auth/phone/send` · `/auth/phone/verify` | 🔑 | `{ code }` (SMS via Termii) |
| POST | `/auth/password/forgot` | 🔓 | `{ email }` — same response whether or not the account exists |
| POST | `/auth/password/reset` | 🔓 | `{ email, code, newPassword }` — signs out all devices |
| POST | `/auth/password/change` | 🔑 | `{ currentPassword, newPassword }` |

## Profiles & users
| Method | Path | Access | Notes |
|---|---|---|---|
| GET/PATCH | `/profiles/me` | 🔑 | `{ fullName?, address?, dateOfBirth? }` |
| POST | `/profiles/me/avatar` | 🔑 | multipart `file` (jpeg/png/webp ≤ 2 MB) |
| GET | `/users/me/dashboard` | ✅ | role-aware dashboard figures |
| GET/PUT | `/users/me/payout-account` | ✅ | `{ bankCode, accountNumber }` — resolved with Paystack; only last 4 digits stored |
| POST | `/users/me/roles` | ✅ | `{ role: OSUSU_ADMIN\|OSUSU_MEMBER\|COLLECTOR\|SAVER }` |

## Verification — `/verification`
| Method | Path | Notes |
|---|---|---|
| GET | `/verification/status` | email/phone/identity/undertaking status per operator role |
| POST | `/verification/identity` | `{ idType: bvn\|nin, idNumber (11 digits), firstName, lastName, dateOfBirth }` — number hashed, never returned |
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
`POST /support/tickets { category, subject, description, relatedTransactionId?, relatedGroupId?, relatedPlanId? }` · `GET /support/tickets` · `GET /support/tickets/:id` · `POST /support/tickets/:id/messages { body, internal? }` (`internal` honoured for staff only).

## Realtime — `/events/stream` (🔑, SSE)
Events: `ready`, `message.new`, `notification.new`, `call.incoming`, `call.updated`.

## Reports — `/reports`
`GET /reports/types` · `GET /reports/osusu/:groupId?type=contributions|members|defaults|payouts|cycles&format=json|csv` (organiser/finance staff) · `GET /reports/collector?type=contributions|balances|commissions|maturity` (COLLECTOR) · `GET /reports/platform?type=transactions|bills|user-growth|failed-payments|revenue&from=&to=` (SUPER_ADMIN, ADMIN).

## Admin — `/admin` (SUPER_ADMIN, ADMIN, SUPPORT_ADMIN; 💰 = SUPER_ADMIN/ADMIN only)
| Method | Path |
|---|---|
| GET | `/admin/overview` |
| GET | `/admin/users?search=&role=&status=` · `/admin/users/:id` |
| PATCH 💰 | `/admin/users/:id/status { status: active\|suspended\|closed, reason? }` |
| POST/DELETE 💰 | `/admin/users/:id/roles` · `/admin/users/:id/roles/:role` (staff roles: SUPER_ADMIN only) |
| GET | `/admin/osusu/groups` · `/admin/collectors` · PATCH 💰 `/admin/collectors/:id/status` |
| GET 💰 | `/admin/transactions` · `/admin/payments` |
| GET | `/admin/bills` |
| GET 💰 | `/admin/payouts` (queue of payouts, returns, commissions) |
| POST 💰 | `/admin/payouts/:kind/:id/confirm { externalReference, note? }` · `/fail { reason }` · `/retry` |
| GET/POST 💰 | `/admin/verification` · `/admin/verification/:id/document` · `/admin/verification/:id/decision { decision: verified\|failed, note? }` |
| GET/PATCH/POST | `/admin/support/tickets` · `/admin/support/tickets/:id` · `/admin/support/tickets/:id/assign` |
| GET · PATCH 💰 | `/admin/risk` · `/admin/risk/:id { status, note? }` |
| GET 💰 | `/admin/audit-logs?action=&resourceType=&resourceId=&from=&to=` |
| GET · PUT (SUPER_ADMIN) | `/admin/settings` · `/admin/settings/:key { value }` |
| POST 💰 | `/admin/notifications/broadcast { title, body, role? }` |
