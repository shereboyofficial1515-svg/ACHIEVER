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
| `VTPASS_ENV` | `sandbox` or `production`. **Only this backend variable decides the environment**; the web and Android apps can never change it. Default: `sandbox`. |
| `VTPASS_BASE_URL` | Optional. It defaults to `https://sandbox.vtpass.com/api` (sandbox) or `https://vtpass.com/api` (production). If you set it, it must match `VTPASS_ENV` or bills refuse to start. |
| `VTPASS_API_KEY`, `VTPASS_PUBLIC_KEY`, `VTPASS_SECRET_KEY` | Keys from your VTpass profile (sandbox and live keys are different). GET requests send `api-key` + `public-key`; POST requests send `api-key` + `secret-key`. |
| `VTPASS_WEBHOOK_TOKEN` | A long random secret. The callback URL is `https://<api>/api/webhooks/vtpass/<token>`. |
| `DATA_ENCRYPTION_KEY` | Seals electricity tokens, exam PINs and push tokens. If unset it is derived from `SESSION_SECRET`; set your own in production. |

VTpass currently documents API-key authentication. The username/password (Basic auth) variables mentioned in the request are not used.

## Sandbox setup

1. Register at `https://sandbox.vtpass.com/register` and generate **sandbox** API keys in your profile.
2. **Whitelist the products** you will test in the VTpass dashboard. Until you do, every purchase is refused with code `028` ("product not whitelisted"). ACHIEVER treats that as a failure and refunds.
3. Set `BILL_PROVIDER=vtpass`, `VTPASS_ENV=sandbox` and the three sandbox keys on the API. Members see the "Test mode" banner, which is driven by `GET /api/bills/status` (`environment`, `testMode`).
5. Run `npm run vtpass:sandbox-check` in `backend/` (with the sandbox keys in `.env`). It runs every documented sandbox case and prints PASS, FAIL or BLOCKED; BLOCKED means the product is not whitelisted yet.
4. Use the documented sandbox numbers:

| Case | Airtime / data phone | Electricity meter | DStv smartcard |
|---|---|---|---|
| Success | `08011111111` | `1111111111111` (prepaid), `1010101010101` (postpaid) | `1212121212` |
| Pending | `201000000000` | `201000000000` | `201000000000` |
| Unexpected response | `500000000000` | `500000000000` | `500000000000` |
| No response / timeout | `400000000000` / `300000000000` | same | same |
| Failure | any other number | any other number | any other number |

## Provider logos and branding

- **Where the list comes from:** the provider list is always VTpass's live catalogue, normalised by `backend/src/services/vtpass/providers.js` into `providerCode`, `providerName`, `shortName`, `category`, `logoKey`, `serviceType`, `enabled` and `supported`. New VTpass services appear automatically, with a derived name.
- **Where the logos come from:** the artwork VTpass publishes for each service in its merchant catalogue (the `image` field of `GET /services`). The API serves it at `GET /api/bills-assets/logos/:serviceId` (`backend/src/services/vtpass/logos.js`):
  - it fetches only from `vtpass.com` and `sandbox.vtpass.com` under `/resources/`, and only accepts images up to 512 KB;
  - several sandbox copies are missing, so it falls back to the identical path on `vtpass.com`;
  - it caches images in memory for 24 h and in browsers for 24 h.
- **How the apps pick a logo:** `frontend/src/content/providerAssets.js` → `providerLogoSrc()`. An official file bundled in `src/assets/providers/<code>/` is used first (none yet; see that folder's README), then the API logo, then an ACHIEVER monogram. A broken-image icon is never shown.
- **What is not allowed:** logos scraped from search engines, redrawn or AI-generated versions of real brands, or recoloured or stretched marks. Logos sit on white with `object-fit: contain` in both themes.
- **Source record:** VTpass merchant service catalogue, checked 2026-09-30. All 28 supported services have artwork on `vtpass.com` (see `LOGO_SOURCES` in `providerAssets.js`).

## Admin → Bills & Services → Providers

For each service:
- **Shown:** category, status (operational / degraded / unavailable / maintenance / disabled), environment, last successful and failed purchase, the last VTpass reply (code/status/time), and 24-hour success, failure and pending counts.
- **Actions:** switch a service off or on, put it into or out of maintenance (with an optional message members see), and view that provider's failed transactions.
- **Controls:** changing a service needs the `bills.manage` permission, a confirmation, a reason and a fresh authenticator code. The change is audited with before/after values.
- **Database:** these figures come from migration 013 (`bill_service_stats()`).

## VTpass Production Activation (deployment administrator)

Bills stay on the **sandbox** until every applicable item below is ticked. Nobody switches to production because the UI "looks fine".

**Before switching** (tick each):
- [ ] The VTpass **live** account is active, verified and funded; the required products are enabled and whitelisted on the live account.
- [ ] `npm run vtpass:sandbox-check` shows no FAIL and no BLOCKED rows (products whitelisted in the sandbox).
- [ ] A full purchase was completed in the sandbox from the phone and the website: review → approval (PIN + email code, and biometric on Android) → Paystack **test** payment → delivered → receipt. Also tested: a failed purchase (refund), a pending one (resolved by requery) and a duplicate tap (only one purchase).
- [ ] The VTpass callback URL in the **live** dashboard is `https://<api>/api/webhooks/vtpass/<VTPASS_WEBHOOK_TOKEN>`.
- [ ] Admin → Bills & Services shows the transactions, statuses and reconciliation, and Providers shows OPERATIONAL.
- [ ] Paystack is on **live** keys, and a small live payment and refund has been tested.
- [ ] Push notifications, audit log and rate limits have been checked.
- [ ] No keys in Git, the web bundle or the APK/AAB. Run a secret scan of the built files.
- [ ] Migrations 011, 012 and 013 are applied.

**Switch:**
1. In Render (API service → Environment), set:
   - `VTPASS_ENV=production`
   - the three **live** keys: `VTPASS_API_KEY`, `VTPASS_PUBLIC_KEY`, `VTPASS_SECRET_KEY`
   - remove `VTPASS_BASE_URL`, or set it to `https://vtpass.com/api`.
2. Save and redeploy the backend. The website and the Android app need no change or rebuild.
3. Check `GET /api/bills/status` returns `"environment":"production","testMode":false`, and that the "Test mode" banner is gone.
4. In Admin → Bills & Services → Providers, choose "Refresh from VTpass", confirm the environment shows PRODUCTION, and make one small real airtime purchase.

**Roll back:** set `VTPASS_ENV=sandbox` and the sandbox keys again, then redeploy. Purchases already in progress keep being requeried against the environment they were made in only if you roll back quickly, so avoid switching back and forth.

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
