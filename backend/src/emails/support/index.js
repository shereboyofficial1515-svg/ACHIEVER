import { renderEmail } from '../layouts/baseEmail.js';
import { view } from '../shared/details.js';

export const support = {
  ticketCreated: (ctx) => renderEmail({
    subject: `We received your case${ctx.n.data?.case_number ? ` ${ctx.n.data.case_number}` : ''}`,
    title: 'Support case opened',
    name: ctx.name,
    paragraphs: [ctx.n.body, 'Our team reviews cases in order of urgency. You can add details or evidence to the case at any time.'],
    cta: ctx.n.data?.ticket_id ? view('View case', `/app/support/${ctx.n.data.ticket_id}`) : view('Help & disputes', '/app/support'),
  }),
  ticketUpdated: (ctx) => renderEmail({
    subject: ctx.n.title,
    title: ctx.n.title,
    name: ctx.name,
    paragraphs: [ctx.n.body],
    cta: ctx.n.data?.ticket_id ? view('View case', `/app/support/${ctx.n.data.ticket_id}`) : view('Help & disputes', '/app/support'),
  }),
};
