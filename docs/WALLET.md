# ACHIEVER Wallet

An internal stored-value balance inside ACHIEVER. Members add money with Paystack, pay bills and OSUSU/collector contributions from it, send money to other ACHIEVER members (internal) or to any Nigerian bank account (external), set up automatic OSUSU contributions, and receive referral rewards into it. Every fee comes from one admin-controlled fee engine.

> **Regulatory note.** ACHIEVER Wallet is **not a bank account** and ACHIEVER does not present itself as a bank. The wallet account number (`ACH` + 16 characters) identifies a wallet inside ACHIEVER only; it is not a bank account number (NUBAN). Holding customer funds, member-to-member transfers and withdrawals to bank accounts may require a licensed partner (for example a licensed PSP / mobile-money operator / bank holding the pooled funds) and CBN approval. Bank transfers go out through Paystack Transfers from ACHIEVER's Paystack balance (or are paid manually by finance). Confirm the regulatory position before enabling the wallet for the public (`wallet.enabled`, `wallet.transfers_enabled`, `wallet.bank_transfers_enabled`).

## Wallet account number

Migration `20261002000016_wallet_accounts_bank_transfers_fees.sql`.

* Format: `ACH` + 16 characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no 0/O or 1/I), always containing both digits and letters — 19 characters, ~80 bits of randomness (e.g. `ACH7XTTQB28PN5KCW6V`).
* Generated in the database from a cryptographic random source, never from a user or row ID; `UNIQUE`; a format `CHECK`; and a trigger makes it permanent once issued.
* Existing wallets: same wallet row (balance, ledger, history untouched), a new number issued, and the old `ACHW-XXXXXXXX` ID kept in `wallet_account_aliases`. `resolve_wallet_code()` finds a wallet by the new number or an old ID, so old IDs people already shared keep working (the recipient screen then shows the new number). Old IDs are never reissued.
* The app shows it as “Wallet account number” with a Copy button and “ACHIEVER Wallet account · not a bank account”.

## Ledger design

Migration: `supabase/migrations/20261001000015_achiever_wallet.sql`

| Table | Purpose |
|---|---|
| `wallet_accounts` | One `user` wallet per member (`ACHW-` + 8 characters from an unambiguous alphabet) and one row per **system account**: `paystack_clearing`, `bill_settlement`, `fees`, `osusu_pool`, `collector_pool`, `rewards`, `adjustments`. `balance` and `held` are projections. |
| `wallet_transactions` | One row per money event (top-up, transfer, bill, contribution, refund, reversal, reward, adjustment). Immutable: only `pending → …` and `success → reversed` status moves; never deleted. |
| `wallet_ledger_entries` | Append-only double-entry lines (`debit`/`credit`, `amount`, `balance_after`). Update/delete is blocked by trigger. |
| `wallet_topups` | Paystack top-ups: `INITIALIZED → PENDING → SUCCESS / FAILED / ABANDONED → REVERSED / REFUNDED`. |
| `wallet_transfers` | `AWAITING_AUTHORIZATION → SUCCESS / PENDING_REVIEW / FAILED / CANCELLED`. |
| `wallet_holds` | Money reserved for a transfer under review (counts against available balance). |
| `wallet_payment_mandates`, `wallet_mandate_runs` | Automatic payments (`PENDING_AUTHORIZATION, ACTIVE, PAUSED, CANCELLED, EXPIRED, COMPLETED`) and every attempt (append-only). |
| `wallet_adjustment_requests` | Admin corrections: requested by one administrator, approved by another. |

Every movement goes through `_wallet_post(tx, lines)`:

* lines must balance (debits = credits) or the call fails (`LEDGER_UNBALANCED`);
* all accounts involved are locked `FOR UPDATE` **in id order** (no deadlocks, no double spending under concurrency);
* a member wallet can never be debited below its available balance (`balance − held`) — `INSUFFICIENT_FUNDS` — and frozen wallets cannot send;
* each line writes an immutable ledger entry with the resulting balance.

The only exception is `wallet_reverse_topup` (a Paystack refund/chargeback of money already credited): it may take the wallet negative, then **freezes** it and raises a `wallet_negative_after_reversal` risk flag for review.

Invariant (tested): the sum of all ledger lines is zero and every `wallet_accounts.balance` equals the sum of its ledger lines. A negative `paystack_clearing` balance means money received from Paystack and owed to members.

Browser roles can **read their own rows only** (RLS) and cannot write any wallet table or call any wallet function. All writes come from the API (service role) through `SECURITY DEFINER` functions.

