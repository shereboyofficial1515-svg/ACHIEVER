-- =====================================================================
-- ACHIEVER — bill revenue accounting.
-- VTpass reports, per transaction, what it debited from the ACHIEVER VTpass
-- wallet (provider cost) and the commission it earned us. These are stored
-- as returned (never a hard-coded percentage), so revenue is traceable.
--
--   customer_amount = total_amount (what the member paid)
--   provider_cost   = what VTpass debited
--   commission      = VTpass commission on the transaction
--   achiever fee    = fee
--   net_revenue     = fee + commission (for delivered, not reversed/refunded)
-- =====================================================================
alter table public.bill_payments
  add column commission_amount bigint check (commission_amount is null or commission_amount >= 0),
  add column commission_rate   numeric(7,4) check (commission_rate is null or commission_rate between 0 and 100),
  add column net_revenue       bigint generated always as (fee + coalesce(commission_amount, 0)) stored;

create or replace function public.bill_revenue_summary(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  with b as (
    select * from bill_payments
     where coalesce(completed_at, created_at) >= coalesce(p_from, '-infinity'::timestamptz)
       and coalesce(completed_at, created_at) <  coalesce(p_to, 'infinity'::timestamptz)
  )
  select jsonb_build_object(
    'delivered_count',   (select count(*) from b where status = 'delivered'),
    'bill_revenue',      (select coalesce(sum(total_amount), 0) from b where status = 'delivered'),
    'provider_cost',     (select coalesce(sum(provider_cost), 0) from b where status = 'delivered'),
    'vtpass_commission', (select coalesce(sum(commission_amount), 0) from b where status = 'delivered'),
    'achiever_fees',     (select coalesce(sum(fee), 0) from b where status = 'delivered'),
    'gross_revenue',     (select coalesce(sum(net_revenue), 0) from b where status = 'delivered'),
    'refunds',           (select coalesce(sum(total_amount), 0) from b where status in ('refund_pending','refunded')),
    'refund_count',      (select count(*) from b where status in ('refund_pending','refunded')),
    'reversals',         (select coalesce(sum(total_amount), 0) from b where status = 'reversed' or (status = 'refunded' and reversed_at is not null)),
    'reversal_count',    (select count(*) from b where reversed_at is not null),
    'net_revenue',       (select coalesce(sum(net_revenue), 0) from b where status = 'delivered'),
    'by_category',       (select coalesce(jsonb_object_agg(category, x), '{}'::jsonb) from (
                            select category, jsonb_build_object('count', count(*), 'revenue', sum(total_amount),
                                   'commission', coalesce(sum(commission_amount), 0), 'fees', sum(fee)) as x
                              from b where status = 'delivered' group by category) c)
  )
$$;

revoke execute on function public.bill_revenue_summary(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.bill_revenue_summary(timestamptz, timestamptz) to service_role;
