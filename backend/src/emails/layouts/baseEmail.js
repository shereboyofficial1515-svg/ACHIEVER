import { env } from '../../config/env.js';
import { escapeHtml } from '../../utils/sanitize.js';

/**
 * ACHIEVER branded email layout. Table-based with inline styles so it renders
 * consistently in Gmail, Outlook, Apple Mail and mobile clients. No web fonts,
 * background images or scripts. Every email is also sent as plain text.
 */
export const BRAND = Object.freeze({
  navy: '#0B2A5B',
  navyDark: '#071A3A',
  gold: '#C9A04A',
  text: '#1B2433',
  muted: '#5B6576',
  border: '#E3E7EE',
  bg: '#F3F5F8',
});

export function siteUrl(path = '') {
  return `${(env.PUBLIC_SITE_URL || env.CLIENT_URL).replace(/\/$/, '')}${path}`;
}

const e = (v) => escapeHtml(v == null ? '' : String(v));

export function header() {
  return `<tr><td align="center" style="padding:28px 24px 8px">
  <a href="${e(siteUrl('/'))}" style="text-decoration:none">
    <img src="${e(siteUrl('/brand/achiever-email-logo.png'))}" width="170" alt="ACHIEVER" style="display:block;width:170px;max-width:60%;height:auto;border:0;outline:none">
  </a></td></tr>`;
}

export function footer({ category = 'transactional', unsubscribeUrl } = {}) {
  const links = [
    ['Support', siteUrl('/support.html')],
    ['Documentation', siteUrl('/documentation.html')],
    ['Privacy Policy', siteUrl('/privacy.html')],
    ['Terms', siteUrl('/terms.html')],
  ].map(([l, u]) => `<a href="${e(u)}" style="color:${BRAND.navy};text-decoration:underline">${e(l)}</a>`).join(' &nbsp;·&nbsp; ');
  const why = {
    security: 'This is a security message about your ACHIEVER account. Security messages cannot be turned off.',
    transactional: 'You are receiving this because of activity on your ACHIEVER account. Manage email preferences in Settings → Notifications.',
    marketing: 'You are receiving this because you chose to receive updates from ACHIEVER.',
  }[category];
  const unsub = unsubscribeUrl
    ? `<br><a href="${e(unsubscribeUrl)}" style="color:${BRAND.muted};text-decoration:underline">Unsubscribe from these emails</a>`
    : '';
  return `<tr><td style="padding:20px 28px 28px;font-size:12px;line-height:1.6;color:${BRAND.muted};text-align:center">
  ${links}<br><br>
  ${e(why)} Need help? Email <a href="mailto:${e(env.SUPPORT_EMAIL)}" style="color:${BRAND.navy}">${e(env.SUPPORT_EMAIL)}</a>.${unsub}<br><br>
  ACHIEVER is a savings coordination and payments platform. It is not a bank.
</td></tr>`;
}

function detailsTable(details) {
  const rows = details.filter((d) => d && d[1] !== undefined && d[1] !== null && d[1] !== '')
    .map(([label, value]) => `<tr>
      <td style="padding:8px 0;font-size:13px;color:${BRAND.muted};border-bottom:1px solid ${BRAND.border};width:42%;vertical-align:top">${e(label)}</td>
      <td style="padding:8px 0;font-size:14px;color:${BRAND.text};border-bottom:1px solid ${BRAND.border};font-weight:600;vertical-align:top">${e(value)}</td>
    </tr>`).join('');
  return rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px">${rows}</table>` : '';
}

