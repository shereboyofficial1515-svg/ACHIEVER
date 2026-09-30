# Transaction security, biometrics and push

## Approving a payment

No bill is bought on a single tap. The flow is: **Review → Confirm Purchase → approval → server validation → Paystack → delivery → receipt**.

| Where | Approval |
|---|---|
| Web, or Android without biometrics | **Transaction PIN** (6 digits, separate from the sign-in password), then a **6-digit code emailed** to the account owner |
| Android with biometrics on | The phone's Keystore key signs the server's challenge after a fingerprint, face or screen-lock check |

The challenge (`transaction_auth_challenges`) is:
- single use;
- valid for 10 minutes (`security.transaction_auth_minutes`);
- bound to the user and the session;
- bound to a hash of the exact amount, fee, recipient, plan and quantity that was reviewed. If the bill changes after review, the approval fails.

Emailed codes are stored only as an HMAC and allow 5 attempts. Up to 10 challenges per hour are allowed, plus endpoint rate limits.

**Transaction PIN** (`transaction_credentials`):
- Stored as `scrypt(HMAC(server key, PIN), random salt)`, so a leaked database alone can't be brute-forced offline.
- Never logged or returned to the client.
- Weak PINs (123456, 111111 and similar) are refused.
- 5 wrong entries lock it for 30 minutes (both configurable), and a security notification is sent.
- Creating or changing it needs the sign-in password and an emailed security code (challenge action `transaction_pin_change`) behind a confirmation dialog.

The server never accepts a client flag such as `isBiometric=true`. The confirm endpoint accepts only an emailed code or a signature it can verify.

## Android biometrics

`frontend/android/app/src/main/java/com/achiever/app/AchieverSecurityPlugin.java`:

1. **Enable** (Settings → Security → Biometric sign-in):
   - a confirmation dialog;
   - the sign-in password;
   - the phone creates an EC P-256 key in the Android Keystore that can only be used after strong biometric or device-credential authentication, per use, and is invalidated when new fingerprints or faces are added;
   - the biometric prompt signs a server nonce with the new key, proving possession;
   - the server stores only the **public key** (`biometric_device_keys`).
2. **Sign in:** challenge → biometric prompt → signature → the server verifies it with the stored public key and creates a normal session (`auth_method = device_biometric`).
3. **Approve a payment:** the same idea, signing the payment challenge.
4. **Never leaves the phone:** fingerprint or face data, passwords and long-lived tokens are never stored on or sent from the phone.
5. **Fallbacks:** cancelling the prompt leaves nothing changed and offers password or PIN. If the key was invalidated (biometrics changed), biometrics are switched off and the user is asked to turn them on again.
6. **Revoked:** turning biometrics off, changing or resetting the password, "sign out everywhere", or suspension revokes the device keys.
7. **App lock:** after more than 5 minutes in the background, a phone with biometrics on is covered until the owner passes the phone's biometric or screen-lock check. Cancelling means signing in with the password.
8. **Screenshot protection:** `FLAG_SECURE` hides the approval screen, token/PIN reveal and app lock from screenshots and the recent-apps preview.

## Push notifications

- **Server:** Firebase Cloud Messaging HTTP v1 (`backend/src/services/pushService.js`), using a service-account JWT signed with Node's crypto; there is no Firebase SDK on the server.
- **Env:** `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`.
- **App:** `@capacitor/push-notifications`. It is enabled only when `frontend/android/app/google-services.json` exists; that file is git-ignored and must be provided per environment. Build with `npm run android:build`.
- **Permission:** asked only when the user taps "Turn on push notifications", after an explanation. Never at first launch.
- **Tokens:** stored encrypted (`push_devices`) and looked up by HMAC. Rotated tokens are re-registered, and tokens FCM reports as unregistered are disabled. On sign-out, this phone's token is removed.
- **Lock-screen text:** payments, payouts and security notices use a generic sentence ("You have a new payment update…"). Amounts, numbers and names stay inside the app.
- **Preferences:** a push master switch plus a push column per category (Settings → Notifications). Security notices are always sent.
- **Covered:** bill success, failure, pending and reversal; refunds; referral milestones and rewards; contribution reminders; payouts; security alerts; new-device sign-ins; verification; admin announcements. Notifications with an email/SMS channel also get push once a device is registered.

## Android permissions

APK manifest: `INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA` and `RECORD_AUDIO` (asked only for calls or photos), `USE_BIOMETRIC` (no runtime prompt), `POST_NOTIFICATIONS` (asked only when the user turns push on), plus FCM's `WAKE_LOCK` and `c2dm.RECEIVE`.

**Not requested:** contacts, SMS, call logs, location, storage.

## Audit (append-only)

Each of these writes an audit record:
- bill initiated, authorised, delivered, failed or reversed;
- token/PIN viewed;
- transaction PIN set or changed;
- PIN failures and locks;
- biometric enabled, disabled or invalidated;
- biometric sign-in;
- approval challenges issued, verified or failed;
- referral created or qualified;
- reward decisions;
- admin bill service toggles, catalogue refreshes and reconciliations;
- setting changes.
