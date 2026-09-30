-- =====================================================================
-- ACHIEVER — bill provider controls for the Admin Platform.
--   * per-provider maintenance mode (with a message shown to members)
--   * per-provider health figures from real transactions and responses
-- Additive only.
-- =====================================================================
alter table public.bill_services
  add column maintenance         boolean not null default false,
  add column maintenance_message text check (char_length(maintenance_message) <= 200),
  add column changed_at          timestamptz;

-- Last success / failure / provider reply per service (admin monitoring).
create or replace function public.bill_service_stats() returns table (
  service_id text, last_success_at timestamptz, last_failure_at timestamptz,
  successes_24h bigint, failures_24h bigint, pending_now bigint,
  last_response_code text, last_response_status text, last_response_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with b as (
    select service_id,
           max(completed_at) filter (where status in ('delivered','reversed')) as last_success_at,
           max(coalesce(completed_at, updated_at)) filter (where status in ('refund_pending','refunded','failed')) as last_failure_at,
           count(*) filter (where status = 'delivered' and completed_at > now() - interval '24 hours') as successes_24h,
           count(*) filter (where status in ('refund_pending','refunded','failed') and updated_at > now() - interval '24 hours') as failures_24h,
           count(*) filter (where status in ('paid','processing')) as pending_now
      from bill_payments group by service_id
  ), r as (
    select distinct on (p.service_id) p.service_id, x.code, x.status, x.created_at
      from bill_provider_responses x join bill_payments p on p.id = x.bill_id
     order by p.service_id, x.id desc
  )
  select s.service_id, b.last_success_at, b.last_failure_at, coalesce(b.successes_24h, 0), coalesce(b.failures_24h, 0),
         coalesce(b.pending_now, 0), r.code, r.status, r.created_at
    from bill_services s left join b on b.service_id = s.service_id left join r on r.service_id = s.service_id
$$;

revoke execute on function public.bill_service_stats() from public, anon, authenticated;
grant execute on function public.bill_service_stats() to service_role;
