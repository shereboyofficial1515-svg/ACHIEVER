import { SITE } from './layout.mjs';

const S = SITE.supportEmail;

/** Sections 19–35 of the documentation centre. */
export const SECTIONS_2 = [
  {
    id: 'identity-verification', title: '19. Identity verification', keywords: 'identity nin bvn passport drivers licence voters card document upload',
    html: `<p>Verify your identity from <strong>Verification</strong>. You can use a NIN, BVN, international passport, driver's licence or voter's card.</p>
<ol class="steps-list">
<li>Enter the document type, number, your legal names and date of birth (and the expiry date for passports and driver's licences).</li>
<li>Upload a clear photo or PDF of the document (max 5 MB).</li>
<li>ACHIEVER's compliance team reviews it. You are notified of the decision.</li>
</ol>
<p>Your document number is stored only as a one-way fingerprint plus the last four characters, and is never shown to other users. Staff can open your document only with a recorded reason. When a document expires, your verification level is updated and you will be asked to submit a current one.</p>`,
  },
  {
    id: 'payment-account-verification', title: '20. Payment-account verification', keywords: 'payout account bank nuban verify change cool-down',
    html: `<p>Add your bank account in <strong>Settings → Payment accounts</strong>. ACHIEVER confirms the account name with your bank before saving it. Only the bank name, account name and last four digits are kept.</p>
<p><strong>Changing</strong> your payout account needs a code sent to your email. You receive a security alert, and for your protection automated payouts to the new account are held for a short cool-down period (24 hours by default).</p>`,
  },
  {
    id: 'devices-sessions', title: '21. Managing devices and sessions', keywords: 'devices sessions sign out logout other devices',
    html: `<p><strong>Settings → Devices &amp; sessions</strong> lists where you are signed in, with the device, approximate network and last activity. You can sign out any single session or <strong>all other sessions</strong> at once. Changing your password signs out every other session automatically.</p>`,
  },
  {
    id: 'change-password', title: '22. Changing password', keywords: 'change password new password security code',
    html: `<ol class="steps-list">
<li>Open <strong>Settings → Password</strong> and enter your current password.</li>
<li>We email a 6-digit security code. Enter it.</li>
<li>Enter your current password, a new password and confirm it.</li>
</ol>
<p>Your other sessions are signed out and you receive a confirmation email. Forgot your password? Use <a href="/forgot-password">Forgot password</a> on the sign-in page — we email you a reset code.</p>`,
  },
  {
    id: 'change-email', title: '23. Changing email', keywords: 'change email address new email',
    html: `<ol class="steps-list">
<li>Open <strong>Settings → Email</strong>, enter your password and the security code we send to your <strong>current</strong> email.</li>
<li>Enter your new email address. We send a confirmation code to the <strong>new</strong> address.</li>
<li>Enter that code. Your sign-in email is updated, and your previous address receives a security notice.</li>
</ol>`,
  },
  {
    id: 'change-phone', title: '24. Changing phone number', keywords: 'change phone number sms new number',
    html: `<ol class="steps-list">
<li>Open <strong>Settings → Phone</strong>, enter your password and the security code we email you.</li>
<li>Enter your new Nigerian mobile number. We send an SMS code to it.</li>
<li>Enter the SMS code. Your number is updated; your previous number (if verified) and your email receive a notice.</li>
</ol>`,
  },
  {
    id: 'notification-settings', title: '25. Managing notification settings', keywords: 'notification settings email sms turn off unsubscribe marketing',
    html: `<p>In <strong>Settings → Notifications</strong> you can turn email and SMS on or off for each category: payments, reminders, payouts, group updates, meetings, support, account updates, messages, platform notices and marketing. In-app notifications are always on. Push notifications are not available yet.</p>
<p>Platform notices and marketing emails include an <strong>unsubscribe</strong> link. Security alerts and messages about your money are not marketing and cannot be unsubscribed from.</p>`,
  },
  {
    id: 'accessibility-settings', title: '26. Accessibility settings', keywords: 'accessibility text size font reduced motion contrast keyboard',
    html: `<p><strong>Settings → Accessibility</strong> changes the whole app immediately: text size, reduced motion (or follow your device), high contrast, larger touch targets, underlined links and a strong keyboard focus indicator. See our <a href="/accessibility.html">accessibility statement</a>.</p>`,
  },
  {
    id: 'privacy-settings', title: '27. Privacy settings', keywords: 'privacy online status read receipts trust profile location',
    html: `<p>In <strong>Settings → Privacy</strong> you can hide your online status. In <strong>Settings → Messages</strong> you can turn off read receipts (you then won't see other people's either). Your public trust profile only shows your display name, verification badges and contribution record — never your contact details, address or balances.</p>`,
  },
  {
    id: 'delete-account', title: '28. Deleting an account', keywords: 'delete account close account deactivate',
    html: `<p>From <strong>Settings → Account deletion</strong> you can request deletion of your account. You confirm with your password and a security code, and you can cancel within 7 days. Accounts with open groups, savings plans or payouts must settle them first. Some records must be kept by law — see <a href="/delete-data.html">how deletion works</a>. You can also deactivate your account immediately from the same page.</p>`,
  },
  {
    id: 'data-deletion', title: '29. Requesting data deletion', keywords: 'data deletion personal data erase gdpr ndpr',
    html: `<p>If you want to keep your account but remove optional personal data (preferred name, occupation, business name, photo, settings), choose <strong>Optional personal data only</strong> in <strong>Settings → Account deletion</strong>. Details are on the <a href="/delete-data.html">Delete Data</a> page.</p>`,
  },
  {
    id: 'refunds', title: '30. Refund policy', keywords: 'refund duplicate failed reversal money back',
    html: `<p>Duplicate payments, payments made to a closed contribution, failed bill deliveries and approved reversals are refunded to your original payment method. See the full <a href="/refund-policy.html">Refund Policy</a>.</p>`,
  },
  {
    id: 'disputes', title: '31. Disputes', keywords: 'dispute case complaint evidence collector organiser wrong payment',
    html: `<p>Open a case from <strong>Help &amp; disputes</strong> in the app. Choose the category, describe what happened, add the amount involved, and link the transaction, group or plan. Each case gets a number like <code>CASE-2026-000123</code>.</p>
<ul>
<li>Add evidence — receipts, screenshots or documents. Each file is fingerprinted when uploaded and cannot be edited afterwards.</li>
<li>For disputes about a group or savings plan, the organiser or collector can see the case and respond with their own evidence. No finding is made until ACHIEVER reviews both sides.</li>
<li>When the case is resolved you receive the outcome and a written explanation.</li>
</ul>`,
  },
  {
    id: 'report-suspicious', title: '32. Reporting suspicious activity', keywords: 'fraud suspicious unauthorised hacked scam report',
    html: `<div class="callout danger"><strong>If you think someone else has accessed your account:</strong> change your password now (Settings → Password), sign out all other sessions (Settings → Devices &amp; sessions), then open a case with the category <em>Someone else accessed my account</em>.</div>
<p>To report a suspected scam or misuse of funds, open a case with the category <em>Suspected fraud</em> and include as much detail as you can. Reports are reviewed by our team; reporting someone does not automatically accuse them of wrongdoing.</p>`,
  },
  {
    id: 'contact-support', title: '33. Contacting support', keywords: 'support help contact email ticket',
    html: `<p>The fastest way to get help with your account is to open a case in the app (<strong>Help &amp; disputes</strong>) or on the <a href="/support.html">Support</a> page. You can also email <a href="mailto:${S}">${S}</a>. Never include your password, PIN or full card number.</p>`,
  },
  {
    id: 'troubleshooting', title: '34. Troubleshooting', keywords: 'problem not working help error troubleshooting',
    html: `<h3 id="t-register">I cannot create an account</h3><ul>
<li>Check the highlighted fields — names must use letters only, you must be 18 or older, and the LGA must be in the state you chose.</li>
<li>An email address or phone number can only be used by one account. If yours is taken, try <a href="/forgot-password">resetting your password</a>.</li>
<li>If the page says ACHIEVER is unavailable, check your internet connection and try again shortly.</li></ul>
<h3 id="t-login">I cannot log in</h3><ul>
<li>Check your email and password (passwords are case-sensitive).</li>
<li>After 5 failed attempts sign-in is locked for 15 minutes — wait, then try again.</li>
<li>Reset your password with <a href="/forgot-password">Forgot password</a>.</li>
<li>If your account was suspended or deactivated, contact support.</li></ul>
<h3 id="t-payment-pending">My payment is pending</h3><ul>
<li><strong>Do not pay again.</strong> Keep the payment page open — ACHIEVER is confirming the payment with Paystack.</li>
<li>Check <strong>Payments</strong> for the status. Most payments confirm within minutes; bank transfers can take longer.</li>
<li>If you were debited and it still shows pending after a few hours, open a case with the payment reference.</li></ul>
<h3 id="t-payment-failed">My payment failed</h3><ul>
<li>No money is recorded against your contribution for a failed attempt. If your bank debited you, the provider normally reverses it automatically.</li>
<li>Try again, or try a different payment method.</li></ul>
<h3 id="t-otp">I didn't receive my code (OTP)</h3><ul>
<li>Check that your phone number or email address is correct.</li>
<li>Wait a minute — SMS and email can be delayed. You can request a new code after 60 seconds.</li>
<li>Each new code replaces the previous one; use the latest code. Avoid requesting many codes in a row.</li>
<li>Check your network signal (SMS) or spam folder (email).</li></ul>
<h3 id="t-email">I didn't receive my email</h3><ul>
<li>Check your spam or junk folder and search for "ACHIEVER".</li>
<li>Check the email address on your account. Request another verification email from the verification screen.</li>
<li>Still nothing? Contact support.</li></ul>
<h3 id="t-calls">My video call is not working</h3><ul>
<li>Allow camera and microphone access in your browser (look for the camera icon in the address bar).</li>
<li>Close other apps using your camera. Check your internet connection.</li>
<li>Leave the call and rejoin, or reload the page. Use an up-to-date Chrome, Edge, Firefox or Safari.</li></ul>
<h3 id="t-payout">My payout has not arrived</h3><ul>
<li>Check that your payout account is added and verified.</li>
<li>If you recently changed your payout account, payouts are held for a short cool-down.</li>
<li>Payouts can be held for review for your protection. You are notified if it fails.</li></ul>`,
  },
  {
    id: 'faq', title: '35. Frequently asked questions', keywords: 'faq questions',
    html: `<details><summary>What is ACHIEVER?</summary><p>A platform for Osusu groups, collector savings, bill payments and communication, with verified payment records. It is not a bank.</p></details>
<details><summary>What is Osusu?</summary><p>A rotating savings group: members contribute a fixed amount on a schedule and one member receives the pool each cycle until all have been paid. See <a href="#osusu">Osusu</a>.</p></details>
<details><summary>What is Collector?</summary><p>Individual savings held by an approved collector for an agreed period, returned at maturity minus the agreed commission. See <a href="#collector">Collector</a>.</p></details>
<details><summary>Is my money safe?</summary><p>ACHIEVER records every payment only after Paystack confirms it, keeps a permanent record of every transaction, verifies organisers and collectors, and protects payouts with holds and reviews. However, ACHIEVER is not a bank and funds are not insured. Only save with people you trust.</p></details>
<details><summary>How are payments verified?</summary><p>ACHIEVER's server asks Paystack directly whether each payment succeeded and for how much. Browser redirects and notifications are never trusted on their own.</p></details>
<details><summary>How is my identity verified?</summary><p>You submit a government ID and a photo of it; our compliance team reviews it. See <a href="#identity-verification">Identity verification</a>.</p></details>
<details><summary>Why does ACHIEVER need my information?</summary><p>To protect members' money: to confirm who organisers, collectors and members are, to prevent fraud, to resolve disputes and to meet legal obligations. See the <a href="/privacy.html">Privacy Policy</a>.</p></details>
<details><summary>Can I change my phone number?</summary><p>Yes — Settings → Phone. See <a href="#change-phone">Changing phone number</a>.</p></details>
<details><summary>Can I change my email?</summary><p>Yes — Settings → Email. See <a href="#change-email">Changing email</a>.</p></details>
<details><summary>How do I change my password?</summary><p>Settings → Password. See <a href="#change-password">Changing password</a>.</p></details>
<details><summary>How do I delete my account?</summary><p>Settings → Account deletion. See <a href="#delete-account">Deleting an account</a>.</p></details>
<details><summary>How do I report fraud?</summary><p>Open a case with the category <em>Suspected fraud</em>. See <a href="#report-suspicious">Reporting suspicious activity</a>.</p></details>
<details><summary>How do I report a payment problem?</summary><p>Open a case in Help &amp; disputes, choose the payment category and link the transaction.</p></details>
<details><summary>How do I contact support?</summary><p>Open a case in the app or on the <a href="/support.html">Support</a> page, or email <a href="mailto:${S}">${S}</a>.</p></details>
<details><summary>How do I join an Osusu group?</summary><p>Open the invitation link you received, or go to Osusu groups → Join and enter the 8-character code. The organiser may need to approve you.</p></details>
<details><summary>How does payout rotation work?</summary><p>Each cycle one member receives the full pool, in the group's payout order, until everyone has been paid once. See <a href="#osusu">Osusu</a>.</p></details>
<details><summary>What happens when I miss a contribution?</summary><p>After the due date and grace period it becomes overdue; you and the organiser are notified and your standing in the group is affected. If you have already received your payout, missed contributions place your membership under review. Pay as soon as you can.</p></details>`,
  },
];