function button(cta) {
  if (!cta) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 22px"><tr>
    <td style="border-radius:8px;background:${BRAND.navy}">
      <a href="${e(cta.url)}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${e(cta.label)}</a>
    </td></tr></table>`;
}

const toneColor = { success: '#1E7F4F', danger: '#C0392B', warning: '#8A5A00', info: BRAND.navy };

/**
 * @param {object} o
 * @param {string} o.subject
 * @param {string} o.title            heading inside the card
 * @param {string} [o.preheader]      inbox preview text
 * @param {string} [o.name]           recipient name for the greeting
 * @param {string[]} [o.paragraphs]   body paragraphs (plain text; escaped)
 * @param {Array<[string, any]>} [o.details] key/value rows (transaction data etc.)
 * @param {{label:string,url:string}} [o.cta]
 * @param {string} [o.code]           one-time code shown prominently
 * @param {string} [o.notice]         highlighted notice box text
 * @param {'success'|'danger'|'warning'|'info'} [o.tone]
 * @param {'transactional'|'security'|'marketing'} [o.category]
 * @param {string} [o.unsubscribeUrl]
 */
export function renderEmail(o) {
  const tone = toneColor[o.tone || 'info'];
  const paragraphs = (o.paragraphs || []).map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BRAND.text}">${e(p)}</p>`).join('');
  const code = o.code
    ? `<p style="margin:6px 0 18px;font-size:30px;font-weight:700;letter-spacing:8px;color:${BRAND.navyDark};font-family:Consolas,Menlo,monospace">${e(o.code)}</p>`
    : '';
  const notice = o.notice
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>
        <td style="background:#F7F3E6;border-left:4px solid ${BRAND.gold};padding:12px 14px;font-size:13px;line-height:1.5;color:${BRAND.text}">${e(o.notice)}</td></tr></table>`
    : '';
  const security = o.category === 'marketing' ? '' : `<p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.muted}">
    <strong>Security reminder:</strong> ACHIEVER will never ask for your password, PIN, OTP or banking credentials.</p>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${e(o.subject)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all">${e(o.preheader || o.title)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
${header()}
<tr><td style="padding:12px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${BRAND.border};border-radius:12px">
  <tr><td style="height:4px;background:${tone};border-radius:12px 12px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td style="padding:28px 28px 24px">
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${BRAND.navyDark}">${e(o.title)}</h1>
    ${o.name ? `<p style="margin:0 0 14px;font-size:15px;color:${BRAND.text}">Hello ${e(o.name)},</p>` : ''}
    ${paragraphs}${code}${detailsTable(o.details || [])}${notice}${button(o.cta)}${security}
  </td></tr></table>
</td></tr>
${footer({ category: o.category, unsubscribeUrl: o.unsubscribeUrl })}
</table></td></tr></table></body></html>`;

  const text = [
    `ACHIEVER — ${o.title}`,
    '',
    o.name ? `Hello ${o.name},` : null,
    ...(o.paragraphs || []),
    o.code ? `\nCode: ${o.code}\n` : null,
    ...(o.details || []).filter((d) => d && d[1] !== undefined && d[1] !== null && d[1] !== '').map(([l, v]) => `${l}: ${v}`),
    o.notice ? `\n${o.notice}` : null,
    o.cta ? `\n${o.cta.label}: ${o.cta.url}` : null,
    o.category === 'marketing' ? null : '\nACHIEVER will never ask for your password, PIN, OTP or banking credentials.',
    `\nSupport: ${siteUrl('/support.html')} · Privacy: ${siteUrl('/privacy.html')} · Terms: ${siteUrl('/terms.html')}`,
    o.unsubscribeUrl ? `Unsubscribe: ${o.unsubscribeUrl}` : null,
  ].filter((l) => l !== null).join('\n');

  return { subject: o.subject, html, text };
}

export const formatters = {
  naira(kobo) {
    if (kobo === null || kobo === undefined) return undefined;
    return `₦${(Number(kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },
  date(value) {
    if (!value) return undefined;
    return new Intl.DateTimeFormat('en-NG', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(value));
  },
  day(value) {
    if (!value) return undefined;
    return new Intl.DateTimeFormat('en-NG', { dateStyle: 'long', timeZone: 'Africa/Lagos' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`));
  },
};