## Flows

### Add money (Paystack)
`POST /api/wallet/topups` → a `wallet_topups` row + Paystack checkout (`payment_attempts.purpose = 'wallet_topup'`). Nothing is credited until **server-side verification**: the webhook (`charge.success`) or the callback/reconciliation calls Paystack's verify API, then `confirm_payment` → `_apply_wallet_topup` credits the wallet once (replays return `already_processed`; amount mismatches are refunded, never credited). Failed/abandoned checkouts update the top-up status. A later Paystack `refund.processed` for a funded top-up reverses it (`handleTopupRefund`). Limits: `wallet.topup_min_kobo`, `wallet.topup_max_kobo`, `wallet.max_balance_kobo`.

### Transfer money

The Transfer screen offers two clearly labelled choices: **ACHIEVER User** (internal) and **Bank Account** (external).

### Send to a Nigerian bank account (external)
1. Choose the bank (Paystack bank list) and enter the 10-digit account number.
2. `POST /api/wallet/bank/resolve` — name enquiry with the bank through Paystack. The name shown comes from the bank; the app can never supply it (requests with an account name or fee are rejected).
3. Enter the amount: the fee and total debit are previewed from the fee engine (`GET /api/wallet/fees/quote`).
4. `POST /api/wallet/bank-transfers` — the server verifies the account again, prices the transfer in the database (`price_bank_transfer` trigger → `fee_quote`), saves a fee snapshot, and returns the review. Nothing moves.
5. `…/authorize` + `…/confirm` — the approval is bound (HMAC) to the account, amount, fee and totals. Then `wallet_bank_transfer_debit` debits the wallet **once** under a row lock (balance including the fee, single and daily limits).
6. Payout: Paystack Transfer with the transfer's fixed reference (`ACH-WBT-…`), so a retry can never pay twice. If `PAYSTACK_TRANSFERS_ENABLED` is off, or `wallet.bank_transfers_automatic = 0`, it is queued for finance (Admin → Wallets → Bank transfers → Record as sent / Refund).
7. Status: `INITIATED → PENDING → PROCESSING → SUCCESS`, or `FAILED` / `REVERSED` / `REFUNDED` (full refund of amount **and fee**). An HTTP 200 from Paystack only means PROCESSING; SUCCESS comes from the `transfer.success` webhook or `GET /transfer/verify/:reference` (job `wallet.bank_transfers`, every 3 minutes). A reversal after success refunds and raises a risk flag.

Ledger: wallet → `payout_clearing` (amount) + `fees` (fee); on success `payout_clearing` → `paystack_clearing`; on failure everything returns to the wallet. Paystack's transfer fee is recorded as provider cost (reported by Paystack, otherwise estimated from its published tariff), separately from ACHIEVER's fee.

### Send to another member (internal)
1. `POST /api/wallet/recipients/resolve` — shows **only** a masked name (`Ad**** O*****`) and masked wallet ID (`ACHW-••••6789`).
2. `POST /api/wallet/transfers` — review (limits, velocity, balance checked; nothing moves).
3. `POST /api/wallet/transfers/:id/authorize` — approval challenge bound (HMAC) to sender, both wallets, amount and fee.
4. `POST /api/wallet/transfers/:id/confirm` — consumes the challenge, then `wallet_execute_transfer` re-checks balance, single and daily limits **under lock** and posts. Transfers at or above `wallet.transfer_review_threshold_kobo` are **held** (`PENDING_REVIEW`) until an administrator other than the sender approves or rejects them.

Idempotency: `Idempotency-Key` on create/confirm, a unique `(sender, idempotency_key)`, and single-use approvals.

### Pay bills from the wallet
On the bill review the member chooses **ACHIEVER Wallet** or **Paystack**. The choice is stored on the bill (`funding_source`) and included in the approval hash. After approval, `wallet_pay_bill` debits the wallet into `bill_settlement` (daily limit `wallet.bill_daily_max_kobo`), then VTpass fulfilment runs as before. If the purchase fails or is reversed, `_bill_refund` credits the wallet back **instantly** (no Paystack refund). Commission/fees remain recorded on `bill_payments` exactly as for card payments.

### OSUSU contributions and collector savings
`POST /api/wallet/payments/authorize` + `/confirm` (`kind: osusu | collector`). The wallet is debited into `osusu_pool` / `collector_pool`, and the **same** `_apply_osusu_contribution` / `_apply_collector_savings` functions record the contribution (cycle totals, lateness, notifications), with `transactions.provider = 'internal'` so the payment is traceable to the wallet.

