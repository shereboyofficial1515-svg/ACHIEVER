-- =====================================================================
-- ACHIEVER — idempotency keys for money actions.
-- A client sends "Idempotency-Key: <uuid>" with a payment/payout request.
-- The first request is processed; a repeat with the same key (double tap,
-- network retry) gets the stored result instead of acting twice.
-- =====================================================================
create table public.idempotency_keys (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  idem_key        text not null check (idem_key ~ '^[A-Za-z0-9_-]{8,100}$'),
  request_hash    text not null,
  method          text not null,
  path            text not null,
  status          text not null default 'processing' check (status in ('processing','completed')),
  response_status int,
  response_body   jsonb,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  unique (user_id, idem_key)
);
create index idempotency_keys_created_idx on public.idempotency_keys (created_at);

alter table public.idempotency_keys enable row level security;
grant select, insert, update, delete on public.idempotency_keys to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.idempotency_keys from anon, authenticated;
