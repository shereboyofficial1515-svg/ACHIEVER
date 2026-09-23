import { env } from '../../config/env.js';
import { escapeHtml } from '../../utils/sanitize.js';

const NAVY = '#0B1F3A';
const GOLD = '#C9A227';

/** Shared, table-based layout that renders consistently across email clients. */
export function layout({ preheader = '', heading, bodyHtml, cta }) {
  const button = cta
    ? `<tr><td style="padding:8px 0 24px"><a href="${escapeHtml(cta.url)}"
         style="background:${NAVY};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;
         font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></td></tr>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(heading)}</title></head>
<body style="margin:0;background:#F3F5F8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1B2433">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:${NAVY};padding:18px 28px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.08em">
ACHIEVER<span style="color:${GOLD}">.</span></td></tr>
<tr><td style="padding:28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-size:20px;font-weight:600;padding-bottom:12px">${escapeHtml(heading)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;padding-bottom:16px">${bodyHtml}</td></tr>
${button}
</table></td></tr>
<tr><td style="padding:16px 28px;background:#F8F9FB;font-size:12px;color:#5B6576;line-height:1.5">
You are receiving this because you have an ACHIEVER account. Manage email preferences in Profile &rarr; Notifications.
Need help? Contact ${escapeHtml(env.SUPPORT_EMAIL)}. ACHIEVER never asks for your password, PIN or OTP.
</td></tr></table></td></tr></table></body></html>`;
}

const p = (text) => `<p style="margin:0 0 12px">${escapeHtml(text)}</p>`;

export const templates = {
  emailVerification: ({ name, code }) => ({
    subject: 'Verify your ACHIEVER email',
    html: layout({
      preheader: 'Your verification code',
      heading: 'Confirm your email address',
      bodyHtml: `${p(`Hello ${name},`)}${p('Use this code to verify your email. It expires in 10 minutes.')}
        <p style="font-size:28px;font-weight:700;letter-spacing:.3em;margin:8px 0 16px">${escapeHtml(code)}</p>
        ${p('If you did not create an ACHIEVER account, you can ignore this email.')}`,
    }),
    text: `Your ACHIEVER verification code is ${code}. It expires in 10 minutes.`,
  }),

  passwordReset: ({ name, code, url }) => ({
    subject: 'Reset your ACHIEVER password',
    html: layout({
      preheader: 'Password reset code',
      heading: 'Password reset requested',
      bodyHtml: `${p(`Hello ${name},`)}${p('Use this code to reset your password. It expires in 10 minutes.')}
        <p style="font-size:28px;font-weight:700;letter-spacing:.3em;margin:8px 0 16px">${escapeHtml(code)}</p>
        ${p('If you did not request this, secure your account by changing your password.')}`,
      cta: { label: 'Reset password', url },
    }),
    text: `Your ACHIEVER password reset code is ${code}. Reset at ${url}`,
  }),

  welcome: ({ name }) => ({
    subject: 'Welcome to ACHIEVER',
    html: layout({
      heading: `Welcome, ${name}`,
      bodyHtml: `${p('Your email is verified. You can now join or organise Osusu groups, save with a collector and pay bills.')}`,
      cta: { label: 'Open dashboard', url: `${env.CLIENT_URL}/app` },
    }),
    text: `Welcome to ACHIEVER, ${name}. Open your dashboard: ${env.CLIENT_URL}/app`,
  }),

  invite: ({ inviterName, contextName, url, kind }) => ({
    subject: kind === 'osusu_group' ? `You're invited to join ${contextName}` : `${inviterName} invited you to save with them`,
    html: layout({
      heading: kind === 'osusu_group' ? `Join ${contextName}` : `Savings invitation from ${contextName}`,
      bodyHtml: p(
        kind === 'osusu_group'
          ? `${inviterName} invited you to an Osusu group on ACHIEVER. Review the contribution terms before you accept.`
          : `${inviterName} invited you to a savings plan on ACHIEVER. Review the term and commission before you accept.`,
      ),
      cta: { label: 'Review invitation', url },
    }),
    text: `${inviterName} invited you on ACHIEVER. Review: ${url}`,
  }),

  securityAlert: ({ name, event }) => ({
    subject: 'ACHIEVER security alert',
    html: layout({
      heading: 'Security alert',
      bodyHtml: `${p(`Hello ${name},`)}${p(event)}${p('If this was not you, reset your password immediately and contact support.')}`,
    }),
    text: `ACHIEVER security alert: ${event}`,
  }),

  /** Generic notification email built from a notifications row. */
  notification: ({ name, title, body, url }) => ({
    subject: title,
    html: layout({
      preheader: body.slice(0, 90),
      heading: title,
      bodyHtml: `${p(`Hello ${name},`)}${p(body)}`,
      cta: url ? { label: 'View in ACHIEVER', url } : undefined,
    }),
    text: `${title}\n\n${body}${url ? `\n\n${url}` : ''}`,
  }),
};