### Automatic contributions (mandates)
Created from the OSUSU group page (“Pay automatically from wallet”), approved explicitly (always PIN + emailed code, or biometric — never PIN alone), and can be paused, resumed or cancelled at any time (`/app/wallet/autopay`). The job `wallet.mandates` (hourly, `run_wallet_mandates`) pays due contributions. If the balance is too low the attempt is logged as `INSUFFICIENT_FUNDS`, the member is notified, and it is retried at most `max_attempts` (3) times, `retry_hours` (24) apart — never overdrawn, never retried indefinitely.

### Referral rewards
Admin → Referrals → reward → **Pay into wallet** (`pay_wallet`, needs `referrals.pay` and a different administrator from the approver). Posts `rewards → member wallet` (`REFERRAL_REWARD`) and marks the reward paid with the wallet reference. A wallet-paid reward cannot be “reversed” by status alone: use a two-person debit adjustment.

### Admin
Admin → **Wallets** (`wallet.read`, `wallet.manage`, `wallet.adjust`): totals and system ledger accounts, search (personal data masked unless `users.read_sensitive`), wallet detail, place on hold / release (reason, step-up, audited, member notified), held transfers (approve/reject), adjustments (request → second administrator approves; posted through the ledger).

## Fee engine (Admin → Fees & Charges)

One calculator, `fee_quote(service, amount)`, in the database. Money rows get their fee from it inside the database (insert triggers on transfers, bank transfers, top-ups and bills; wallet OSUSU/collector payments call it directly), so the API and the apps can never set or change a fee. Previews shown to members call the same function.

* Services: `bank_transfer`, `wallet_transfer`, `wallet_topup`, `bill_airtime`, `bill_data`, `bill_electricity`, `bill_tv`, `bill_education`, `bill_recharge_pin`, `bill_betting`, `osusu_contribution`, `collector_savings` (all live), plus `osusu_payout` and `referral_payout` (configurable now, applied when those payouts are charged).
* Types: `FIXED`, `PERCENTAGE`, `FIXED_PLUS_PERCENTAGE`, `TIERED` (`[{min, max|null, fixed, percentage}]`), with optional minimum fee, maximum fee (cap), minimum and maximum transaction amount, and an enabled switch (disabled = no fee).
* Rounding: percentages round half-up to the kobo, then the min/max fee applies.
* Bearing mode: `FEE_ADDED` (member pays amount + fee; recipient gets the amount) or `FEE_INCLUDED` (member pays the amount; recipient gets amount − fee). Fee-included is only allowed for bank transfers, wallet transfers and top-ups — for bills and contributions the provider/group must receive the full amount (enforced in the database).
* Versioning: a change is a new version (`fee_configurations`, unique `(service, version)`), proposed by an administrator with `fees.manage` and approved by a **different** administrator with `fees.approve` (`fees.require_second_approver`). Approved versions can never be edited or deleted. The version in force is the latest approved version whose `effective_from` has passed, so changes can be scheduled.
* Snapshots: each transaction stores the quote used (`fee_snapshot`: fee, type, mode, config id/code, version), so later changes never alter history.
* Starting fees: bills and the internal transfer fee were copied from the old settings (`bills.fee_kobo`, `wallet.transfer_fee_kobo`, both now superseded); bank transfers start at ₦100 added; everything else ₦0.
* Revenue: `fee_revenue_report()` → Admin → Fees & Charges → Fee revenue: gross volume, fees collected, refunded/reversed fees, net fees and net after bank transfer provider cost, by service, for today / 7 / 30 days / custom range. Fees refunded with a failed or reversed transaction are not revenue.

## Approval (authentication)

| Situation | Allowed |
|---|---|
| Below `security.email_code_threshold_kobo` (default ₦50,000) — on the total debit including the fee | Transaction PIN alone, PIN + emailed code, or biometric |
| At/above the threshold | PIN + emailed code, or biometric |
| First transfer to a new wallet or bank account at/above `wallet.new_recipient_step_up_kobo` | PIN + emailed code, or biometric (reason shown) |
| Automatic payments (standing authority) | PIN + emailed code, or biometric |
| Android with biometric approval on | Device key signature verified by the server (fingerprint/face/screen lock) |

The server decides; the app only offers what the server allows and falls back to the step-up when told `TX_STEP_UP_REQUIRED` (checked before the PIN is verified, so it never costs a PIN attempt).

