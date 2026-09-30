# Bills & Services (VTpass)

ACHIEVER sells airtime, data, electricity, cable TV and exam PINs through **VTpass**. VTpass is always called by the Express API, never by React, Android or the browser.

```
React / Android ──► ACHIEVER API ──► Paystack (customer pays)
                          │
                          └────────► VTpass (service delivered) ──► network / biller
```

## Code map

| Path | What it does |
|---|---|
| `backend/src/services/vtpass/client.js` | HTTP client, API-key auth, timeouts, health tracking, sandbox guard |
| `backend/src/services/vtpass/catalog.js` | Service discovery, cached in `bill_services` / `bill_products` |
| `backend/src/services/vtpass/mapper.js` | VTpass reply → `delivered` / `failed` / `reversed` / `processing` |
| `backend/src/services/vtpass/index.js` | Provider adapter: verify, purchase, requery |
| `backend/src/utils/vtpass.js` | Request IDs, redaction, masking |
| `backend/src/integrations/bills/index.js` | Provider registry (maps each category to a provider) |
| `backend/src/services/billService.js` | Transaction engine (quote → approve → pay → deliver → receipt) |
| `backend/src/controllers/billPaymentController.js`, `routes/billPaymentRoutes.js` | Member API |
| `backend/src/app.js` (`/api/webhooks/vtpass/:token`) | VTpass callback |
| `supabase/migrations/20260930000011_…sql` | Tables, guards, SQL functions |

## Environment variables (backend only)

| Variable | Purpose |
|---|---|
| `BILL_PROVIDER=vtpass` | Turns bills on. Leave it `disabled` to show "temporarily unavailable". Nobody is charged while it is disabled. |
| `VTPASS_BASE_URL` | Sandbox: `https://sandbox.vtpass.com/api`. Live: `https://vtpass.com/api`. |
| `VTPASS_API_KEY`, `VTPASS_PUBLIC_KEY`, `VTPASS_SECRET_KEY` | Keys from your VTpass profile (sandbox and live keys are different). GET requests send `api-key` + `public-key`; POST requests send `api-key` + `secret-key`. |
| `VTPASS_SANDBOX` | `true` (default) refuses to start unless the base URL is the sandbox. Set it to `false` only for live. |
| `VTPASS_WEBHOOK_TOKEN` | A long random secret. The callback URL is `https://<api>/api/webhooks/vtpass/<token>`. |
| `DATA_ENCRYPTION_KEY` | Seals electricity tokens, exam PINs and push tokens. If unset it is derived from `SESSION_SECRET`; set your own in production. |

VTpass currently documents API-key authentication. The username/password (Basic auth) variables mentioned in the request are not used.

## Sandbox setup

1. Register at `https://sandbox.vtpass.com/register` and generate **sandbox** API keys in your profile.
2. **Whitelist the products** you will test in the VTpass dashboard. Until you do, every purchase is refused with code `028` ("product not whitelisted"). ACHIEVER treats that as a failure and refunds.
3. Set `BILL_PROVIDER=vtpass`, `VTPASS_BASE_URL=https://sandbox.vtpass.com/api`, `VTPASS_SANDBOX=true` and the three keys on the API. Members see a "Test mode" banner.
4. Use the documented sandbox numbers:

| Case | Airtime / data phone | Electricity meter | DStv smartcard |
|---|---|---|---|
| Success | `08011111111` | `1111111111111` (prepaid), `1010101010101` (postpaid) | `1212121212` |
| Pending | `201000000000` | `201000000000` | `201000000000` |
| Unexpected response | `500000000000` | `500000000000` | `500000000000` |
| No response / timeout | `400000000000` / `300000000000` | same | same |
| Failure | any other number | any other number | any other number |

## Production

