import { renderEmail } from '../layouts/baseEmail.js';
import { date, view } from '../shared/details.js';

export const security = {
  alert: (ctx) => renderEmail({
    subject: `ACHIEVER security alert: ${ctx.n.title}`,
    title: ctx.n.title,
    name: ctx.name,
    paragraphs: [ctx.n.body],
    details: [['Time', date(ctx.n.created_at)]],
    notice: 'If you do not recognise this activity, change your password, sign out other sessions and contact ACHIEVER Support.',
    cta: view('Review account security', '/app/settings/security'),
    category: 'security',
    tone: 'warning',
  }),
  accountNotice: (ctx) => renderEmail({
    subject: ctx.n.title,
    title: ctx.n.title,
    name: ctx.name,
    paragraphs: [ctx.n.body],
    cta: view('Open ACHIEVER', '/app'),
    category: 'security',
  }),
};