**PIN lockout** (progressive): `security.transaction_pin_max_attempts` (5) wrong entries lock the PIN for `security.transaction_pin_lock_minutes` (30), doubling with each lock in a row (max 24 h); after `security.transaction_pin_review_after` (3) locks in a row the PIN must be **reset** (sign-in password + emailed code). Warnings are notified when 2 attempts remain. The PIN is stored as scrypt(HMAC(server key, PIN)) and never logged or returned.

## Secure keypad

`frontend/src/components/ui/SecureKeypad.jsx` — types `pin`, `otp`, `amount`, `numeric`. Used for transaction PINs (approval and PIN setup), emailed codes and wallet amounts; normal text fields keep the phone keyboard. PIN digits are never rendered (dots), there is no text input (no autofill, no native keyboard), progress is announced to screen readers without reading digits, every key is a labelled button, and a physical keyboard works on desktop. Settings → Security → **Secure keypad**: key-press vibration on Android (via `AchieverSecurity.haptic`, no extra permission) and an optional shuffled PIN layout. Follows the light/dark theme tokens.

## Settings (Admin → Settings, category `wallet`)

`wallet.enabled`, `wallet.transfers_enabled`, `wallet.topup_min_kobo`, `wallet.bank_transfers_enabled`, `wallet.bank_transfers_automatic`, `wallet.bank_transfer_min_kobo`, `wallet.bank_transfer_single_max_kobo`, `wallet.bank_transfer_daily_max_kobo`, `fees.require_second_approver`, `wallet.topup_max_kobo`, `wallet.max_balance_kobo`, `wallet.transfer_min_kobo`, `wallet.transfer_single_max_kobo`, `wallet.transfer_daily_max_kobo`, `wallet.transfer_review_threshold_kobo`, `wallet.transfer_hourly_max_count`, `wallet.new_recipient_step_up_kobo`, `wallet.bill_daily_max_kobo`, `wallet.max_auto_contribution_kobo`, plus `security.email_code_threshold_kobo` and `security.transaction_pin_review_after`.

## Deploying

1. Run migrations `20261001000015_achiever_wallet.sql` and `20261002000016_wallet_accounts_bank_transfers_fees.sql` in Supabase (SQL editor), **before** deploying the API.
2. Deploy the API and frontend/admin. For automatic bank payouts set `PAYSTACK_TRANSFERS_ENABLED=true` on the API (Render), make sure the Paystack balance is funded, and turn **off** “Confirm transfers before sending” (OTP) for API transfers in the Paystack dashboard (otherwise transfers wait for an OTP). The Paystack webhook (`/api/paystack/webhook`) must have transfer events enabled. Without this, bank transfers queue for manual payout.
3. Rebuild the Android app for key-press vibration (new `haptic` method in `AchieverSecurityPlugin`).
4. Decide the regulatory position before announcing the wallet; switch off with `wallet.enabled = false` if needed (balances stay safe and visible).

## Tests

* `supabase/tests/database/wallet_fees_bank.test.sql` (66): account number format/uniqueness/permanence, legacy alias lookup, every fee type with min/max and limits, fee-included rules, versioning and two-person approval, scheduling, server-priced rows, bank transfer debit once / double-spend / immutability / status rules / success / failure / reversal refunds, internal transfer fee and historical snapshot, revenue and ledger invariants.
* `backend/tests/services/bankTransfers.test.js` (11): name from the bank only, strict input (no client name/fee), insufficient balance including fee, single debit, PROCESSING after HTTP 200, approval binding, new-account step-up, webhooks, network retry with the same reference, requery, IDOR.
* Migration rehearsal (old `ACHW-` wallets with money and history → migration 016): same wallets, balances and ledger, new numbers, old IDs still resolve.


* Database (`supabase/tests/database/wallet.test.sql`, 67): top-up once/idempotent/mismatch/abandoned, ledger immutability and balance invariants, RLS, transfers (approval required, idempotency, insufficient funds, review hold, self-review blocked), wallet bills with refunds and reversals, OSUSU from wallet, mandates (paid / insufficient / no immediate retry / one per group), two-person adjustments, reversed top-up freezes the wallet.
* API (`backend/tests/services/wallet.test.js`, 18 + auth checks in `tests/api/billsReferrals.test.js`): masking, top-up limits, review → approve → execute once, approval bound to amount/recipient, step-up rules, limits, mandates, progressive PIN lockout, PIN never stored in events/challenges.
* Frontend: `SecureKeypad.test.jsx`, `TransactionApproval.test.jsx`.
