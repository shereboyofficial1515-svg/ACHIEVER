import * as auth from '../../emails/auth/index.js';
import { renderEmail, siteUrl } from '../../emails/layouts/baseEmail.js';

/**
 * Compatibility facade over the branded template system in src/emails.
 * New code should import from src/emails (or use services/emailService.js).
 */
export const templates = {
  emailVerification: ({ name, code }) => auth.verifyEmail({ name, code }),
  passwordReset: ({ name, code, url }) => auth.resetPassword({ name, code, url }),
  welcome: ({ name }) => auth.welcome({ name }),

  invite: ({ inviterName, contextName, url, kind }) => renderEmail({
    subject: kind === 'osusu_group' ? `You're invited to join ${contextName} on ACHIEVER` : `${inviterName} invited you to save with them on ACHIEVER`,
    title: kind === 'osusu_group' ? `Join ${contextName}` : `Savings invitation from ${contextName}`,
    paragraphs: [
      kind === 'osusu_group'
        ? `${inviterName} invited you to an Osusu group on ACHIEVER. Review the contribution amount, schedule and payout order before you accept.`
        : `${inviterName} invited you to a savings plan on ACHIEVER. Review the savings period and the collector's commission before you accept.`,
      'Only accept invitations from people you know and trust.',
    ],
    cta: { label: 'Review invitation', url },
    category: 'transactional',
  }),

  /** Security notice built from a short, specific event description. */
  securityAlert: ({ name, event }) => renderEmail({
    subject: 'ACHIEVER security alert',
    title: 'Security alert',
    name,
    paragraphs: [event],
    notice: 'If this was not you, reset your password immediately and contact ACHIEVER Support.',
    cta: { label: 'Review account security', url: siteUrl('/app/settings/security') },
    category: 'security',
    tone: 'warning',
  }),

  notification: ({ name, title, body, url }) => renderEmail({
    subject: title,
    title,
    name,
    paragraphs: [body],
    cta: url ? { label: 'View in ACHIEVER', url } : undefined,
  }),
};
