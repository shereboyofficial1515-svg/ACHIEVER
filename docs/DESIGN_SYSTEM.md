# ACHIEVER design system

Direction: **premium modern fintech**. Deep emerald is the brand, on white surfaces and soft neutral backgrounds. Sky blue is kept only for links and information, and status colours are restrained.

All colours are CSS variables in `frontend/src/styles/tokens.css`. Components use semantic tokens only.

## Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-emerald-950/900/800` | #03211a / #053b2b / #075a40 | | brand surfaces (balance cards, auth aside, hero) |
| `--color-green-primary` | #0b7a4f | #22b07a | primary buttons, selected, progress |
| `--color-green-dark` / `-light` / `-50` | #07603e / #e8f4ee / #f3faf6 | #1a9466 / #102a20 / #0f1f19 | hover, tinted icons and backgrounds |
| `--color-sky-dark` / `-light` | #0369a1 / #e6f3fb | #7dd3fc / #0d2433 | links, info only |
| `--color-background` | #f5f6f4 | #0b110f | page |
| `--color-surface` / `-elevated` / `-sunken` | white / white / #f1f3f1 | #121a17 / #18221e / #0f1613 | cards, dialogs, insets |
| `--color-text-primary` / `-secondary` / `-muted` | #0f1a16 / #3a4742 / #5f6c67 | #e7eeea / #bccac4 / #8e9d97 | text |
| `--color-border` / `-strong` | #e3e8e5 / #cdd5d1 | #222e29 / #34433d | lines, inputs |
| `--color-sidebar-*` | white sidebar, emerald active | dark sidebar | desktop sidebar and phone drawer |
| `--gradient-balance` | deep emerald with a soft highlight | | wallet, dashboard and profile balance cards, bills hero |
| `--gradient-brand`, `--gradient-green` | emerald only | | primary moments, progress bars |

- **Type:** Inter with tabular figures. Page title 24px (21px on phones); card titles 15px; money values 20–40px at weight 650 with tight letter-spacing.
- **Shape:** radii 8 / 10 / 14 px (`--radius-sm`, `--radius`, `--radius-lg`). Shadows are layered and subtle (`--shadow-sm`, `--shadow`, `--shadow-md`, `--shadow-lg`).
- **Contrast** (checked): white on primary green 5.4:1; muted text 5.1:1 on the page background; sidebar labels 5.0:1 (light) and 4.7:1 (dark). Status never relies on colour alone: badges have a dot and text.
- **Legacy names:** older names (`--navy-*`, `--gray-*`, `--white`) remain as aliases of the semantic tokens.

## Layout

- **Desktop:** a light sidebar grouped into Savings, Money, Community and Support, with the member card, Settings and Sign out at the bottom. The translucent top bar shows the page title, notifications and an account menu (profile, settings, help, sign out).
- **Phone:** a top bar, a drawer with the same groups plus Account, and a five-item bottom bar (chosen by role) with an active pill. Content is capped at 1180 px. Grids use `minmax(0, 1fr)`.

## Shared patterns

- **Balance card** (`.balance-card`, `.wallet-hero`): deep emerald, with figures from `GET /wallet` only.
- **Next action** (`.next-card`): the member's earliest open contribution, or what comes next.
- **Overview strip** (`.overview-grid`): separate figures, never summed into one total.
- **Group and plan cards** (`.group-card`): terms first (amount, frequency, capacity), then progress.
- **Payout timeline** (`.payout-timeline`): a payout is marked paid only when the server recorded `paidAt`.
- **Toolbar** (`.toolbar`, `.search-field`, `.segmented`): search and a status filter.
- **Stepper** (`.stepper`, `.form-actions`, `.review-hero`): multi-step forms that end on a review.

## Themes

- **Choices:** Light, Dark and System (the default) in Settings → Appearance. The choice is stored in `user_preferences.accessibility.theme` and in `localStorage`.
- **No flash:** `/site/boot.js` sets `html[data-theme]` before first paint, and "System" follows `prefers-color-scheme` live.
- **Other surfaces:** the public pages share the same boot script and palette. The admin app has its own switch (in the top bar) and the same tokens.

## Gradients

Gradients are CSS only (no animation library): the hero overlay, the Help Center header, stat highlights, the registration steps and progress bars. There are no gradients on ordinary cards.

## Imagery

- **Registry:** every image is registered in `src/content/imageAssets.js` with id, alt text, credit and licence.
- **Hero:** *"Woman holding tomatoes near containers of tomatoes"*, Lagos, by **Omotayo Tajudeen** on **Unsplash** (Unsplash License).
  - It is served from Unsplash's CDN in responsive sizes (640–1920 px), with a portrait crop for phones.
  - It is loaded with high priority as the only above-the-fold image. A deep emerald overlay keeps text readable. The credit is shown on the image.
- **Help Center diagrams** (`src/help/FlowIllustration.jsx`): ACHIEVER-drawn step flows (icon "screens" and arrows) built from each article's steps, in brand colours.
  - They are text-based, so they work in dark mode and with screen readers, and cost no downloads.
  - They render only when an article (or a card) is shown.

## Critical actions

- **Where it lives:**
  - `src/security/criticalActions.js`: the matrix.
  - `components/ui/ConfirmProvider.jsx`: `confirmAction()`, one accessible dialog with focus trap, Escape and the Android back button to cancel, and focus return.
  - `components/domain/CriticalGate.jsx`: warning before verification.
  - `components/domain/usePaymentReview.js`: the review → confirm flow for money.
  - `hooks/useSingleFlight.js`: no double submits.
- **Server side:** money routes also accept `Idempotency-Key`, so a retried request never acts twice.

| Action | Protection |
|---|---|
| Log out | Confirmation |
| Change password | Warning, current password, emailed code |
| Change email | Warning, password, emailed code, code to new address |
| Change phone | Warning, password, emailed code, SMS to new number (or email fallback) |
| Payout account | Emailed code + waiting period |
| Payment / contribution / bill | Review (recipient, purpose, amount, fee, method, total) → Confirm payment → idempotent start → Paystack → server verification |
| Delete account / data | Strong warning, type DELETE, password, emailed code, final confirmation, 7-day cancellation |
| Sign out other devices | Confirmation |
| Admin actions | Confirmation, reason, authenticator code, audit (admin app) |
