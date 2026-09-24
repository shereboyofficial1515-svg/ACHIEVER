/** Shared helpers for notification emails (values always come from real records). */
import { siteUrl, formatters } from '../layouts/baseEmail.js';

export const { naira, date, day } = formatters;
export const txDetails = (tx) => (tx ? [
  ['Amount', naira(tx.amount)],
  ['Transaction ID', tx.reference],
  ['Payment reference', tx.provider_reference && tx.provider_reference !== tx.reference ? tx.provider_reference : undefined],
  ['Payment method', tx.channel ? tx.channel.replace(/_/g, ' ') : undefined],
  ['Date', date(tx.completed_at || tx.created_at)],
  ['Status', tx.status === 'success' ? 'Successful' : tx.status],
] : []);
export const view = (label, path) => ({ label, url: siteUrl(path) });
export const groupLink = (ctx) => (ctx.group ? `/app/osusu/${ctx.group.id}` : '/app/osusu');
export const planLink = (ctx) => (ctx.plan ? `/app/collector/plans/${ctx.plan.id}` : '/app/savings');
export const unauthorised = 'If you did not authorise this transaction, contact ACHIEVER Support immediately.';

