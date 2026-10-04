# ACHIEVER Android app (Capacitor)

The Android app is the **same React app** as the website, wrapped by Capacitor 8.
There is no second codebase and no second backend.

```
frontend/src  ──build──▶ dist/ ──cap sync──▶ frontend/android (native shell)
                                              │  https://localhost (WebView origin)
                                              ▼
                              ACHIEVER API on Render (same as the website)
```

- Native features go through `frontend/src/platform/`:
  - `index.js` is the single API the app calls: platform detection, external links, share, network status, media permissions, file saving and push notifications (not yet active).
  - `android.js` holds the Android-only code (back button, status bar, splash, deep links, system browser). It is loaded only inside the app; the website never downloads it.
- No secret is ever bundled. The app only knows the public API and site addresses.

## Requirements

| Tool | Version |
|---|---|
| Node.js | 20.19+ (22 recommended) |
| JDK | **21** (Capacitor 8 requirement; Android Studio's bundled JBR 25 is too new for Gradle 8.14.3) |
| Android Studio | current stable, with SDK Platform 36 and Build-Tools 35+ |
| Capacitor | 8.x (`@capacitor/core`, `@capacitor/android` and official plugins) |

## Build

```bash
cd frontend
npm install
npm run android:build        # web build pointed at the production API + cap sync
npm run android:open         # opens Android Studio
```

`android:build` uses `https://api.achieverng.site` and `https://achieverng.site` (override with ACHIEVER_API_URL / ACHIEVER_SITE_URL).
It refuses `localhost` and plain `http`.
Override with `ACHIEVER_API_URL` / `ACHIEVER_SITE_URL` for a staging build.

Command-line builds (JDK 21 on `JAVA_HOME`):
```bash
cd frontend/android
./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk (id com.achiever.app.debug)
./gradlew bundleRelease      # app/build/outputs/bundle/release/app-release.aab  (Play Store)
./gradlew assembleRelease    # release APK
```

## App identity, icon and splash

- Application ID: `com.achiever.app` (debug builds: `com.achiever.app.debug`, so both can be installed).
- Name: ACHIEVER. `minSdk` 24 (Android 7.0), `target/compileSdk` 36.
- Icon and splash come from the official logo:
  1. `node scripts/make-app-assets.mjs` writes the source images to `resources/`.
  2. `npm run android:assets` generates every density, including adaptive and round icons, plus light and dark splash screens.
- The splash hides as soon as the first screen is ready (at most 1.5 s).

## Versioning

- `versionName` = `frontend/package.json` `version` (the web and Android versions match).
- `versionCode` = an increasing integer, from `ACHIEVER_VERSION_CODE` (CI) or `achieverVersionCode` in `~/.gradle/gradle.properties`. Increase it for every Play Store upload.

## Release signing (never in Git)

1. Create a keystore once and keep it (and a backup) outside the repository:
   ```bash
   keytool -genkeypair -v -keystore achiever-release.jks -alias achiever -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Provide it at build time through **environment variables**: `ACHIEVER_KEYSTORE_FILE`, `ACHIEVER_KEYSTORE_PASSWORD`, `ACHIEVER_KEY_ALIAS`, `ACHIEVER_KEY_PASSWORD`. In CI, use the CI's secret store.
   Locally, a `frontend/android/keystore.properties` file also works; it is git-ignored:
   ```
   storeFile=C:/secure/achiever-release.jks
   storePassword=...
   keyAlias=achiever
   keyPassword=...
   ```
3. Without these, release builds are produced **unsigned** (fine for testing; Play needs a signed AAB).
   Enrol in Play App Signing so Google holds the final signing key.

`*.jks`, `*.keystore` and `keystore.properties` are git-ignored.

## How the app talks to the API

- The app runs at `https://localhost` inside the WebView and calls the Render API directly.
- **Allowed origin:** the API allows that origin (`ANDROID_APP_ORIGIN`, default `https://localhost`) in CORS.
- **Session cookies:** requests from the app get their session cookies as `SameSite=None; Secure; HttpOnly`.
  - JavaScript cannot read them.
  - `MainActivity` enables them for the WebView.
  - They stay in the app's private storage.
  - Backups and device-transfer of app data are disabled (`data_extraction_rules.xml`, `allowBackup=false`).
  - So no token is ever put in `localStorage` or other readable storage, and no separate secure-storage plugin is needed.
- **Payments:** the server gives the app a Paystack return address of `https://localhost/app/payments/callback` (fixed and allow-listed, never taken from the request). Paystack pages stay inside the app (`allowNavigation`). Success is shown only after server-side verification, exactly as on the web.
- **Google / Facebook sign-in:** these providers block sign-in inside WebViews.
  1. The app opens the website's sign-in in the **system browser** (`?client=android`).
  2. After sign-in the API redirects to `com.achiever.app://auth/callback?code=…`.
  3. The code is a sealed, encrypted, 2-minute handoff.
  4. The app exchanges it at `POST /api/auth/oauth/handoff` for its own session cookies.
- **Realtime (SSE):** works with the WebView's cookies, like the web.

## Android behaviour

| Area | Behaviour |
|---|---|
| Back button | Closes the top dialog, then the menu drawer, then goes back a screen. On a root screen it minimises the app (never signs out, never confirms anything). |
| Status bar | Follows the theme (dark icons on light, light icons on dark). |
| Theme | Light / Dark / System, from Settings → Appearance (shared with the web and saved to the account). |
| Permissions | Camera and microphone are asked for only when a call or photo needs them; notifications only when the user turns push on; biometrics need no prompt. No contacts, SMS, location or storage permission. |
| External links | Terms, privacy and other sites open in the system browser. |
| Share | Native share sheet (Help articles, references). |
| Offline | Banner: "You appear to be offline…". Figures are marked possibly out of date. Nothing (especially money) is retried automatically. |

## Biometrics, app lock and push

See [TRANSACTION_SECURITY.md](TRANSACTION_SECURITY.md).
- **Biometrics:** the in-app plugin `AchieverSecurityPlugin.java` (Keystore EC key, `androidx.biometric`) handles biometric sign-in and payment approval, plus screenshot protection.
- **App lock:** after 5 minutes in the background.
- **Push:** `@capacitor/push-notifications`. Put the environment's `google-services.json` in `android/app/` (git-ignored) and run `npm run android:build`; the build prints whether push is ON.

## Monitoring (prepared)

JavaScript errors are caught by the app's error boundary, and API errors carry request IDs that match the Render logs. To add crash reporting (e.g. Sentry or Firebase Crashlytics), hook it into `ErrorBoundary` and `platform/android.js`. Never send personal, KYC or payment data in events.

## Test checklist (device or emulator)

- Sign in with email and password.
- Sign-up and email verification.
- Sign out: the confirmation appears.
- Back button: closes dialogs and the drawer; leaves the app at the dashboard.
- Theme: Light, Dark and System, including switching the phone's dark mode.
- Contribution: review → Confirm payment → Paystack (test card) → returns to the app → verified.
- Voice call and video call: the microphone and camera prompts appear only then; an audio call never shows video.
- Offline: turn on airplane mode, see the banner, turn it off again, then Retry.
- Help Center: search, open an article, Share.
- Upload a profile photo from the camera and from files.
- Google sign-in (after the providers are enabled in Supabase).