1. Create live keys, fund the VTpass wallet, whitelist the products and whitelist the API's outbound IP if VTpass asks.
2. Set `VTPASS_BASE_URL=https://vtpass.com/api`, `VTPASS_SANDBOX=false` and the live keys.
3. In the VTpass dashboard, set the callback URL to `https://<your-api>/api/webhooks/vtpass/<VTPASS_WEBHOOK_TOKEN>`.
4. In the Admin Platform, open Bills & Services → VTpass status and confirm it shows OPERATIONAL.

## Transaction lifecycle

```
details ─► POST /api/bills/quote            server prices, verifies meter/smartcard  [awaiting_authorization]
        ─► POST /api/bills/:id/authorize    PIN checked, code emailed  (or biometric challenge)
        ─► POST /api/bills/:id/confirm      challenge verified, Paystack checkout   [awaiting_payment]
        ─► Paystack webhook / verify        payment confirmed                       [paid]
        ─► claim paid→processing, POST /pay  (sent once)                             [processing]
        ─► VTpass result / webhook / requery                                          [delivered | refund_pending | reversed]
        ─► refund completed                                                           [refunded]
```

- **Status shown to members:** PENDING, PROCESSING, SUCCESS, FAILED, REVERSED, REFUNDED, UNKNOWN (outcome not yet known; being requeried), CANCELLED.
- **Never success on HTTP 200:** only code `000` with status `delivered` counts as delivered. `initiated`/`pending`, codes 099, 001, 044, 019, 089, 083 and 014, network errors, timeouts and unexpected replies are all *processing* and get requeried with back-off (30 s up to 1 h). After 30 attempts the bill goes to **Reconciliation** for a person to check.
- **Never bought twice:**
  - `provider_request_id` is unique in the database.
  - A paid bill is atomically claimed (`paid → processing`) before `/pay`, and after that only `/requery` is used.
  - The member-facing endpoints accept `Idempotency-Key`.
- **Request ID:** `YYYYMMDDHHmm` in Africa/Lagos time plus 16 random hex characters.
- **Never edited or deleted:** completed bills cannot change or be removed (database trigger). Corrections are new records (refund transactions, reversal of the ledger entry). Every status change is written to `bill_transaction_events`; each provider reply is kept, redacted, in `bill_provider_responses`.
- **Webhook:** VTpass does not sign callbacks. ACHIEVER checks the secret path token, answers `{"response":"success"}` immediately, and then **requeries VTpass itself**. The callback body is never trusted. A reversal (code `040`) after delivery is confirmed by requery, then the ledger entry is reversed and a refund is created.
- **Secrets:** electricity tokens and exam PINs are sealed with AES-256-GCM. They are shown only to the owner, only when they tap "Show token / PIN", and every reveal is audited. They never appear in notifications, logs or provider-response records.

## Services

These were checked live against the VTpass sandbox on 2026-09-30:

| ACHIEVER category | VTpass category | Status |
|---|---|---|
| Airtime | `airtime` (mtn, airtel, glo, etisalat) | Integrated. International airtime is hidden: it needs country and operator fields. |
| Data | `data` (mtn-data, airtel-data, glo-data, etisalat-data, glo-sme-data) | Integrated; plans loaded live (37 MTN plans). Smile and Spectranet are hidden: they bill an account ID, not a phone number. |
| Electricity | `electricity-bill` (12 distribution companies) | Integrated; meter verification tested live. |
| Cable TV | `tv-subscription` (dstv, gotv, startimes, showmax) | Integrated; smartcard verification tested live. |
| Exam PINs | `education` (waec, waec-registration, jamb) | Integrated. JAMB asks for the profile ID and verifies it. |
| Betting | not offered by VTpass for this account | Shown as "Currently unavailable". The provider registry can route it to another approved provider later. |
| Recharge card / VTU PIN | not offered by VTpass | Shown as "Currently unavailable". |
| Insurance, other-services | offered by VTpass | Not integrated in this release. |

Admins can switch any service or category off from Admin → Bills & Services → Services, or with the `bills.*` settings.
