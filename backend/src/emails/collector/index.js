import { renderEmail } from '../layouts/baseEmail.js';
import { naira, day, txDetails, view, planLink, unauthorised } from '../shared/details.js';

export const collector = {
  savingsReceived: (ctx) => renderEmail({
    subject: `Savings received${ctx.tx ? ` — ${naira(ctx.tx.amount)}` : ''}`,
    title: ctx.n.type === 'collector_savings_received' ? 'Saver contribution received' : 'Savings payment successful',
    name: ctx.name,
    paragraphs: [ctx.n.body],
    details: [['Plan', ctx.plan?.plan_name], ...txDetails(ctx.tx)],
    notice: ctx.n.type === 'collector_savings_paid' ? unauthorised : undefined,
    cta: view('View plan', planLink(ctx)),
    tone: 'success',
  }),
  maturityNotification: (ctx) => renderEmail({
    subject: ctx.n.title,
    title: 'Savings plan matured',
    name: ctx.name,
    paragraphs: [ctx.n.body, 'The saver can now request their return. The collector’s agreed commission is deducted when the return is settled.'],
    details: [['Plan', ctx.plan?.plan_name], ['Balance', naira(ctx.plan?.balance)], ['End date', day(ctx.plan?.end_date)]],
    cta: view('View plan', planLink(ctx)),
    tone: 'info',
  }),
  settlementNotification: (ctx) => renderEmail({
    subject: ctx.n.title,
    title: ctx.n.title,
    name: ctx.name,
    paragraphs: [ctx.n.body],
    details: [
      ['Plan', ctx.plan?.plan_name],
      ['Gross amount', naira(ctx.ret?.gross_amount)],
      ['Commission', naira(ctx.ret?.commission_amount)],
      ['Net amount', naira(ctx.ret?.net_amount)],
      ['Reference', ctx.ret?.return_reference],
      ...txDetails(ctx.tx).slice(1, 2),
    ],
    cta: view('View plan', planLink(ctx)),
    tone: ctx.n.type === 'disbursement_failed' ? 'danger' : 'success',
  }),
};
