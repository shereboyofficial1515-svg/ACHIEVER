import { renderEmail } from '../layouts/baseEmail.js';
import { naira, date, day, view, groupLink } from '../shared/details.js';

export const osusu = {
  contributionReminder: (ctx) => renderEmail({
    subject: ctx.n.title,
    title: 'Contribution reminder',
    name: ctx.name,
    paragraphs: [ctx.n.body],
    details: [
      ['Group', ctx.group?.name],
      ['Amount due', naira(ctx.contribution?.amount)],
      ['Cycle', ctx.contribution?.cycle_number],
      ['Due date', day(ctx.contribution?.due_date)],
    ],
    cta: view('Pay contribution', groupLink(ctx)),
    tone: 'info',
  }),
  contributionOverdue: (ctx) => renderEmail({
    subject: ctx.n.title,
    title: 'Contribution overdue',
    name: ctx.name,
    paragraphs: [ctx.n.body, 'Every member keeps contributing until the rotation ends, including after receiving their payout, so the group can pay everyone in turn.'],
    details: [
      ['Group', ctx.group?.name],
      ['Amount due', naira(ctx.contribution?.amount)],
      ['Cycle', ctx.contribution?.cycle_number],
      ['Was due', day(ctx.contribution?.due_date)],
    ],
    cta: view('Pay now', groupLink(ctx)),
    tone: 'danger',
  }),
  payoutNotification: (ctx) => renderEmail({
    subject: ctx.n.title,
    title: ctx.n.type === 'osusu_payout_paid' ? 'Payout sent' : ctx.n.title,
    name: ctx.name,
    paragraphs: [ctx.n.body],
    details: [
      ['Group', ctx.group?.name],
      ['Amount', naira(ctx.payout?.amount ?? ctx.tx?.amount)],
      ['Cycle', ctx.payout?.raw?.cycle_number],
      ['Payout reference', ctx.payout?.reference],
      ['Sent to', ctx.payout?.destination ? `${ctx.payout.destination.bankName || 'Bank'} •••• ${ctx.payout.destination.last4}` : undefined],
      ['Date', date(ctx.tx?.completed_at)],
    ],
    cta: view('View group', groupLink(ctx)),
    tone: 'success',
  }),
  groupUpdate: (ctx) => renderEmail({
    subject: ctx.n.title,
    title: ctx.n.title,
    name: ctx.name,
    paragraphs: [ctx.n.body],
    details: [['Group', ctx.group?.name]],
    cta: view('Open group', groupLink(ctx)),
  }),
};
