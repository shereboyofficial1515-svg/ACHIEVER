import { renderEmail } from '../layouts/baseEmail.js';
import { naira, txDetails, view, unauthorised } from '../shared/details.js';

export const payments = {
  contributionReceived: (ctx) => renderEmail({
    subject: `Contribution received${ctx.tx ? ` — ${naira(ctx.tx.amount)}` : ''}`,
    title: 'Payment successful',
    name: ctx.name,
    paragraphs: ['Your ACHIEVER contribution has been received and recorded.'],
    details: [
      ...txDetails(ctx.tx).slice(0, 1),
      ['Contribution', ctx.contribution ? `Osusu contribution — cycle ${ctx.contribution.cycle_number}` : 'Osusu contribution'],
      ['Group', ctx.group?.name],
      ...txDetails(ctx.tx).slice(1),
    ],
    notice: unauthorised,
    cta: view('View transaction', '/app/transactions'),
    tone: 'success',
  }),
  paymentFailed: (ctx) => renderEmail({
    subject: 'Your ACHIEVER payment was not completed',
    title: 'Payment not completed',
    name: ctx.name,
    paragraphs: [ctx.n.body, 'No money has been recorded against your contribution for this attempt. You can try again; please do not submit the same payment repeatedly while one is still processing.'],
    details: txDetails(ctx.tx),
    cta: view('View payments', '/app/transactions'),
    tone: 'danger',
  }),
  paymentPending: (ctx) => renderEmail({
    subject: 'Your ACHIEVER payment is being confirmed',
    title: 'Payment pending confirmation',
    name: ctx.name,
    paragraphs: [ctx.n.body, 'We only mark a payment as successful after the payment provider confirms it. You do not need to pay again.'],
    details: txDetails(ctx.tx),
    cta: view('Check status', '/app/transactions'),
    tone: 'warning',
  }),
  refund: (ctx) => renderEmail({
    subject: ctx.n.title,
    title: ctx.n.title,
    name: ctx.name,
    paragraphs: [ctx.n.body, 'Refunds are returned to the original payment method. Bank processing times vary.'],
    details: txDetails(ctx.tx),
    cta: view('View payments', '/app/transactions'),
    tone: 'info',
  }),
  billResult: (ctx) => renderEmail({
    subject: ctx.n.title,
    title: ctx.n.title,
    name: ctx.name,
    paragraphs: [ctx.n.body],
    cta: ctx.n.data?.bill_payment_id ? view('View receipt', `/app/bills/${ctx.n.data.bill_payment_id}`) : view('View bills', '/app/bills'),
    tone: ctx.n.type === 'bill_failed' ? 'danger' : 'success',
  }),
};
