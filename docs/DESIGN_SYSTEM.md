# ACHIEVER design system

The design system has four colour roles.
- **Green:** growth, savings, success; used for primary actions.
- **Sky blue:** trust, help, information; used for links, info and the Help Center.
- **White:** surfaces.
- **Black:** typography and navigation.

All colours are CSS variables in `frontend/src/styles/tokens.css`; components use semantic tokens only.

## Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-green-primary` | #0a8754 | #1fb57a | primary buttons, success, selected |
| `--color-green-dark` / `-light` | #06683f / #e4f5ec | #179463 / #11291f | hover, tinted success backgrounds |
| `--color-sky-primary` | #0ea5e9 | #38bdf8 | decorative, gradients, focus |
| `--color-sky-dark` / `-light` | #0369a1 / #e3f2fd | #7dd3fc / #0d2433 | links, info |
| `--color-background` | #f5f7f6 | #0e1412 | page |
| `--color-surface` / `-elevated` / `-sunken` | white / white / #eff3f1 | #151d1a / #1b2521 / #111816 | cards, dialogs, table headers |
| `--color-text-primary` / `-secondary` / `-muted` | #0b0f0e / #37423e / #5b6863 | #e8eeeb / #bcc8c3 / #8f9d97 | text |
| `--color-border` / `-strong` | #e0e7e3 / #c3cec9 | #26322d / #37463f | lines, inputs |
| `--color-success/warning/error/info` (+ `-bg`, `-text`) | | | status |
| `--color-nav-*` | near-black | near-black | sidebar, drawer |
| `--gradient-brand` (green→sky), `--gradient-sky-green`, `--gradient-green`, `--gradient-sky`, `--gradient-hero-overlay` | | | hero, primary moments, progress |

- **Contrast:** text on green buttons is at least 4.5:1 in both themes. Status never relies on colour alone: badges have a dot and text; confirmations have an icon, a title and labelled buttons.
- **Shape:** radii are 6 / 8 / 12 px and shadows are subtle, to avoid the "rounded card everywhere" look.
- **Legacy names:** older names (`--navy-*`, `--gray-*`, `--white`) remain as aliases of the semantic tokens, so any leftover use still follows the theme.

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
  - It is loaded with high priority as the only above-the-fold image. A green→sky overlay keeps text readable. The credit is shown on the image.
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
