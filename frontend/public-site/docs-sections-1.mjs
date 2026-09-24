import { SITE } from './layout.mjs';

const S = SITE.supportEmail;

/** Sections 1–18 of the documentation centre. Each describes what the app actually does. */
export const SECTIONS_1 = [
  {
    id: 'what-is-achiever', title: '1. What is ACHIEVER?', keywords: 'about overview ajo esusu osusu collector',
    html: `<p>ACHIEVER is a Nigerian savings coordination and payments platform. It helps people save together in <strong>Osusu</strong> (also called Ajo or Esusu) groups, save individually with a trusted <strong>Collector</strong>, pay everyday bills, and stay in touch through messages, calls and meetings.</p>
<p>Every contribution is confirmed with our payment provider (Paystack) on ACHIEVER's servers before it appears in your records, so everyone in a group sees the same, verified history of who has paid, who is due and who has been paid out.</p>
<div class="callout"><strong>ACHIEVER is not a bank.</strong> It is not licensed by the Central Bank of Nigeria as a deposit-taking institution, and money recorded in ACHIEVER is not covered by NDIC deposit insurance. Only join groups and save with people you know and trust.</div>`,
  },
  {
    id: 'create-account', title: '2. Creating an account', keywords: 'register sign up signup new account create google facebook',
    html: `<p>Go to <a href="/register">Create account</a>. Registration has five short steps:</p>
<ol class="steps-list">
<li><strong>Account type</strong> — Osusu, Collector or Personal use.</li>
<li><strong>Your role</strong> — for example Osusu organiser or member, Collector or saver. Personal accounts get member and saver features.</li>
<li><strong>About you</strong> — your legal first and last name exactly as on your government ID, date of birth (you must be 18 or older), and gender. Occupation and employment are optional.</li>
<li><strong>Contact &amp; address</strong> — email, Nigerian mobile number, state, local government area (LGA) and city. Organisers and collectors must also give a residential address. Your address is private and never shown to other members.</li>
<li><strong>Security</strong> — a password of at least 10 characters with upper- and lower-case letters and a number, and your agreement to the Terms and Privacy Policy.</li>
</ol>
<p>If Google or Facebook sign-in is available, you can use it instead of a password. You will still add your legal details and verify your phone number — a social account does not verify your identity for financial activity.</p>`,
  },
  {
    id: 'account-verification', title: '3. Account verification', keywords: 'verify email phone code otp sms level',
    html: `<p>After you register we email you a <strong>6-digit code</strong>. Enter it on the verification screen to confirm your email address. Codes expire after 10 minutes, allow 5 attempts, and you can request a new one after 60 seconds.</p>
<p>Next, verify your phone number from <strong>Verification</strong> in the app. We send a 6-digit code by SMS to the number on your account.</p>
<p>Verifying your email and phone, together with your legal name, date of birth and location, brings your account to <a href="#kyc">verification level 1</a>.</p>`,
  },
  {
    id: 'profile', title: '4. User profile', keywords: 'profile photo name preferred name address location settings',
    html: `<p>Open <strong>Settings → Profile</strong> to update your photo, preferred name (what other members see), occupation, employment, address and location.</p>
<ul>
<li>Your <strong>legal name and date of birth</strong> can be edited until your identity is verified (level 2). After that they are locked; contact support to correct a mistake.</li>
<li>Changing your <strong>address</strong> resets its verification status, and the change is recorded in your security history.</li>
<li>You choose whether your city and state appear on your public trust profile.</li>
</ul>`,
  },
  {
    id: 'osusu', title: '5. Osusu', keywords: 'osusu ajo esusu group rotation payout order contribution cycle join code organiser member',
    html: `<p><strong>Osusu</strong> in ACHIEVER is a rotating savings group. A fixed group of members contribute the <strong>same amount</strong> on a <strong>set schedule</strong> (daily, weekly, every two weeks or monthly). Each cycle, the full pool goes to <strong>one member</strong>, in an agreed order, until everyone has been paid once.</p>
<h3>How a group works</h3>
<ul>
<li>An <strong>organiser</strong> creates the group with a name, contribution amount, schedule, maximum number of members (2–100), start date, grace period (0–14 days) and payout order method (order of joining, random, or set manually).</li>
<li>Members join with an <strong>invitation link</strong> or the group's <strong>8-character join code</strong>. If the group requires approval, the organiser approves each request.</li>
<li>When the group starts, ACHIEVER creates the cycles and each member's contributions for every cycle.</li>
</ul>
<h3>Payout rotation</h3>
<p>Each cycle has one recipient. When all contributions for the cycle are paid (the cycle is <em>fully funded</em>), the organiser approves the payout. The payout is then sent to the recipient's verified payout account and recorded with a reference.</p>
<h3>Why members keep contributing after their payout</h3>
<p>Every member receives the pool exactly once, funded by everyone else's contributions. A member who has already been paid must keep contributing until the last member is paid — otherwise later members would receive less than they put in. Missing contributions after receiving a payout is treated seriously and places the member under review.</p>
<h3>Payment status</h3>
<p>Each contribution shows as <strong>Pending</strong>, <strong>Paid</strong> or <strong>Overdue</strong>. A payment is only marked Paid after Paystack confirms it.</p>
<h3>Overdue contributions</h3>
<p>If a contribution is not paid by its due date plus the group's grace period, it becomes <strong>Overdue</strong>. You receive reminders, the organiser can see who is overdue, and repeated non-payment affects your standing in the group.</p>
<h3>Communication and meetings</h3>
<p>Every group has its own chat. Organisers can schedule meetings with an optional voice or video call; members receive reminders before the meeting starts.</p>`,
  },
  {
    id: 'collector', title: '6. Collector', keywords: 'collector saver savings plan commission maturity return settlement',
    html: `<p>A <strong>Collector account</strong> lets a trusted person hold individual savings for savers over an agreed period and earn an agreed commission.</p>
<h3>Becoming a collector</h3>
<p>Collectors verify their phone and a government ID (verification level 2), accept a written undertaking, and submit a collector application. Applications are reviewed by ACHIEVER's compliance team; a collector can only accept savers once approved and active.</p>
<h3>How a saver works with a collector</h3>
<ul>
<li>The collector invites a saver to a <strong>savings plan</strong> with a name, frequency (daily, weekly, monthly or flexible), optional expected amount, start and end date (up to 3 years), and commission.</li>
<li>The saver reviews the terms and accepts the invitation.</li>
<li>The saver pays <strong>flexible amounts</strong> into the plan at any time while it is active. Each payment is confirmed with Paystack before it is added to the balance.</li>
</ul>
<h3>Savings period and maturity</h3>
<p>The plan runs until its end date, when it becomes <strong>Matured</strong>. The saver can then request their return. A return can also be requested before the end date. The collector approves every return request (ACHIEVER staff can step in if there is a problem).</p>
<h3>Commission</h3>
<p>Commission is agreed before saving starts: either a percentage of the total (up to 20%) or a fixed amount. It is shown on the plan and deducted when the return is settled — never before.</p>
<h3>Settlement</h3>
<p>When a return is approved, ACHIEVER records the saver's net amount and the collector's commission as separate payouts and sends them to each person's verified payout account.</p>
<h3>Disputes</h3>
<p>If something is wrong with a plan, open a case in <a href="#disputes">Help &amp; disputes</a> and link the plan. The collector can respond with their side and evidence.</p>`,
  },
  {
    id: 'contributions', title: '7. Contributions', keywords: 'contribution pay due amount osusu savings',
    html: `<p>Osusu contributions have a <strong>fixed amount</strong> set by the group; you cannot pay a different amount. Open your group, find the contribution that is due, and choose <strong>Pay</strong>. Collector savings contributions can be any amount you choose.</p>
<p>To make contributions you need <strong>verification level 1</strong>. If you are asked to verify, follow the link in the message.</p>`,
  },
  {
    id: 'payments', title: '8. Payments', keywords: 'payment paystack card bank transfer ussd pending verify checkout',
    html: `<p>Payments are made through <strong>Paystack</strong> checkout (card, bank, USSD or bank transfer, depending on what is enabled). ACHIEVER never sees or stores your card details.</p>
<ul>
<li>After checkout, ACHIEVER checks the payment directly with Paystack. Your contribution is marked paid only when Paystack confirms it, using the amount Paystack actually received.</li>
<li>If you start the same payment twice within 30 minutes (for example by double-clicking), ACHIEVER reuses the same checkout so you are not charged twice.</li>
<li>If the amount received differs from the amount due, the payment is held for review instead of being applied.</li>
<li>If a payment is completed twice, the duplicate is refunded.</li>
</ul>
<p>You can see every payment and its status under <strong>Payments</strong>.</p>`,
  },
  {
    id: 'payouts', title: '9. Payouts', keywords: 'payout withdrawal receive money bank account transfer held review',
    html: `<p>Payouts (Osusu pools, savings returns and collector commissions) are sent to your <strong>verified payout account</strong>. Add it in <strong>Settings → Payment accounts</strong>.</p>
<ul>
<li>An organiser's or collector's approval is an instruction only. A payout is marked <strong>Paid</strong> only after the money has actually been sent and confirmed.</li>
<li>For your protection some payouts are <strong>held for review</strong> before sending — for example if your payout account was changed recently, your verification level is below level 2, the amount is large, or your account is under review.</li>
<li>If a payout fails (for example the bank rejects it), you are notified and it can be retried.</li>
</ul>`,
  },
  {
    id: 'savings', title: '10. Savings', keywords: 'savings balance my savings plan',
    html: `<p><strong>My savings</strong> shows each collector savings plan you have: its balance, total contributed, days remaining, the agreed commission and your expected return (balance minus commission). Open a plan to see every contribution and request a return when you are ready.</p>`,
  },
  {
    id: 'bills', title: '11. Bill payments', keywords: 'bills airtime data electricity meter token',
    html: `<p>Where available, you can buy <strong>airtime</strong> and <strong>data</strong> and pay <strong>electricity</strong> bills from <strong>Bills</strong>. You pay through Paystack; ACHIEVER then delivers the purchase through its bill provider and shows the result and any token on the receipt.</p>
<p>If delivery fails after you have paid, the payment is refunded to your original payment method. Bill payments may be temporarily unavailable while the service is being set up or maintained.</p>`,
  },
  {
    id: 'notifications', title: '12. Notifications', keywords: 'notifications alerts email sms reminders',
    html: `<p>ACHIEVER notifies you in the app about payments, reminders, payouts, groups, meetings, support cases and account activity. You can also receive email and SMS for most of these — choose which in <a href="#notification-settings">notification settings</a>.</p>
<p><strong>Security alerts cannot be turned off.</strong> Sign-ins from new devices and changes to your password, email, phone or payout account are always sent.</p>`,
  },
  {
    id: 'messages', title: '13. Messages', keywords: 'messages chat group chat direct message attachment',
    html: `<p>Each Osusu group and each savings plan has its own chat. You can also message people you share a group or plan with. You can send text and attachments (images and PDFs up to 10 MB). Files are stored privately and opened through short-lived links.</p>
<p>Read receipts, message sounds, previews and automatic photo loading can be changed in <strong>Settings → Messages</strong>.</p>`,
  },
  {
    id: 'voice-calls', title: '14. Voice calls', keywords: 'voice call audio call microphone',
    html: `<p>Start a voice call from any chat with the phone icon. The other person sees an incoming-call alert and can accept or decline. Calls use your browser's microphone; allow microphone access when your browser asks.</p>`,
  },
  {
    id: 'video-calls', title: '15. Video calls', keywords: 'video call camera',
    html: `<p>Start a video call from a chat with the camera icon. You can turn your camera and microphone on or off during the call and choose your audio device. Allow camera and microphone access when asked.</p>`,
  },
  {
    id: 'group-calls', title: '16. Group calls', keywords: 'group call meeting conference',
    html: `<p>Calls started in a group chat, and scheduled group meetings, include every member who joins. Members receive an incoming-call alert and can join while the call is active.</p>`,
  },
  {
    id: 'account-security', title: '17. Account security', keywords: 'security account protect password lockout new device alert',
    html: `<ul>
<li>Your session is kept in secure, HTTP-only cookies and ends automatically after a period of time.</li>
<li>After 5 incorrect password attempts, sign-in is locked for 15 minutes and you are emailed.</li>
<li>Signing in from a new device sends you an alert. You can choose to be alerted for every sign-in.</li>
<li>Changing your password, email, phone or payout account needs your password and a security code, and sends you a confirmation.</li>
</ul>
<p>ACHIEVER will <strong>never</strong> ask for your password, PIN, OTP or banking credentials — by phone, SMS, email or chat.</p>`,
  },
  {
    id: 'kyc', title: '18. KYC (verification levels)', keywords: 'kyc level verification identity requirements',
    html: `<table><thead><tr><th>Level</th><th>What you need</th><th>What it unlocks</th></tr></thead><tbody>
<tr><td>0</td><td>Verified email</td><td>Browse, chat with contacts, pay bills</td></tr>
<tr><td>1</td><td>Verified phone, legal name, date of birth, state, LGA and city</td><td>Make Osusu and savings contributions</td></tr>
<tr><td>2</td><td>A verified, unexpired government ID</td><td>Receive payouts without an identity hold; organise groups; operate as a collector</td></tr>
<tr><td>3</td><td>Liveness check and verified address</td><td>Highest level (liveness checks are not available yet)</td></tr>
</tbody></table>
<p>Your current level and next step are shown in <strong>Settings → Profile</strong> and <strong>Verification</strong>.</p>`,
  },
];
