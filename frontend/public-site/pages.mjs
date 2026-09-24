import { SITE, LEGAL_NOTICE } from './layout.mjs';
import { SECTIONS_1 } from './docs-sections-1.mjs';
import { SECTIONS_2 } from './docs-sections-2.mjs';

const S = SITE.supportEmail;
const updated = `<p class="small muted">Last updated: ${SITE.updated}</p>`;
const sec = (id, title, html) => `<section id="${id}"><h2>${title}</h2>${html}</section>`;
const toc = (items) => items.map(([id, t]) => [id, t]);

// ------------------------------------------------------------------------------------------
const DOC_SECTIONS = [...SECTIONS_1, ...SECTIONS_2];
const documentation = {
  slug: 'documentation.html',
  title: 'Documentation',
  h1: 'ACHIEVER documentation',
  description: 'How ACHIEVER works: accounts, verification, Osusu groups, collector savings, payments, payouts, bills, messages, calls, security, disputes, troubleshooting and FAQ.',
  lead: 'Everything you need to use ACHIEVER — Osusu groups, collector savings, payments and account security — in plain language.',
  toc: DOC_SECTIONS.map((s) => [s.id, s.title]),
  body: `<div class="search" role="search">
  <label for="doc-search">Search the documentation</label>
  <input id="doc-search" type="search" autocomplete="off" placeholder="Try “change password”, “payment failed”, “OTP”, “refund”…" aria-describedby="doc-search-hint" aria-controls="doc-search-results">
  <p id="doc-search-hint" class="small muted">Results appear as you type.</p>
  <ul id="doc-search-results" class="search-results" aria-live="polite"></ul>
</div>
<div class="grid-cards">
  <a class="card" href="#create-account"><h3>Get started</h3><p>Create an account and verify your email and phone.</p></a>
  <a class="card" href="#osusu"><h3>Osusu</h3><p>Rotating group savings, payouts and schedules.</p></a>
  <a class="card" href="#collector"><h3>Collector</h3><p>Individual savings with an approved collector.</p></a>
  <a class="card" href="#troubleshooting"><h3>Troubleshooting</h3><p>Payments, codes, sign-in and calls.</p></a>
</div>
${DOC_SECTIONS.map((s, i) => `<section id="${s.id}" data-doc data-keywords="${s.keywords}"><h2>${s.title}</h2>${s.html}
<div class="prevnext">${i > 0 ? `<a href="#${DOC_SECTIONS[i - 1].id}">← ${DOC_SECTIONS[i - 1].title}</a>` : '<span></span>'}${i < DOC_SECTIONS.length - 1 ? `<a href="#${DOC_SECTIONS[i + 1].id}">${DOC_SECTIONS[i + 1].title} →</a>` : '<a href="/support.html">Still need help? Contact support →</a>'}</div></section>`).join('\n')}`,
};

// ------------------------------------------------------------------------------------------
const termsToc = toc([
  ['about', '1. About these terms'], ['accounts', '2. Your account'], ['eligibility', '3. Eligibility and verification'],
  ['acceptable-use', '4. Acceptable use'], ['payments', '5. Payments'], ['contributions', '6. Contribution obligations'],
  ['osusu-rules', '7. Osusu rules'], ['collector-rules', '8. Collector responsibilities'], ['disputes', '9. Disputes'],
  ['restrictions', '10. Restrictions and suspension'], ['termination', '11. Closing your account'], ['changes', '12. Changes to the service'],
  ['liability', '13. Limitations'], ['contact', '14. Contact'],
]);
const terms = {
  slug: 'terms.html', title: 'Terms of Service', description: 'The rules for using ACHIEVER: accounts, payments, contribution obligations, Osusu and Collector rules, disputes, suspension and termination.',
  lead: 'The rules that apply when you use ACHIEVER.', toc: termsToc,
  body: `${LEGAL_NOTICE}${updated}
${sec('about', '1. About these terms', `<p>These terms apply to your use of the ACHIEVER website and application. By creating an account you agree to them. ACHIEVER coordinates savings arrangements and records payments; it is <strong>not a bank</strong>, does not accept deposits, and does not pay interest.</p>`)}
${sec('accounts', '2. Your account', `<ul><li>Give accurate information, including your legal name and date of birth as shown on your government ID.</li><li>Keep your password and security codes secret. You are responsible for activity on your account. ACHIEVER will never ask for your password, PIN or OTP.</li><li>Tell us promptly if you suspect someone else has accessed your account.</li><li>One person, one account. Do not create accounts for other people without their authority.</li></ul>`)}
${sec('eligibility', '3. Eligibility and verification', `<p>You must be at least 18 years old. Some activities require a verification level (see the <a href="/documentation.html#kyc">documentation</a>). We may ask for further information or documents, and we may decline to verify an account if information cannot be confirmed.</p>`)}
${sec('acceptable-use', '4. Acceptable use', `<p>You must not use ACHIEVER to: commit fraud or impersonate anyone; collect money under false pretences; launder money or finance crime; harass, threaten or abuse other users; upload unlawful content or malware; interfere with the service or other users' accounts; or attempt to bypass verification, limits or security controls.</p>`)}
${sec('payments', '5. Payments', `<ul><li>Payments are processed by Paystack. A payment counts only once Paystack confirms it to ACHIEVER.</li><li>Do not repeat a payment that is still processing. Duplicate payments are refunded under the <a href="/refund-policy.html">Refund Policy</a>.</li><li>Payment providers and banks may charge their own fees and have their own terms.</li></ul>`)}
${sec('contributions', '6. Contribution obligations', `<p>When you join an Osusu group you commit to paying every contribution for every cycle until the rotation ends, including after you have received your own payout. When you save with a collector you agree to the plan's terms, including the collector's commission.</p>`)}
${sec('osusu-rules', '7. Osusu rules', `<ul><li>The organiser sets the contribution amount, schedule, member limit, grace period and payout order before the group starts. Members should review them before joining.</li><li>Each cycle's pool is paid to one member once the cycle is fully funded and the organiser approves it.</li><li>Organisers must be verified, accept a written undertaking, manage the group fairly and must not withhold or divert members' payouts.</li><li>Members who stop contributing after receiving a payout are placed under review and may be restricted.</li></ul>`)}
${sec('collector-rules', '8. Collector responsibilities', `<ul><li>Collectors must be verified, accept a written undertaking and be approved before accepting savers.</li><li>Collectors must honour each plan's agreed term and commission, approve valid return requests promptly, and must not misuse savers' funds.</li><li>Collector status can be restricted, suspended or revoked where there are unresolved complaints, late settlements or breaches of these terms.</li></ul>`)}
${sec('disputes', '9. Disputes', `<p>Raise any problem through Help &amp; disputes in the app. We review the records, evidence and both parties' accounts before reaching an outcome. Opening a case does not by itself mean anyone has done wrong. Corrections to the ledger are made only by linked reversal or adjustment entries approved by two authorised staff members; records are never silently deleted.</p>`)}
${sec('restrictions', '10. Restrictions and suspension', `<p>We may temporarily restrict activities, hold payouts for review, or suspend an account to protect users — for example after unusual activity, a security concern, unresolved disputes, failed verification, or a breach of these terms. We will tell you when an activity is restricted, in neutral terms, and how to contact us.</p>`)}
${sec('termination', '11. Closing your account', `<p>You can deactivate your account or request deletion at any time from Settings, once open groups, plans and payouts are settled. We may close accounts that breach these terms. Records we are required to keep are retained after closure — see <a href="/delete-data.html">Delete Data</a>.</p>`)}
${sec('changes', '12. Changes to the service', `<p>We may change or discontinue features, and update these terms. We will tell you about material changes in the app or by email before they take effect.</p>`)}
${sec('liability', '13. Limitations', `<p>ACHIEVER coordinates arrangements between users. Organisers, collectors and members are responsible for their own obligations to each other. To the extent permitted by Nigerian law, ACHIEVER is not responsible for losses caused by other users' actions, by third-party payment or bank services, or by events outside our reasonable control. Nothing in these terms limits any right you have under applicable consumer-protection law.</p>`)}
${sec('contact', '14. Contact', `<p>Questions about these terms: <a href="mailto:${S}">${S}</a> or the <a href="/support.html">Support</a> page.</p>`)}`,
};

// ------------------------------------------------------------------------------------------
const privacyToc = toc([
  ['collect', '1. Information we collect'], ['why', '2. Why we use it'], ['identity', '3. Identity verification'], ['payments', '4. Payment information'],
  ['security', '5. Security, device and session information'], ['communications', '6. Communications'], ['protection', '7. How we protect data'],
  ['sharing', '8. Who we share data with'], ['retention', '9. How long we keep data'], ['rights', '10. Your rights'], ['deletion', '11. Account deletion'], ['contact', '12. Contact'],
]);
const privacy = {
  slug: 'privacy.html', title: 'Privacy Policy', description: 'What personal information ACHIEVER collects, why, how it is protected, who it may be shared with, how long it is kept, and your rights.',
  lead: 'How ACHIEVER collects, uses and protects your personal information.', toc: privacyToc,
  body: `${LEGAL_NOTICE}${updated}
${sec('collect', '1. Information we collect', `<table><thead><tr><th>Category</th><th>Examples</th></tr></thead><tbody>
<tr><td>Account</td><td>Email, phone number, password (stored by our authentication provider as a secure hash; ACHIEVER never sees it)</td></tr>
<tr><td>Identity</td><td>Legal names, date of birth, gender, nationality; ID type, last four characters and a one-way fingerprint of the number; ID images you upload</td></tr>
<tr><td>Address</td><td>State, LGA, city, residential address (optional for members, required for organisers and collectors)</td></tr>
<tr><td>Optional profile</td><td>Preferred name, photo, occupation, employment, business name</td></tr>
<tr><td>Financial</td><td>Contributions, payouts, savings plans, bill payments, payment references and status; payout bank name, account name and last four digits</td></tr>
<tr><td>Security</td><td>Sign-in times, devices (a random device identifier stored as a fingerprint), approximate network address, security events</td></tr>
<tr><td>Communications</td><td>Messages, attachments, call records (not call audio or video), support cases and evidence</td></tr>
</tbody></table>`)}
${sec('why', '2. Why we use it', `<ul><li>To run your account and the savings arrangements you join.</li><li>To verify identities so members know who organisers and collectors are.</li><li>To confirm payments and send payouts to the right person.</li><li>To prevent, detect and investigate fraud and misuse.</li><li>To resolve disputes using accurate records.</li><li>To send you service, security and (if you choose) marketing messages.</li><li>To meet legal and regulatory obligations.</li></ul>`)}
${sec('identity', '3. Identity verification', `<p>Identity documents are stored in private storage. We keep only the last four characters of your ID number and a keyed one-way fingerprint used to stop the same ID being used on several accounts. Authorised compliance staff can open a document only after recording a reason, and every access is logged.</p>`)}
${sec('payments', '4. Payment information', `<p>Card and bank details you enter at checkout are handled by Paystack; ACHIEVER does not receive or store full card numbers. For payouts we keep your bank name, account name and last four digits; the full account number is sent to the payment provider to create a transfer recipient and is not stored by ACHIEVER.</p>`)}
${sec('security', '5. Security, device and session information', `<p>We record sign-ins, sessions and devices so you can see where you are signed in, receive new-device alerts, and so we can detect account takeover. Network addresses are shown to you only in partly masked form.</p>`)}
${sec('communications', '6. Communications', `<p>Messages and attachments are visible to the members of the conversation. Voice and video calls are connected through our calling provider and are not recorded by ACHIEVER. Staff may review messages linked to a dispute case you open.</p>`)}
${sec('protection', '7. How we protect data', `<ul><li>Encryption in transit (HTTPS) and secure, HTTP-only session cookies.</li><li>Least-privilege staff access with permissions per role, and two-person approval for high-impact actions.</li><li>A permanent log of who viewed sensitive information and why.</li><li>Financial and security records that cannot be edited or silently deleted.</li></ul>`)}
${sec('sharing', '8. Who we share data with', `<p>We do not sell your data. We share only what is needed with: Paystack (payments and payouts); our authentication and database provider; our email (Resend) and SMS (Termii) providers; our calling provider (LiveKit); bill-payment providers when you buy airtime, data or electricity; other members, as described in the app (for example your display name in a group); and authorities, courts or regulators where the law requires it.</p>`)}
${sec('retention', '9. How long we keep data', `<p>We keep account data while your account is open. After closure we retain identity/verification records, transactions, contributions, payouts, disputes, audit and security logs for as long as required by law and for fraud prevention and dispute resolution; optional profile data is erased on request.</p>`)}
${sec('rights', '10. Your rights', `<p>Subject to applicable Nigerian data-protection law, you may ask to access, correct or delete your personal data, object to certain uses, and withdraw consent to optional processing such as marketing. Most corrections can be made in Settings; contact us for anything else.</p>`)}
${sec('deletion', '11. Account deletion', `<p>You can request account or personal-data deletion in Settings. See <a href="/delete-data.html">Delete Data</a> for what is erased and what must be kept.</p>`)}
${sec('contact', '12. Contact', `<p>Privacy questions: <a href="mailto:${S}">${S}</a>.</p>`)}`,
};

// ------------------------------------------------------------------------------------------
const refund = {
  slug: 'refund-policy.html', title: 'Refund Policy', description: 'When ACHIEVER refunds payments: duplicate and failed payments, reversals, bill-payment failures, provider disputes and timelines.',
  lead: 'When money is refunded, how, and how long it takes.',
  toc: toc([['eligible', 'Eligible refunds'], ['not-refundable', 'What is not refunded'], ['failed', 'Failed payments'], ['duplicate', 'Duplicate payments'], ['reversals', 'Reversals'], ['bills', 'Bill-payment failures'], ['provider', 'Payment-provider disputes'], ['timelines', 'Processing timelines'], ['help', 'Getting help']]),
  body: `${LEGAL_NOTICE}${updated}
${sec('eligible', 'Eligible refunds', `<ul><li>A duplicate payment for a contribution that was already paid.</li><li>A payment received for a contribution or plan that could no longer accept it (for example a closed plan).</li><li>A bill payment that could not be delivered after you paid.</li><li>A contribution reversed after review (when the reversal includes a refund).</li></ul>`)}
${sec('not-refundable', 'What is not refunded', `<p>Valid contributions to an active Osusu group or savings plan are not refundable on request — they belong to the arrangement you joined and are paid out under its rules. Savings are returned through the plan's return process; Osusu contributions are returned through the rotation. Delivered airtime, data and electricity tokens cannot be refunded.</p>`)}
${sec('failed', 'Failed payments', `<p>If a payment fails, nothing is recorded against your contribution. If your bank debited you anyway, the payment provider normally reverses the debit automatically; contact your bank if it does not appear.</p>`)}
${sec('duplicate', 'Duplicate payments', `<p>ACHIEVER detects when the same contribution is paid twice and starts a refund of the duplicate automatically. You receive a notification when it is initiated and when it completes.</p>`)}
${sec('reversals', 'Reversals', `<p>If a successful payment must be undone (for example after a confirmed error), ACHIEVER records a reversal linked to the original transaction. Reversals need approval from two authorised staff members and may include a refund. The original record is never deleted.</p>`)}
${sec('bills', 'Bill-payment failures', `<p>If a bill cannot be delivered after payment, it is marked for refund and the amount is returned to your original payment method.</p>`)}
${sec('provider', 'Payment-provider disputes', `<p>If you dispute a charge with your bank or card issuer, the payment provider may ask ACHIEVER for records. We share the transaction record, which may also be used to resolve the matter in the app.</p>`)}
${sec('timelines', 'Processing timelines', `<p>Refunds are initiated through Paystack as soon as they are approved. How long they take to reach you depends on your bank and payment method — often a few business days, sometimes longer. ACHIEVER cannot speed up bank processing.</p>`)}
${sec('help', 'Getting help', `<p>Open a case in Help &amp; disputes with the payment reference, or email <a href="mailto:${S}">${S}</a>.</p>`)}`,
};

// ------------------------------------------------------------------------------------------
const cookie = {
  slug: 'cookie-policy.html', title: 'Cookie Policy', description: 'The cookies and local storage ACHIEVER uses: necessary authentication, security and preference cookies only; no advertising or analytics cookies.',
  lead: 'ACHIEVER uses a small number of necessary cookies. We do not use advertising or analytics cookies.',
  body: `${LEGAL_NOTICE}${updated}
${sec('necessary', 'Necessary cookies', `<table><thead><tr><th>Name</th><th>Purpose</th><th>Duration</th></tr></thead><tbody>
<tr><td><code>ach_at</code></td><td>Keeps you signed in (access token, HTTP-only)</td><td>Up to 1 hour</td></tr>
<tr><td><code>ach_rt</code></td><td>Renews your sign-in (refresh token, HTTP-only, sent only to the sign-in service)</td><td>Up to your session limit</td></tr>
<tr><td><code>ach_ss</code></td><td>Signed session marker used to end sessions on time and sign out revoked sessions</td><td>Session limit</td></tr>
<tr><td><code>ach_csrf</code></td><td>Protects forms from cross-site request forgery</td><td>24 hours</td></tr>
<tr><td><code>ach_did</code></td><td>Random device identifier used for new-device alerts (stored by us only as a fingerprint)</td><td>1 year</td></tr>
<tr><td><code>ach_oauth</code></td><td>Temporary security state during Google/Facebook sign-in</td><td>10 minutes</td></tr>
</tbody></table>`)}
${sec('preferences', 'Preferences', `<p>Your accessibility settings (text size, motion, contrast) are also saved in your browser's local storage (<code>achiever.a11y</code>) so they apply before you sign in.</p>`)}
${sec('analytics', 'Analytics', `<p>ACHIEVER does not currently use analytics or advertising cookies. If that changes, we will update this policy and ask for consent where required.</p>`)}
${sec('third-party', 'Third parties', `<p>When you pay, Paystack's checkout may set its own cookies on its own website. Our pages load fonts from Google Fonts. These services have their own policies.</p>`)}
${sec('controls', 'Cookie controls', `<p>You can delete cookies in your browser settings. Necessary cookies are required to sign in; if you block them you will not be able to use your account.</p>`)}`,
};

// ------------------------------------------------------------------------------------------
const security = {
  slug: 'security.html', title: 'Security', description: 'How ACHIEVER protects accounts and money records: verification, traceable payments, fraud prevention, monitoring, and how to report a security issue.',
  lead: 'How we protect your account and the money records of every group.',
  toc: toc([['accounts', 'Account security'], ['identity', 'Identity verification'], ['traceability', 'Financial traceability'], ['fraud', 'Fraud prevention'], ['monitoring', 'Security monitoring'], ['staff', 'Staff access'], ['incidents', 'Reporting an incident'], ['disclosure', 'Responsible disclosure']]),
  body: `${LEGAL_NOTICE}${updated}
${sec('accounts', 'Account security', `<ul><li>Passwords of at least 10 characters; sign-in locks for 15 minutes after 5 failed attempts.</li><li>Sessions in secure HTTP-only cookies with a maximum lifetime; you can see and end any session.</li><li>Password, email, phone and payout-account changes require your password and a one-time security code, and always trigger a notification.</li><li>New-device sign-in alerts.</li></ul>`)}
${sec('identity', 'Identity verification', `<p>Organisers and collectors must verify a government ID and accept a written undertaking before handling other people's money. Collectors are also approved by our compliance team.</p>`)}
${sec('traceability', 'Financial traceability', `<p>Every payment is confirmed with Paystack by our servers. Each ledger entry records who, what, when, how and where to. Records cannot be edited or deleted; corrections are separate linked entries approved by two authorised staff members.</p>`)}
${sec('fraud', 'Fraud prevention', `<p>We hold payouts for review when there are risk signals — such as a recently changed payout account, an unverified recipient or a large amount — and we review repeated complaints about a collector. Reviews use neutral language and explainable reasons; a review is not an accusation.</p>`)}
${sec('monitoring', 'Security monitoring', `<p>We record security events such as repeated failed sign-ins or verification codes, new devices and payout-account changes, and investigate them.</p>`)}
${sec('staff', 'Staff access', `<p>Staff have only the permissions their role needs. Viewing private information requires a recorded reason, sensitive actions require re-entering a password, and every action is audited.</p>`)}
${sec('incidents', 'Reporting an incident', `<div class="callout danger">If you think your account has been accessed by someone else, change your password, sign out other sessions, and open a case with the category “Someone else accessed my account”.</div>`)}
${sec('disclosure', 'Responsible disclosure', `<p>If you believe you have found a security vulnerability in ACHIEVER, email <a href="mailto:${S}">${S}</a> with the subject “Security report”. Please do not access other users' data, disrupt the service or publicly disclose the issue before we have had a reasonable time to fix it. We will acknowledge valid reports.</p>`)}`,
};

// ------------------------------------------------------------------------------------------
const support = {
  slug: 'support.html', title: 'Support', description: 'Get help with ACHIEVER: search the documentation, read FAQs, open a support case, or report suspicious activity.',
  lead: 'Find an answer, or open a case with our team.',
  body: `<div class="search" role="search">
  <label for="support-search">Search help</label>
  <form action="/documentation.html" method="get"><input id="support-search" name="q" type="search" placeholder="Search the documentation…"></form>
</div>
<h2>Popular topics</h2>
<div class="grid-cards">
  <a class="card" href="/documentation.html#payments"><h3>Payment issue</h3><p>Pending, failed or duplicate payments.</p></a>
  <a class="card" href="/documentation.html#troubleshooting"><h3>Account issue</h3><p>Sign-in, codes and emails.</p></a>
  <a class="card" href="/documentation.html#identity-verification"><h3>KYC issue</h3><p>Verification levels and documents.</p></a>
  <a class="card" href="/documentation.html#osusu"><h3>Osusu issue</h3><p>Groups, contributions and payouts.</p></a>
  <a class="card" href="/documentation.html#collector"><h3>Collector issue</h3><p>Plans, returns and commission.</p></a>
  <a class="card" href="/documentation.html#bills"><h3>Bill payment issue</h3><p>Airtime, data and electricity.</p></a>
  <a class="card" href="/security.html"><h3>Security issue</h3><p>Protecting and recovering your account.</p></a>
  <a class="card" href="/documentation.html#report-suspicious"><h3>Report suspicious activity</h3><p>Fraud, scams and unauthorised access.</p></a>
</div>
<section id="support-auth" aria-live="polite">
  <h2>Open a support case</h2>
  <div id="support-signed-out" hidden>
    <p><a class="btn btn-primary" href="/login">Log in to open a case</a> <a class="btn btn-ghost" href="/register">Create account</a></p>
    <p class="small muted">Signed-in cases are linked to your account so we can check your records. Can't sign in? Email <a href="mailto:${S}">${S}</a> from the address on your account.</p>
  </div>
  <div id="support-signed-in" hidden>
    <p class="small muted">Signed in as <strong id="support-user"></strong>. To link a specific transaction, group or plan, or to add evidence, <a href="/app/support">open the case in the app</a>.</p>
    <form id="ticket-form" class="form">
      <label>What is the problem about?
        <select name="category" required>
          <option value="incorrect_payment">Payment issue</option>
          <option value="missing_contribution">Missing contribution</option>
          <option value="payout_issue">Payout issue</option>
          <option value="collector_issue">Collector issue</option>
          <option value="bill_payment_issue">Bill payment issue</option>
          <option value="account_takeover">Someone else accessed my account</option>
          <option value="suspected_fraud">Suspected fraud</option>
          <option value="other">Account, KYC or something else</option>
        </select>
      </label>
      <label>Subject <input name="subject" required minlength="5" maxlength="150"></label>
      <label>What happened? <textarea name="description" required minlength="10" maxlength="4000" rows="5"></textarea></label>
      <p class="small muted">Never include your password, PIN, OTP or full card number.</p>
      <div><button class="btn btn-primary" type="submit">Open case</button></div>
    </form>
    <div id="ticket-result" role="status"></div>
    <h3>Your recent cases</h3>
    <ul id="ticket-list"></ul>
  </div>
  <noscript><p>Please <a href="/login">log in</a> and open a case from Help &amp; disputes.</p></noscript>
</section>
<h2>Contact</h2>
<p>Email <a href="mailto:${S}">${S}</a>. See also <a href="/contact.html">Contact</a>.</p>`,
};

// ------------------------------------------------------------------------------------------
const deleteData = {
  slug: 'delete-data.html', title: 'Delete your data', h1: 'Deleting your account and data',
  description: 'How to request deletion of your ACHIEVER account or personal data, what is erased, what must be retained by law, and how to check or cancel a request.',
  lead: 'How account deletion, personal-data deletion and record retention work at ACHIEVER.',
  toc: toc([['types', 'Three different things'], ['request', 'How to request deletion'], ['status', 'Check or cancel your request'], ['retained', 'What we must keep'], ['timeline', 'What happens next'], ['help', 'Contact support']]),
  body: `${LEGAL_NOTICE}
${sec('types', 'Three different things', `<table><thead><tr><th></th><th>What happens</th></tr></thead><tbody>
<tr><td><strong>Account deletion</strong></td><td>Your account is closed, you are signed out everywhere, and optional personal data (preferred name, photo, occupation, employment, business name, settings, public location) is erased.</td></tr>
<tr><td><strong>Personal-data deletion</strong></td><td>Optional personal data is erased; your account stays open.</td></tr>
<tr><td><strong>Record retention</strong></td><td>Some records must be kept even after deletion — see <a href="#retained">what we must keep</a>. They are not deleted, but they are no longer used for anything other than those purposes.</td></tr>
</tbody></table>`)}
${sec('request', 'How to request deletion', `<ol class="steps-list"><li>Sign in and open <a href="/app/settings/deletion">Settings → Account deletion</a>.</li><li>Choose account deletion or optional personal data only, and give a reason if you wish.</li><li>Confirm with your password and the security code we email you.</li></ol>
<p>Before an account can be deleted, any Osusu groups you organise or belong to, open savings plans and pending payouts must be settled.</p>`)}
${sec('status', 'Check or cancel your request', `<div id="deletion-status" aria-live="polite">
<div id="deletion-signed-out" hidden><p><a class="btn btn-primary" href="/login">Log in</a> to see the status of your requests.</p></div>
<div id="deletion-signed-in" hidden><ul id="deletion-list"></ul><p><a class="btn btn-ghost" href="/app/settings/deletion">Make a new request</a></p></div>
</div>
<p>You can cancel a request within <strong>7 days</strong> of making it.</p>`)}
${sec('retained', 'What we must keep', `<ul><li>Legal name, date of birth and identity verification records.</li><li>Transactions, payments, contributions, payouts, refunds and savings-plan records.</li><li>Dispute cases, evidence and support conversations.</li><li>Audit, security and sensitive-data access logs.</li></ul>
<p>These records protect other members (for example the history of an Osusu group you were part of), allow disputes and fraud to be investigated, and are required for legal and financial record-keeping. They are kept only as long as needed for those purposes.</p>`)}
${sec('timeline', 'What happens next', `<p>After the 7-day cancellation window, our compliance team completes the request and you are notified by email. If a request cannot be completed (for example because of open obligations), we tell you why.</p>`)}
${sec('help', 'Contact support', `<p>Can't sign in? Email <a href="mailto:${S}">${S}</a> from the address on your account and we will help you verify your identity first.</p>`)}`,
};

// ------------------------------------------------------------------------------------------
const accessibility = {
  slug: 'accessibility.html', title: 'Accessibility', description: 'ACHIEVER accessibility statement: built-in accessibility settings, keyboard and screen-reader support, known limitations and how to get help.',
  lead: 'We want everyone to be able to save and manage money with ACHIEVER.',
  body: `${updated}
${sec('settings', 'Accessibility settings', `<p>In <strong>Settings → Accessibility</strong> you can change text size, reduce motion, turn on high contrast, enlarge touch targets, underline links and show a strong keyboard focus indicator. These settings also apply to these public pages on the same device.</p>`)}
${sec('support', 'What we support', `<ul><li>Keyboard navigation throughout, with a “Skip to main content” link.</li><li>Labelled form fields, buttons and icons for screen readers.</li><li>Statuses shown with text as well as colour.</li><li>Respect for your device's reduced-motion setting; animations are short and never block actions.</li><li>Layouts that work on small phone screens without horizontal scrolling.</li></ul>`)}
${sec('limitations', 'Known limitations', `<p>Live captions are not available on voice and video calls. Some third-party pages, such as Paystack checkout, are outside our control.</p>`)}
${sec('help', 'Need help or found a barrier?', `<p>Tell us at <a href="mailto:${S}">${S}</a> with the page and what happened. We will work to fix it and help you complete your task another way in the meantime.</p>`)}`,
};

// ------------------------------------------------------------------------------------------
const about = {
  slug: 'about.html', title: 'About ACHIEVER', description: 'ACHIEVER helps Nigerian savings groups and collectors keep accurate, verified records of contributions, payouts and returns. Save Together. Go Further.',
  lead: 'Save Together. Go Further.',
  body: `<p>Osusu, Ajo and Esusu groups, and the collectors who hold savings for their communities, have helped millions of Nigerians save. They run on trust — and trust depends on everyone seeing the same, accurate record.</p>
<p>ACHIEVER gives groups and collectors that record. Every contribution is confirmed with the payment provider before it is recorded; everyone can see who has paid, who is due and who has been paid out; organisers and collectors verify their identity and sign a written undertaking; and members can talk, meet and resolve problems in one place.</p>
<h2>What ACHIEVER is not</h2>
<p>ACHIEVER is not a bank. It is not licensed by the Central Bank of Nigeria as a deposit-taking institution, and money recorded in ACHIEVER is not covered by NDIC deposit insurance. It does not offer loans or pay interest.</p>
<h2>Learn more</h2>
<div class="grid-cards">
  <a class="card" href="/documentation.html"><h3>Documentation</h3><p>How everything works.</p></a>
  <a class="card" href="/security.html"><h3>Security</h3><p>How we protect accounts and records.</p></a>
  <a class="card" href="/support.html"><h3>Support</h3><p>Get help from our team.</p></a>
</div>`,
};

const contact = {
  slug: 'contact.html', title: 'Contact', description: 'How to contact ACHIEVER support: open a case in the app, use the support page or email us.',
  lead: 'The quickest ways to reach the ACHIEVER team.',
  body: `<div class="grid-cards">
  <a class="card" href="/support.html"><h3>Support centre</h3><p>Search help and open a case.</p></a>
  <a class="card" href="/app/support"><h3>In the app</h3><p>Help &amp; disputes — link your transactions and add evidence.</p></a>
  <a class="card" href="mailto:${S}"><h3>Email</h3><p>${S}</p></a>
</div>
<h2>Security reports</h2>
<p>Report a security concern to <a href="mailto:${S}">${S}</a> with the subject “Security report”. See <a href="/security.html#disclosure">responsible disclosure</a>.</p>
<p class="callout">ACHIEVER will never ask for your password, PIN, OTP or banking credentials. If someone does, do not share them — report it to us.</p>`,
};

const notFound = {
  slug: '404.html', title: 'Page not found', description: 'The page you are looking for does not exist.', lead: 'The page you are looking for does not exist or has moved.',
  body: `<p><a class="btn btn-primary" href="/">Go to the home page</a> <a class="btn btn-ghost" href="/documentation.html">Documentation</a> <a class="btn btn-ghost" href="/support.html">Support</a></p>`,
};

const maintenance = {
  slug: 'maintenance.html', title: 'Scheduled maintenance', description: 'ACHIEVER is being updated.', lead: 'ACHIEVER is being updated. Please try again shortly.',
  body: `<p>Payments are paused during maintenance. Your balances and records are safe. We will be back as soon as possible.</p><p><a class="btn btn-ghost" href="/support.html">Support</a></p>`,
};

export const PAGES = [documentation, terms, privacy, refund, cookie, security, support, deleteData, accessibility, about, contact, notFound, maintenance];
