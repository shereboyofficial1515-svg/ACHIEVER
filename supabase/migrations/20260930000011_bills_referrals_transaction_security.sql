-- =====================================================================
-- ACHIEVER — Bills & Services (VTpass), transaction security, biometric
-- device keys, push notifications and the referral programme.
--
-- Additive only: existing tables gain columns/constraints; nothing is dropped.
-- Money rules stay in SECURITY DEFINER functions; the browser roles can read
-- their own rows (RLS) and write nothing here.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Settings: new categories
-- ---------------------------------------------------------------------
alter table public.app_settings drop constraint if exists app_settings_category_check;
alter table public.app_settings add constraint app_settings_category_check check (category in (
  'authentication','verification','sms','email','payments','notifications','security','maintenance',
  'support','registration','kyc','collector_onboarding','transaction_limits','admin','general','bills','referrals'));

-- ---------------------------------------------------------------------
-- 1. Bill payments: more categories, fees, authorisation, protected secrets
-- ---------------------------------------------------------------------
alter table public.bill_payments drop constraint if exists bill_payments_category_check;
alter table public.bill_payments add constraint bill_payments_category_check
  check (category in ('airtime','data','electricity','tv','education','betting','recharge_pin','other'));

alter table public.bill_payments drop constraint if exists bill_payments_status_check;
alter table public.bill_payments add constraint bill_payments_status_check check (status in (
  'awaiting_authorization','awaiting_payment','paid','processing','delivered','failed',
  'reversed','refund_pending','refunded','cancelled'));

alter table public.bill_payments
  add column fee                     bigint not null default 0 check (fee >= 0 and fee <= 1000000),
  add column total_amount            bigint generated always as (amount + fee) stored,
  add column provider_cost           bigint check (provider_cost is null or provider_cost >= 0),
  add column service_name            text check (char_length(service_name) <= 120),
  add column subscription_type       text check (subscription_type in ('change','renew')),
  add column quantity                int not null default 1 check (quantity between 1 and 10),
  add column provider_transaction_id text,
  -- Masked customer details returned by the biller's verification (never full addresses/numbers).
  add column verified_customer       jsonb not null default '{}'::jsonb,
  -- Electricity tokens / exam PINs, encrypted by the API (AES-256-GCM); never stored in plain text.
  add column secure_payload          text,
  add column auth_method             text check (auth_method in ('email_otp','device_biometric')),
  add column auth_challenge_id       uuid,
  add column authorized_at           timestamptz,
  add column quote_expires_at        timestamptz,
  add column idempotency_key         text check (idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
  add column reversed_at             timestamptz,
  add column last_provider_code      text check (char_length(last_provider_code) <= 10);

create unique index bill_payments_idem_idx on public.bill_payments (user_id, idempotency_key) where idempotency_key is not null;
create index bill_payments_provider_ref_idx on public.bill_payments (provider_reference) where provider_reference is not null;
create index bill_payments_provider_tx_idx on public.bill_payments (provider_transaction_id) where provider_transaction_id is not null;
create index bill_payments_created_idx on public.bill_payments (created_at desc);
create index bill_payments_quote_idx on public.bill_payments (quote_expires_at) where status = 'awaiting_authorization';

-- Bills are never deleted, and their money/identity fields never change once
-- created. Status moves only forward; corrections are new records (refunds).
create or replace function public.guard_bill_update() returns trigger
language plpgsql as $$
declare
  allowed text[];
begin
  if tg_op = 'DELETE' then
    raise exception 'ACH:409:BILL_IMMUTABLE:Bill payments cannot be deleted';
  end if;
  if new.reference <> old.reference or new.user_id <> old.user_id or new.amount <> old.amount or new.fee <> old.fee
     or new.category <> old.category or new.service_id <> old.service_id
     or new.customer_identifier <> old.customer_identifier or new.phone <> old.phone
     or new.variation_code is distinct from old.variation_code or new.quantity <> old.quantity
     or new.provider_request_id is distinct from old.provider_request_id
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at <> old.created_at then
    raise exception 'ACH:409:BILL_IMMUTABLE:Bill payment details cannot be changed';
  end if;
  if old.provider_reference is not null and new.provider_reference is distinct from old.provider_reference then
    raise exception 'ACH:409:BILL_IMMUTABLE:Provider reference cannot be changed once recorded';
  end if;
  if old.provider_transaction_id is not null and new.provider_transaction_id is distinct from old.provider_transaction_id then
    raise exception 'ACH:409:BILL_IMMUTABLE:Provider transaction ID cannot be changed once recorded';
  end if;
  if new.status <> old.status then
    allowed := case old.status
      when 'awaiting_authorization' then array['awaiting_payment','cancelled']
      when 'awaiting_payment'       then array['paid','cancelled']
      when 'paid'                   then array['processing','delivered','refund_pending']
      when 'processing'             then array['delivered','refund_pending']
      when 'delivered'              then array['reversed']
      when 'reversed'               then array['refunded']
      when 'refund_pending'         then array['refunded']
      else array[]::text[] end;
    if not new.status = any(allowed) then
      raise exception 'ACH:409:BILL_STATUS_FINAL:Bill payment cannot move from % to %', old.status, new.status;
    end if;
  end if;
  return new;
end $$;
create trigger bill_payments_guard before update or delete on public.bill_payments
  for each row execute function public.guard_bill_update();

-- Status history (append-only). The source (api / webhook / requery / job /
-- admin) is set per transaction with: set_config('achiever.bill_source', ...).
create table public.bill_transaction_events (
  id            bigint generated always as identity primary key,
  bill_id       uuid not null references public.bill_payments(id),
  from_status   text,
  to_status     text not null,
  source        text not null default 'system',
  provider_code text,
  note          text check (char_length(note) <= 300),
  created_at    timestamptz not null default now()
);
create index bill_transaction_events_bill_idx on public.bill_transaction_events (bill_id, id);
create trigger bill_transaction_events_append_only before update or delete on public.bill_transaction_events
  for each row execute function public.forbid_mutation();

create or replace function public.log_bill_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status <> old.status then
    insert into bill_transaction_events (bill_id, from_status, to_status, source, provider_code, note)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
            coalesce(nullif(current_setting('achiever.bill_source', true), ''), 'system'),
            new.last_provider_code, left(new.last_error, 300));
  end if;
  return new;
end $$;
create trigger bill_payments_status_log after insert or update of status on public.bill_payments
  for each row execute function public.log_bill_status();

-- Redacted provider responses (tokens, PINs and purchased codes removed by the API).
create table public.bill_provider_responses (
  id          bigint generated always as identity primary key,
  bill_id     uuid references public.bill_payments(id),
  kind        text not null check (kind in ('purchase','requery','webhook','verify')),
  http_status int,
  code        text check (char_length(code) <= 10),
  status      text check (char_length(status) <= 40),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index bill_provider_responses_bill_idx on public.bill_provider_responses (bill_id, id);
create trigger bill_provider_responses_append_only before update or delete on public.bill_provider_responses
  for each row execute function public.forbid_mutation();

-- Reconciliation: our status vs the provider's, per check.
create table public.bill_reconciliation (
  id              bigint generated always as identity primary key,
  bill_id         uuid not null references public.bill_payments(id),
  local_status    text not null,
  provider_status text,
  outcome         text not null check (outcome in ('matched','updated','mismatch','unresolved')),
  note            text check (char_length(note) <= 500),
  resolved_by     uuid references public.profiles(id),
  resolved_at     timestamptz,
  resolution_note text check (char_length(resolution_note) <= 1000),
  created_at      timestamptz not null default now()
);
create index bill_reconciliation_open_idx on public.bill_reconciliation (created_at desc) where outcome in ('mismatch','unresolved') and resolved_at is null;
create index bill_reconciliation_bill_idx on public.bill_reconciliation (bill_id);

create or replace function public.guard_reconciliation_update() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or new.bill_id <> old.bill_id or new.local_status <> old.local_status
     or new.provider_status is distinct from old.provider_status or new.outcome <> old.outcome
     or new.created_at <> old.created_at or old.resolved_at is not null then
    raise exception 'ACH:409:APPEND_ONLY:Reconciliation records can only be resolved once';
  end if;
  return new;
end $$;
create trigger bill_reconciliation_guard before update or delete on public.bill_reconciliation
  for each row execute function public.guard_reconciliation_update();

-- Cached provider catalogue (refreshed by the API; admins can switch services off).
create table public.bill_services (
  service_id     text primary key check (service_id ~ '^[a-z0-9-]{2,60}$'),
  provider       text not null default 'vtpass',
  category       text not null check (category in ('airtime','data','electricity','tv','education','betting','recharge_pin','other')),
  name           text not null,
  min_amount     bigint,
  max_amount     bigint,
  product_type   text,
  image_url      text,
  available      boolean not null default true,   -- still offered by the provider
  enabled        boolean not null default true,   -- ACHIEVER admin switch
  disabled_reason text,
  refreshed_at   timestamptz not null default now()
);
create index bill_services_category_idx on public.bill_services (category, enabled, available);

create table public.bill_products (
  service_id     text not null references public.bill_services(service_id) on delete cascade,
  variation_code text not null check (char_length(variation_code) <= 120),
  name           text not null,
  amount         bigint not null check (amount >= 0),
  fixed_price    boolean not null default true,
  available      boolean not null default true,
  refreshed_at   timestamptz not null default now(),
  primary key (service_id, variation_code)
);

-- Provider health now covers VTpass and push delivery.
alter table public.provider_health drop constraint if exists provider_health_provider_check;
alter table public.provider_health add constraint provider_health_provider_check check (provider in ('termii','resend','vtpass','fcm'));
alter table public.provider_health
  add column last_transaction_at timestamptz,
  add column last_webhook_at     timestamptz,
  add column last_requery_at     timestamptz;
insert into public.provider_health (provider) values ('vtpass'), ('fcm') on conflict do nothing;

-- Bill paid through Paystack: the checkout amount is the total (amount + fee).
create or replace function public._apply_bill_payment(a payment_attempts, p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b    bill_payments%rowtype;
  v_tx uuid;
  v_ref uuid;
begin
  select * into b from bill_payments where id = a.target_id for update;
  if not found or b.status <> 'awaiting_payment' or b.user_id <> a.user_id or b.total_amount <> a.amount then
    v_ref := _create_refund_tx(a.user_id, a.amount, a.reference, 'bill_not_payable', null, null, a.target_id);
    return jsonb_build_object('outcome', 'duplicate', 'refund_transaction_id', v_ref);
  end if;
  insert into transactions (reference, user_id, bill_payment_id, type, direction, amount, provider, provider_reference,
                            status, description, metadata)
  values (new_reference('ACH-TX'), a.user_id, b.id, 'bill_payment', 'debit', b.total_amount, 'paystack', a.reference,
          'processing', coalesce(b.service_name, initcap(b.category)) || ' purchase',
          jsonb_build_object('bill_payment_id', b.id, 'service_id', b.service_id, 'fee', b.fee))
  returning id into v_tx;
  perform set_config('achiever.bill_source', 'payment', true);
  update bill_payments set status = 'paid', payment_reference = a.reference, transaction_id = v_tx where id = b.id;
  perform audit_event(a.user_id, 'bill.paid', 'bill_payment', b.id::text, 'success', jsonb_build_object('reference', a.reference));
  return jsonb_build_object('outcome', 'applied', 'transaction_id', v_tx, 'bill_payment_id', b.id);
end $$;

-- Provider outcome. Notification text never includes tokens, PINs or
-- customer numbers (they are shown only inside the app, on the receipt).
drop function if exists public.record_bill_result(uuid, text, text, text, text, text, int);
create or replace function public.record_bill_result(
  p_bill_id uuid, p_outcome text, p_provider_reference text, p_secure_payload text, p_units text,
  p_error text, p_retry_in_seconds int default 300, p_source text default 'api',
  p_provider_transaction_id text default null, p_provider_code text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b     bill_payments%rowtype;
  v_ref uuid;
begin
  if p_outcome not in ('delivered','failed','processing') then perform app_error(400, 'INVALID_OUTCOME', 'Invalid outcome'); end if;
  perform set_config('achiever.bill_source', coalesce(p_source, 'api'), true);
  select * into b from bill_payments where id = p_bill_id for update;
  if not found then perform app_error(404, 'BILL_NOT_FOUND', 'Bill payment not found'); end if;
  if b.status in ('delivered','refund_pending','refunded','failed','reversed','cancelled') then
    return jsonb_build_object('outcome', 'already_final', 'status', b.status);
  end if;
  if b.status not in ('paid','processing') then perform app_error(409, 'BILL_NOT_PAID', 'Bill has not been paid'); end if;

  if p_outcome = 'delivered' then
    update bill_payments set status = 'delivered',
           provider_reference = coalesce(provider_reference, p_provider_reference),
           provider_transaction_id = coalesce(provider_transaction_id, p_provider_transaction_id),
           secure_payload = coalesce(p_secure_payload, secure_payload), units = p_units,
           last_provider_code = p_provider_code, completed_at = now(), last_error = null, next_retry_at = null,
           attempts = attempts + 1
     where id = b.id;
    update transactions set status = 'success', completed_at = now(),
           metadata = metadata || jsonb_build_object('provider_reference', p_provider_reference)
     where id = b.transaction_id;
    perform enqueue_notification(b.user_id, 'bill_delivered', 'payments', 'Purchase successful',
      format('Your %s purchase of %s was successful. Open ACHIEVER to view your receipt.',
             coalesce(b.service_name, b.category), fmt_naira(b.amount)),
      jsonb_build_object('bill_payment_id', b.id), 'bill_done:' || b.id);
    perform audit_event(b.user_id, 'bill.delivered', 'bill_payment', b.id::text, 'success',
      jsonb_build_object('provider_reference', p_provider_reference, 'source', p_source));
    return jsonb_build_object('outcome', 'delivered');
  elsif p_outcome = 'failed' then
    update transactions set status = 'failed', completed_at = now() where id = b.transaction_id;
    v_ref := _create_refund_tx(b.user_id, b.total_amount, b.payment_reference, 'bill_failed', null, null, b.id);
    update bill_payments set status = 'refund_pending', last_error = left(p_error, 300), last_provider_code = p_provider_code,
           provider_reference = coalesce(provider_reference, p_provider_reference),
           provider_transaction_id = coalesce(provider_transaction_id, p_provider_transaction_id),
           completed_at = now(), attempts = attempts + 1, next_retry_at = null
     where id = b.id;
    perform enqueue_notification(b.user_id, 'bill_failed', 'payments', 'Purchase not completed',
      'Your purchase could not be completed. A refund has been started. Open ACHIEVER for details.',
      jsonb_build_object('bill_payment_id', b.id), 'bill_failed:' || b.id);
    perform audit_event(b.user_id, 'bill.failed', 'bill_payment', b.id::text, 'failure',
      jsonb_build_object('error', left(p_error, 200), 'source', p_source));
    return jsonb_build_object('outcome', 'failed', 'refund_transaction_id', v_ref, 'payment_reference', b.payment_reference);
  else
    update bill_payments set status = 'processing', last_error = left(p_error, 300), last_provider_code = p_provider_code,
           attempts = attempts + 1,
           provider_reference = coalesce(provider_reference, p_provider_reference),
           provider_transaction_id = coalesce(provider_transaction_id, p_provider_transaction_id),
           next_retry_at = now() + make_interval(secs => greatest(30, p_retry_in_seconds))
     where id = b.id;
    if b.attempts = 0 then
      perform enqueue_notification(b.user_id, 'bill_pending', 'payments', 'Purchase being processed',
        'Your transaction is being processed. We will update you when the provider confirms it.',
        jsonb_build_object('bill_payment_id', b.id), 'bill_pending:' || b.id);
    end if;
    return jsonb_build_object('outcome', 'processing');
  end if;
end $$;

-- A provider reversal after delivery: the ledger entry is reversed (never
-- edited away) and a refund record is created.
create or replace function public.record_bill_reversal(p_bill_id uuid, p_reason text, p_source text default 'webhook',
  p_provider_code text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b     bill_payments%rowtype;
  v_ref uuid;
begin
  perform set_config('achiever.bill_source', coalesce(p_source, 'webhook'), true);
  select * into b from bill_payments where id = p_bill_id for update;
  if not found then perform app_error(404, 'BILL_NOT_FOUND', 'Bill payment not found'); end if;
  if b.status in ('reversed','refunded','refund_pending') then
    return jsonb_build_object('outcome', 'already_final', 'status', b.status);
  end if;
  if b.status in ('paid','processing') then
    -- Reversed before we saw a delivery: treat as a failed purchase (refund).
    return record_bill_result(p_bill_id, 'failed', null, null, null, coalesce(p_reason, 'Reversed by provider'), 300, p_source, null, p_provider_code);
  end if;
  if b.status <> 'delivered' then perform app_error(409, 'BILL_NOT_REVERSIBLE', 'Only a completed purchase can be reversed'); end if;

  update transactions set status = 'reversed', completed_at = now() where id = b.transaction_id and status = 'success';
  v_ref := _create_refund_tx(b.user_id, b.total_amount, b.payment_reference, 'bill_reversed', null, null, b.id);
  update bill_payments set status = 'reversed', reversed_at = now(), last_error = left(coalesce(p_reason, 'Reversed by provider'), 300),
         last_provider_code = p_provider_code
   where id = b.id;
  perform enqueue_notification(b.user_id, 'bill_reversed', 'payments', 'Transaction reversed',
    'A purchase was reversed by the provider. A refund has been started. Open ACHIEVER for details.',
    jsonb_build_object('bill_payment_id', b.id), 'bill_reversed:' || b.id);
  perform audit_event(b.user_id, 'bill.reversed', 'bill_payment', b.id::text, 'success',
    jsonb_build_object('reason', left(p_reason, 200), 'source', p_source));
  return jsonb_build_object('outcome', 'reversed', 'refund_transaction_id', v_ref, 'payment_reference', b.payment_reference);
end $$;

-- Refund completion also closes reversed bills.
create or replace function public.set_refund_status(p_transaction_id uuid, p_status text, p_provider_reference text)
returns void
language plpgsql security definer set search_path = public as $$
declare t transactions%rowtype;
begin
  select * into t from transactions where id = p_transaction_id and type = 'refund' for update;
  if not found then perform app_error(404, 'REFUND_NOT_FOUND', 'Refund not found'); end if;
  if t.status in ('success','failed') then return; end if;
  update transactions set status = p_status, provider_reference = coalesce(p_provider_reference, provider_reference),
         completed_at = case when p_status in ('success','failed') then now() else completed_at end
   where id = t.id;
  if p_status = 'success' then
    if t.bill_payment_id is not null then
      perform set_config('achiever.bill_source', 'refund', true);
      update bill_payments set status = 'refunded' where id = t.bill_payment_id and status in ('refund_pending','reversed');
    end if;
    perform enqueue_notification(t.user_id, 'refund_completed', 'payments', 'Refund processed',
      format('Your refund of %s has been processed.', fmt_naira(t.amount)),
      jsonb_build_object('transaction_id', t.id), 'refund_done:' || t.id);
  end if;
  perform audit_event(null, 'refund.status', 'transaction', t.id::text,
    case when p_status = 'failed' then 'failure' else 'success' end, jsonb_build_object('status', p_status));
end $$;

-- ---------------------------------------------------------------------
-- 2. Transaction PIN, authorisation challenges, device (biometric) keys
-- ---------------------------------------------------------------------
create table public.transaction_credentials (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  pin_hash        text not null check (pin_hash like 'scrypt$%'),
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  changed_at      timestamptz not null default now()
);

create table public.biometric_device_keys (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  public_key     text not null check (char_length(public_key) between 80 and 600),
  algorithm      text not null default 'ES256' check (algorithm = 'ES256'),
  label          text not null check (char_length(label) <= 120),
  platform       text not null default 'android' check (platform in ('android')),
  allow_login    boolean not null default true,
  allow_transactions boolean not null default true,
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  revoked_reason text check (char_length(revoked_reason) <= 200)
);
create index biometric_device_keys_user_idx on public.biometric_device_keys (user_id) where revoked_at is null;

create table public.transaction_auth_challenges (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  purpose       text not null check (purpose in ('bill_payment')),
  target_id     uuid not null,
  target_hash   text not null,          -- binds the challenge to the exact amount/recipient reviewed
  method        text not null check (method in ('email_otp','device_biometric')),
  code_hash     text,
  nonce         text,
  device_key_id uuid references public.biometric_device_keys(id),
  destination_masked text,
  attempts      int not null default 0,
  max_attempts  int not null default 5 check (max_attempts between 1 and 10),
  session_id    uuid references public.user_sessions(id),
  ip_address    inet,
  expires_at    timestamptz not null,
  verified_at   timestamptz,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now(),
  check ((method = 'email_otp' and code_hash is not null) or (method = 'device_biometric' and nonce is not null and device_key_id is not null)),
  check (consumed_at is null or verified_at is not null)
);
create index transaction_auth_challenges_user_idx on public.transaction_auth_challenges (user_id, created_at desc);
create index transaction_auth_challenges_target_idx on public.transaction_auth_challenges (target_id);

create table public.device_login_challenges (
  id          uuid primary key default gen_random_uuid(),
  key_id      uuid not null references public.biometric_device_keys(id) on delete cascade,
  nonce       text not null,
  ip_address  inet,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index device_login_challenges_key_idx on public.device_login_challenges (key_id, created_at desc);

create table public.transaction_security_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in (
                'transaction_pin_set','transaction_pin_changed','transaction_pin_failed','transaction_pin_locked',
                'biometric_enabled','biometric_disabled','biometric_key_invalidated',
                'auth_challenge_issued','auth_challenge_verified','auth_challenge_failed','transaction_authorized')),
  session_id  uuid references public.user_sessions(id),
  device_key_id uuid references public.biometric_device_keys(id),
  ip_address  inet,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index transaction_security_events_user_idx on public.transaction_security_events (user_id, created_at desc);
create trigger transaction_security_events_append_only before update or delete on public.transaction_security_events
  for each row execute function public.forbid_mutation();

alter table public.user_sessions drop constraint if exists user_sessions_auth_method_check;
alter table public.user_sessions add constraint user_sessions_auth_method_check
  check (auth_method in ('password','registration','password_reset','oauth_google','oauth_facebook','device_biometric'));

alter table public.security_challenges drop constraint if exists security_challenges_action_check;
alter table public.security_challenges add constraint security_challenges_action_check check (action in (
  'password_change','email_change','phone_change','payout_account_change','account_deletion','transaction_pin_change'));

-- ---------------------------------------------------------------------
-- 3. Push notifications
-- ---------------------------------------------------------------------
create table public.push_devices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  token_hash      text not null unique,        -- lookup / de-duplication
  token_encrypted text not null,               -- the FCM token, encrypted by the API
  platform        text not null check (platform in ('android')),
  app_version     text check (char_length(app_version) <= 40),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  disabled_at     timestamptz,
  disabled_reason text check (char_length(disabled_reason) <= 120)
);
create index push_devices_user_idx on public.push_devices (user_id) where disabled_at is null;

alter table public.notifications
  add column push_status   text not null default 'skipped' check (push_status in ('pending','sent','failed','skipped')),
  add column push_attempts int not null default 0;
create index notifications_push_outbox_idx on public.notifications (created_at) where push_status = 'pending';

alter table public.notifications drop constraint if exists notifications_category_check;
alter table public.notifications add constraint notifications_category_check check (category in (
  'security','payments','reminders','payouts','meetings','messages','account','system','groups','support','marketing','referrals'));

alter table public.notification_preferences add column push_enabled boolean not null default true;

-- New notifications go to push when the user has an active device and has not
-- switched push off (security notices always do).
create or replace function public.queue_push_for_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_prefs notification_preferences%rowtype;
  v_cat   jsonb;
begin
  if not exists (select 1 from push_devices where user_id = new.user_id and disabled_at is null) then return new; end if;
  select * into v_prefs from notification_preferences where user_id = new.user_id;
  if new.category = 'security' then
    new.push_status := 'pending';
  elsif coalesce(v_prefs.push_enabled, true) then
    v_cat := coalesce(v_prefs.category_settings -> new.category, '{}'::jsonb);
    if coalesce((v_cat ->> 'push')::boolean, true) then new.push_status := 'pending'; end if;
  end if;
  return new;
end $$;
create trigger notifications_queue_push before insert on public.notifications
  for each row execute function public.queue_push_for_notification();

-- ---------------------------------------------------------------------
-- 4. Osusu terms acceptance and default-charge disclosure
-- ---------------------------------------------------------------------
alter table public.osusu_groups add column default_charge_kobo bigint not null default 0 check (default_charge_kobo between 0 and 10000000);
alter table public.osusu_members
  add column terms_version     text,
  add column terms_accepted_at timestamptz;

-- ---------------------------------------------------------------------
-- 5. Referral programme
-- ---------------------------------------------------------------------
create table public.referral_codes (
  code        text primary key check (code ~ '^ACH-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$'),
  user_id     uuid not null unique references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text
);

create table public.referral_rewards (
  id                 uuid primary key default gen_random_uuid(),
  referrer_id        uuid not null references public.profiles(id),
  amount             bigint not null check (amount > 0),
  required_referrals int not null check (required_referrals > 0),
  status             text not null default 'ELIGIBLE' check (status in (
                       'ELIGIBLE','UNDER_REVIEW','APPROVED','REJECTED','PAID','REVERSED')),
  status_reason      text check (char_length(status_reason) <= 1000),
  reviewed_by        uuid references public.profiles(id),
  reviewed_at        timestamptz,
  approved_by        uuid references public.profiles(id),
  approved_at        timestamptz,
  approval_reason    text,
  rejected_by        uuid references public.profiles(id),
  rejected_at        timestamptz,
  payment_reference  text check (char_length(payment_reference) <= 120),
  paid_by            uuid references public.profiles(id),
  paid_at            timestamptz,
  reversed_by        uuid references public.profiles(id),
  reversed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index referral_rewards_referrer_idx on public.referral_rewards (referrer_id, created_at desc);
create index referral_rewards_status_idx on public.referral_rewards (status, created_at desc);
create trigger referral_rewards_updated_at before update on public.referral_rewards
  for each row execute function public.set_updated_at();

create table public.referrals (
  id                uuid primary key default gen_random_uuid(),
  referrer_id       uuid not null references public.profiles(id),
  referred_user_id  uuid not null unique references public.profiles(id),
  code              text not null references public.referral_codes(code),
  status            text not null default 'REGISTERED' check (status in ('REGISTERED','QUALIFYING','QUALIFIED','DISQUALIFIED')),
  status_reason     text check (char_length(status_reason) <= 300),
  flag_status       text check (flag_status in ('PENDING_REVIEW','SUSPICIOUS','UNDER_REVIEW','APPROVED','REJECTED')),
  flag_reasons      text[] not null default '{}',
  flag_decided_by   uuid references public.profiles(id),
  flag_decided_at   timestamptz,
  flag_decision_reason text,
  qualified_at      timestamptz,
  reward_id         uuid references public.referral_rewards(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (referrer_id <> referred_user_id)
);
create index referrals_referrer_idx on public.referrals (referrer_id, created_at desc);
create index referrals_status_idx on public.referrals (status, flag_status);
create index referrals_code_idx on public.referrals (code);
create trigger referrals_updated_at before update on public.referrals
  for each row execute function public.set_updated_at();

-- Who referred whom is permanent.
create or replace function public.guard_referral_update() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'ACH:409:REFERRAL_IMMUTABLE:Referrals cannot be deleted'; end if;
  if new.referrer_id <> old.referrer_id or new.referred_user_id <> old.referred_user_id or new.code <> old.code
     or new.created_at <> old.created_at then
    raise exception 'ACH:409:REFERRAL_IMMUTABLE:The referrer of an account cannot be changed';
  end if;
  if old.reward_id is not null and new.reward_id is distinct from old.reward_id then
    raise exception 'ACH:409:REFERRAL_IMMUTABLE:A referral already counted towards a reward cannot be moved';
  end if;
  return new;
end $$;
create trigger referrals_guard before update or delete on public.referrals
  for each row execute function public.guard_referral_update();

create table public.referral_qualifications (
  referral_id    uuid primary key references public.referrals(id),
  verified       boolean not null default false,
  osusu_met      boolean not null default false,
  days_elapsed   int not null default 0,
  activity_count int not null default 0,
  good_standing  boolean not null default true,
  checks         jsonb not null default '{}'::jsonb,
  evaluated_at   timestamptz not null default now()
);

create table public.referral_events (
  id           bigint generated always as identity primary key,
  referral_id  uuid references public.referrals(id),
  reward_id    uuid references public.referral_rewards(id),
  event        text not null,
  from_status  text,
  to_status    text,
  actor_id     uuid references public.profiles(id),
  reason       text check (char_length(reason) <= 1000),
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  check (referral_id is not null or reward_id is not null)
);
create index referral_events_referral_idx on public.referral_events (referral_id, id);
create index referral_events_reward_idx on public.referral_events (reward_id, id);
create trigger referral_events_append_only before update or delete on public.referral_events
  for each row execute function public.forbid_mutation();

-- Settings (configurable from the Admin Platform, audited there).
insert into public.app_settings (key, value, description, value_type, category, label, min_value, max_value, options, critical) values
  ('referral.enabled', 'true', 'Referral programme open for new referrals', 'boolean', 'referrals', 'Referral programme', null, null, null, true),
  ('referral.reward_amount_kobo', '1500000', 'Reward per completed batch of qualifying referrals (kobo)', 'integer', 'referrals', 'Reward amount (kobo)', 100, 100000000, null, true),
  ('referral.required_referrals', '6', 'Qualifying referred users needed for one reward', 'integer', 'referrals', 'Qualifying referrals per reward', 1, 100, null, true),
  ('referral.qualification_days', '21', 'Days a referred user must remain active before qualifying', 'integer', 'referrals', 'Qualification period (days)', 1, 365, null, true),
  ('referral.min_activity_count', '1', 'Qualifying activities a referred user must complete during the period', 'integer', 'referrals', 'Qualifying activities required', 1, 100, null, false),
  ('referral.qualifying_activities', '{"bill_payment":true,"osusu_contribution":true,"collector_savings":false}', 'Which completed activities count', 'object', 'referrals', 'Qualifying activities', null, null, null, true),
  ('referral.require_osusu', 'true', 'Referred users must be active members of an Osusu group', 'boolean', 'referrals', 'Osusu membership required', null, null, null, true),
  ('referral.verification_level', '1', 'Minimum verification level of referred users (0 = verified email, 1 = basic profile and contact verified)', 'integer', 'referrals', 'Verification level required', 0, 3, null, true),
  ('referral.review_required', 'true', 'Every reward is reviewed by an administrator before approval', 'boolean', 'referrals', 'Manual reward review', null, null, null, true),
  ('bills.enabled', 'true', 'Allow new bill purchases (the provider must also be configured)', 'boolean', 'bills', 'Bill payments', null, null, null, true),
  ('bills.maintenance_mode', 'false', 'Pause new bill purchases while the provider is under maintenance', 'boolean', 'bills', 'Bill provider maintenance', null, null, null, true),
  ('bills.categories_enabled', '{"airtime":true,"data":true,"electricity":true,"tv":true,"education":true,"betting":true,"recharge_pin":true}', 'Per-category switch', 'object', 'bills', 'Bill categories', null, null, null, true),
  ('bills.fee_kobo', '{"airtime":0,"data":0,"electricity":0,"tv":0,"education":0,"betting":0,"recharge_pin":0}', 'ACHIEVER fee per category (kobo)', 'object', 'bills', 'Bill fees (kobo)', null, null, null, true),
  ('bills.max_amount_kobo', '10000000', 'Largest single bill purchase (kobo)', 'integer', 'bills', 'Maximum bill amount (kobo)', 10000, 50000000, null, true),
  ('security.transaction_pin_max_attempts', '5', 'Wrong transaction PIN entries before a lock', 'integer', 'security', 'Transaction PIN attempts', 3, 10, null, true),
  ('security.transaction_pin_lock_minutes', '30', 'Transaction PIN lock duration (minutes)', 'integer', 'security', 'Transaction PIN lock (minutes)', 5, 1440, null, true),
  ('security.transaction_auth_minutes', '10', 'Lifetime of a transaction authorisation (minutes)', 'integer', 'security', 'Transaction authorisation expiry (minutes)', 2, 30, null, false)
on conflict (key) do nothing;

-- Verification per activity: basic savers/bill users are not asked for BVN/NIN.
update public.app_settings
   set value = '{"bill_payment":0,"osusu_join":1,"contribute":1,"osusu_admin":2,"receive_payout":2,"withdraw":2,"operator":2}'::jsonb || value
 where key = 'kyc.required_levels';

-- Referral code: collision-resistant, non-sequential, one per user.
create or replace function public.ensure_referral_code(p_user_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code  text;
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  bytes bytea;
  i int;
begin
  select code into v_code from referral_codes where user_id = p_user_id;
  if found then return v_code; end if;
  for attempt in 1..10 loop
    bytes := gen_random_bytes(6);
    v_code := 'ACH-';
    for i in 0..5 loop
      v_code := v_code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    begin
      insert into referral_codes (code, user_id) values (v_code, p_user_id);
      return v_code;
    exception when unique_violation then
      select code into v_code from referral_codes where user_id = p_user_id;
      if found then return v_code; end if;   -- another request created it
    end;
  end loop;
  perform app_error(500, 'REFERRAL_CODE_FAILED', 'Could not create a referral code');
end $$;

create or replace function public._normalise_email(p text) returns text
language sql immutable as $$
  select case when split_part(lower(p), '@', 2) in ('gmail.com','googlemail.com')
    then replace(split_part(split_part(lower(p), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else split_part(split_part(lower(p), '@', 1), '+', 1) || '@' || split_part(lower(p), '@', 2) end
$$;

-- Created by the API right after registration. The referrer comes only from
-- the code, never from the client. Self-referral and re-referral are refused.
create or replace function public.create_referral(p_referred uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c        referral_codes%rowtype;
  referrer profiles%rowtype;
  referred profiles%rowtype;
  v_id     uuid;
  v_flags  text[] := '{}';
begin
  if not coalesce((select (value #>> '{}')::boolean from app_settings where key = 'referral.enabled'), true) then
    return jsonb_build_object('outcome', 'programme_closed');
  end if;
  select * into c from referral_codes where code = upper(trim(p_code)) and disabled_at is null;
  if not found then return jsonb_build_object('outcome', 'invalid_code'); end if;
  if c.user_id = p_referred then
    perform audit_event(p_referred, 'referral.self_referral_blocked', 'profile', p_referred::text, 'denied', '{}'::jsonb);
    return jsonb_build_object('outcome', 'self_referral');
  end if;
  if exists (select 1 from referrals where referred_user_id = p_referred) then
    return jsonb_build_object('outcome', 'already_referred');
  end if;
  select * into referrer from profiles where id = c.user_id;
  select * into referred from profiles where id = p_referred;
  if referrer.account_status in ('suspended','closed') then return jsonb_build_object('outcome', 'invalid_code'); end if;
  -- The referred account must be new (created by this registration).
  if referred.created_at < now() - interval '1 day' then return jsonb_build_object('outcome', 'too_late'); end if;

  if _normalise_email(referrer.email) = _normalise_email(referred.email) then v_flags := array_append(v_flags, 'same_email_identity'); end if;
  if right(referrer.phone, 10) = right(referred.phone, 10) then v_flags := array_append(v_flags, 'same_phone'); end if;

  insert into referrals (referrer_id, referred_user_id, code, flag_status, flag_reasons)
  values (c.user_id, p_referred, c.code, case when cardinality(v_flags) > 0 then 'SUSPICIOUS' end, v_flags)
  returning id into v_id;
  insert into referral_qualifications (referral_id) values (v_id);
  insert into referral_events (referral_id, event, to_status, metadata)
  values (v_id, 'referral.created', 'REGISTERED', jsonb_build_object('flags', v_flags));
  perform audit_event(p_referred, 'referral.created', 'referral', v_id::text, 'success', jsonb_build_object('referrer_id', c.user_id));
  perform enqueue_notification(c.user_id, 'referral_registered', 'referrals', 'New referral',
    'Someone joined ACHIEVER using your referral code.', jsonb_build_object('referral_id', v_id), 'ref_new:' || v_id);
  return jsonb_build_object('outcome', 'created', 'referral_id', v_id);
end $$;

-- Qualification engine for one referral. Computed only here; the client can
-- never set qualified/reward values.
create or replace function public.evaluate_referral(p_referral_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  r         referrals%rowtype;
  p         profiles%rowtype;
  k         kyc_profiles%rowtype;
  v_days    int;
  v_need_days int := setting_bigint('referral.qualification_days', 21);
  v_need_level int := setting_bigint('referral.verification_level', 1);
  v_need_acts int := setting_bigint('referral.min_activity_count', 1);
  v_osusu_req boolean := coalesce((select (value #>> '{}')::boolean from app_settings where key = 'referral.require_osusu'), true);
  v_acts_cfg jsonb := coalesce((select value from app_settings where key = 'referral.qualifying_activities'), '{}'::jsonb);
  v_verified boolean;
  v_osusu    boolean;
  v_acts     int := 0;
  v_good     boolean;
  v_shared_device boolean;
  v_new_status text;
  v_reason   text;
begin
  select * into r from referrals where id = p_referral_id for update;
  if not found then return null; end if;
  if r.reward_id is not null or r.status = 'DISQUALIFIED' then return r.status; end if;
  select * into p from profiles where id = r.referred_user_id;
  select * into k from kyc_profiles where user_id = r.referred_user_id;

  v_days := greatest(0, extract(day from now() - r.created_at)::int);
  v_verified := p.email_verified_at is not null and coalesce(k.level, 0) >= v_need_level;
  v_osusu := not v_osusu_req or exists (select 1 from osusu_members m where m.user_id = p.id and m.status = 'active');
  if coalesce((v_acts_cfg ->> 'bill_payment')::boolean, false) then
    v_acts := v_acts + (select count(*) from bill_payments b where b.user_id = p.id and b.status = 'delivered' and b.created_at >= r.created_at);
  end if;
  if coalesce((v_acts_cfg ->> 'osusu_contribution')::boolean, false) then
    v_acts := v_acts + (select count(*) from transactions t where t.user_id = p.id and t.type = 'osusu_contribution'
                         and t.status = 'success' and t.created_at >= r.created_at);
  end if;
  if coalesce((v_acts_cfg ->> 'collector_savings')::boolean, false) then
    v_acts := v_acts + (select count(*) from transactions t where t.user_id = p.id and t.type = 'collector_savings'
                         and t.status = 'success' and t.created_at >= r.created_at);
  end if;
  v_good := p.account_status = 'active' and coalesce(k.restricted, false) = false;

  -- Fraud signal: the same device used by both accounts. A flag is a hold for review, not a finding.
  v_shared_device := exists (
    select 1 from user_devices a join user_devices b on a.device_id_hash = b.device_id_hash
     where a.user_id = r.referrer_id and b.user_id = r.referred_user_id);
  if v_shared_device and not ('shared_device' = any(r.flag_reasons)) and coalesce(r.flag_status, '') not in ('APPROVED','REJECTED') then
    update referrals set flag_status = 'SUSPICIOUS', flag_reasons = array_append(flag_reasons, 'shared_device') where id = r.id;
    insert into referral_events (referral_id, event, metadata) values (r.id, 'referral.flagged', '{"reason":"shared_device"}');
    r.flag_status := 'SUSPICIOUS';
  end if;

  insert into referral_qualifications (referral_id, verified, osusu_met, days_elapsed, activity_count, good_standing, checks, evaluated_at)
  values (r.id, v_verified, v_osusu, v_days, v_acts, v_good,
          jsonb_build_object('required_days', v_need_days, 'required_activities', v_need_acts, 'verification_level', coalesce(k.level, 0),
                             'required_level', v_need_level, 'osusu_required', v_osusu_req), now())
  on conflict (referral_id) do update set verified = excluded.verified, osusu_met = excluded.osusu_met,
    days_elapsed = excluded.days_elapsed, activity_count = excluded.activity_count, good_standing = excluded.good_standing,
    checks = excluded.checks, evaluated_at = now();

  if r.flag_status = 'REJECTED' then
    v_new_status := 'DISQUALIFIED'; v_reason := 'Referral rejected after review';
  elsif p.account_status = 'closed' then
    v_new_status := 'DISQUALIFIED'; v_reason := 'Referred account closed';
  elsif not v_verified then
    v_new_status := 'REGISTERED'; v_reason := 'Waiting for account verification';
  elsif v_days >= v_need_days and v_osusu and v_acts >= v_need_acts and v_good then
    v_new_status := 'QUALIFIED'; v_reason := null;
  else
    v_new_status := 'QUALIFYING';
    v_reason := case when not v_good then 'Account not in good standing'
                     when not v_osusu then 'Waiting for Osusu membership'
                     when v_acts < v_need_acts then 'Waiting for qualifying activity'
                     else 'Qualification period in progress' end;
  end if;

  if v_new_status <> r.status then
    update referrals set status = v_new_status, status_reason = v_reason,
           qualified_at = case when v_new_status = 'QUALIFIED' then now() else null end
     where id = r.id;
    insert into referral_events (referral_id, event, from_status, to_status, reason)
    values (r.id, 'referral.status', r.status, v_new_status, v_reason);
    if v_new_status = 'QUALIFYING' and r.status = 'REGISTERED' then
      perform enqueue_notification(r.referrer_id, 'referral_progressing', 'referrals', 'Referral progressing',
        'Your referral is now progressing toward qualification.', jsonb_build_object('referral_id', r.id), 'ref_prog:' || r.id);
    elsif v_new_status = 'QUALIFIED' then
      perform enqueue_notification(r.referrer_id, 'referral_qualified', 'referrals', 'Referral qualified',
        'One of your referrals has completed the qualification requirements.', jsonb_build_object('referral_id', r.id), 'ref_q:' || r.id);
    end if;
  elsif v_reason is distinct from r.status_reason then
    update referrals set status_reason = v_reason where id = r.id;
  end if;
  return v_new_status;
end $$;

-- Group qualified, cleared referrals into rewards (one reward per full batch).
create or replace function public.evaluate_referrer_rewards(p_referrer uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_need   int := setting_bigint('referral.required_referrals', 6);
  v_amount bigint := setting_bigint('referral.reward_amount_kobo', 1500000);
  v_review boolean := coalesce((select (value #>> '{}')::boolean from app_settings where key = 'referral.review_required'), true);
  v_ids    uuid[];
  v_reward uuid;
  v_flagged boolean;
  v_made   int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('referral_rewards:' || p_referrer::text));
  if (select account_status from profiles where id = p_referrer) <> 'active' then return 0; end if;
  loop
    select array_agg(id order by qualified_at, id) into v_ids from (
      select id, qualified_at from referrals
       where referrer_id = p_referrer and status = 'QUALIFIED' and reward_id is null
         and (flag_status is null or flag_status = 'APPROVED')
       order by qualified_at, id limit v_need) q;
    exit when coalesce(cardinality(v_ids), 0) < v_need;
    v_flagged := exists (select 1 from referrals where id = any(v_ids) and cardinality(flag_reasons) > 0);
    insert into referral_rewards (referrer_id, amount, required_referrals, status, status_reason)
    values (p_referrer, v_amount, v_need, 'ELIGIBLE',
            case when v_flagged then 'Includes referrals that were reviewed after a flag' end)
    returning id into v_reward;
    update referrals set reward_id = v_reward where id = any(v_ids);
    insert into referral_events (reward_id, event, to_status, metadata)
    values (v_reward, 'reward.eligible', 'ELIGIBLE', jsonb_build_object('referrals', v_ids));
    if not v_review and not v_flagged then
      update referral_rewards set status = 'APPROVED', approved_at = now(), approval_reason = 'Automatic approval: no review required'
       where id = v_reward;
      insert into referral_events (reward_id, event, from_status, to_status, reason)
      values (v_reward, 'reward.approved', 'ELIGIBLE', 'APPROVED', 'Automatic approval');
      perform enqueue_notification(p_referrer, 'referral_reward_approved', 'referrals', 'Referral reward approved',
        format('Your %s referral reward has been approved.', fmt_naira(v_amount)), jsonb_build_object('reward_id', v_reward), 'rew_ok:' || v_reward);
    else
      perform enqueue_notification(p_referrer, 'referral_reward_ready', 'referrals', 'Referral reward ready for review',
        'Your referral reward is ready for review.', jsonb_build_object('reward_id', v_reward), 'rew_ready:' || v_reward);
    end if;
    perform audit_event(null, 'referral.reward_created', 'referral_reward', v_reward::text, 'success', jsonb_build_object('referrer_id', p_referrer));
    v_made := v_made + 1;
  end loop;
  return v_made;
end $$;

-- Batch job entry point.
create or replace function public.run_referral_qualification(p_limit int default 500) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rec record;
  v_n int := 0;
  v_rewards int := 0;
begin
  for rec in select id from referrals where status <> 'DISQUALIFIED' and reward_id is null order by updated_at limit p_limit loop
    perform evaluate_referral(rec.id);
    v_n := v_n + 1;
  end loop;
  for rec in select distinct referrer_id from referrals where status = 'QUALIFIED' and reward_id is null loop
    v_rewards := v_rewards + evaluate_referrer_rewards(rec.referrer_id);
  end loop;
  return jsonb_build_object('evaluated', v_n, 'rewards_created', v_rewards);
end $$;

-- Admin decision on a flagged referral (flag is not proof; review decides).
create or replace function public.decide_referral_flag(p_referral uuid, p_actor uuid, p_decision text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r referrals%rowtype;
begin
  if p_decision not in ('UNDER_REVIEW','APPROVED','REJECTED') then perform app_error(400, 'INVALID_DECISION', 'Invalid decision'); end if;
  if char_length(coalesce(trim(p_reason), '')) < 5 then perform app_error(400, 'REASON_REQUIRED', 'Give a reason for this decision'); end if;
  select * into r from referrals where id = p_referral for update;
  if not found then perform app_error(404, 'REFERRAL_NOT_FOUND', 'Referral not found'); end if;
  if r.reward_id is not null then perform app_error(409, 'REFERRAL_LOCKED', 'This referral is already part of a reward'); end if;
  update referrals set flag_status = p_decision, flag_decided_by = case when p_decision = 'UNDER_REVIEW' then null else p_actor end,
         flag_decided_at = case when p_decision = 'UNDER_REVIEW' then null else now() end, flag_decision_reason = p_reason
   where id = r.id;
  insert into referral_events (referral_id, event, from_status, to_status, actor_id, reason)
  values (r.id, 'referral.flag_decision', r.flag_status, p_decision, p_actor, p_reason);
  perform audit_event(p_actor, 'admin.referral.flag_decision', 'referral', r.id::text, 'success',
    jsonb_build_object('decision', p_decision, 'reason', p_reason));
end $$;

-- Reward state machine. Payment needs a different administrator from the approver.
create or replace function public.transition_referral_reward(p_reward uuid, p_actor uuid, p_action text, p_reason text,
  p_payment_reference text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w referral_rewards%rowtype;
  v_to text;
begin
  if char_length(coalesce(trim(p_reason), '')) < 5 then perform app_error(400, 'REASON_REQUIRED', 'Give a reason for this action'); end if;
  select * into w from referral_rewards where id = p_reward for update;
  if not found then perform app_error(404, 'REWARD_NOT_FOUND', 'Reward not found'); end if;

  if p_action = 'start_review' and w.status = 'ELIGIBLE' then
    v_to := 'UNDER_REVIEW';
    update referral_rewards set status = v_to, reviewed_by = p_actor, reviewed_at = now(), status_reason = p_reason where id = w.id;
  elsif p_action = 'approve' and w.status in ('ELIGIBLE','UNDER_REVIEW') then
    if (select account_status from profiles where id = w.referrer_id) <> 'active' then
      perform app_error(409, 'REFERRER_NOT_ACTIVE', 'The referrer account is not in good standing');
    end if;
    if exists (select 1 from referrals where reward_id = w.id and (status <> 'QUALIFIED' or coalesce(flag_status, 'APPROVED') <> 'APPROVED')) then
      perform app_error(409, 'REFERRALS_NOT_CLEARED', 'All referrals in this reward must be qualified and cleared');
    end if;
    v_to := 'APPROVED';
    update referral_rewards set status = v_to, approved_by = p_actor, approved_at = now(), approval_reason = p_reason where id = w.id;
    perform enqueue_notification(w.referrer_id, 'referral_reward_approved', 'referrals', 'Referral reward approved',
      format('Your %s referral reward has been approved.', fmt_naira(w.amount)), jsonb_build_object('reward_id', w.id), 'rew_ok:' || w.id);
  elsif p_action = 'reject' and w.status in ('ELIGIBLE','UNDER_REVIEW','APPROVED') then
    v_to := 'REJECTED';
    update referral_rewards set status = v_to, rejected_by = p_actor, rejected_at = now(), status_reason = p_reason where id = w.id;
  elsif p_action = 'mark_paid' and w.status = 'APPROVED' then
    if coalesce(trim(p_payment_reference), '') = '' then perform app_error(400, 'PAYMENT_REFERENCE_REQUIRED', 'Enter the payment reference'); end if;
    if w.approved_by is not null and w.approved_by = p_actor then
      perform app_error(403, 'SECOND_APPROVER_REQUIRED', 'A different administrator must record the payment');
    end if;
    v_to := 'PAID';
    update referral_rewards set status = v_to, paid_by = p_actor, paid_at = now(), payment_reference = p_payment_reference where id = w.id;
    perform enqueue_notification(w.referrer_id, 'referral_reward_paid', 'referrals', 'Referral reward paid',
      format('Your %s referral reward has been paid.', fmt_naira(w.amount)), jsonb_build_object('reward_id', w.id), 'rew_paid:' || w.id);
  elsif p_action = 'reverse' and w.status = 'PAID' then
    v_to := 'REVERSED';
    update referral_rewards set status = v_to, reversed_by = p_actor, reversed_at = now(), status_reason = p_reason where id = w.id;
  else
    perform app_error(409, 'INVALID_REWARD_TRANSITION', format('Cannot %s a reward that is %s', replace(p_action, '_', ' '), lower(w.status)));
  end if;

  insert into referral_events (reward_id, event, from_status, to_status, actor_id, reason, metadata)
  values (w.id, 'reward.' || p_action, w.status, v_to, p_actor, p_reason,
          case when p_payment_reference is not null then jsonb_build_object('payment_reference', p_payment_reference) else '{}'::jsonb end);
  perform audit_event(p_actor, 'admin.referral_reward.' || p_action, 'referral_reward', w.id::text, 'success',
    jsonb_build_object('from', w.status, 'to', v_to, 'reason', p_reason, 'payment_reference', p_payment_reference));
  return jsonb_build_object('status', v_to);
end $$;

-- ---------------------------------------------------------------------
-- 5b. Admin permissions (least privilege; approving and paying a reward
--     are separate permissions and must be different people)
-- ---------------------------------------------------------------------
insert into public.permissions (code, description) values
  ('referrals.read',   'See referrals, qualification progress and rewards (personal data masked)'),
  ('referrals.review', 'Decide on flagged referrals and approve or reject referral rewards'),
  ('referrals.pay',    'Record the payment or reversal of an approved referral reward'),
  ('bills.manage',     'Switch bill services on/off, requery and reconcile bill transactions')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code)
select 'SUPER_ADMIN', code from public.permissions on conflict do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('ADMIN','referrals.read'), ('ADMIN','referrals.review'), ('ADMIN','bills.manage'),
  ('FINANCE_ADMIN','referrals.read'), ('FINANCE_ADMIN','referrals.pay'), ('FINANCE_ADMIN','bills.manage'),
  ('COMPLIANCE_ADMIN','referrals.read'), ('COMPLIANCE_ADMIN','referrals.review'),
  ('AUDITOR','referrals.read')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 6. RLS: users read only their own rows; nobody writes from the browser
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'bill_transaction_events','bill_provider_responses','bill_reconciliation','bill_services','bill_products',
    'transaction_credentials','biometric_device_keys','transaction_auth_challenges','device_login_challenges',
    'transaction_security_events','push_devices','referral_codes','referrals','referral_rewards',
    'referral_qualifications','referral_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);   -- still row-filtered by RLS
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;

-- Secrets and internal data: not readable by browser roles at all.
revoke all on public.transaction_credentials, public.transaction_auth_challenges, public.device_login_challenges,
  public.push_devices, public.bill_provider_responses, public.bill_reconciliation from anon, authenticated;

create policy bill_events_own_read on public.bill_transaction_events for select to authenticated
  using (exists (select 1 from public.bill_payments b where b.id = bill_id and b.user_id = auth.uid()));
create policy bill_services_read on public.bill_services for select to authenticated using (true);
create policy bill_products_read on public.bill_products for select to authenticated using (true);
create policy device_keys_own_read on public.biometric_device_keys for select to authenticated using (user_id = auth.uid());
create policy tx_security_events_own_read on public.transaction_security_events for select to authenticated using (user_id = auth.uid());
create policy referral_codes_own_read on public.referral_codes for select to authenticated using (user_id = auth.uid());
create policy referrals_party_read on public.referrals for select to authenticated
  using (referrer_id = auth.uid() or referred_user_id = auth.uid());
create policy referral_rewards_own_read on public.referral_rewards for select to authenticated using (referrer_id = auth.uid());
create policy referral_qualifications_own_read on public.referral_qualifications for select to authenticated
  using (exists (select 1 from public.referrals r where r.id = referral_id and r.referrer_id = auth.uid()));
create policy referral_events_own_read on public.referral_events for select to authenticated
  using (exists (select 1 from public.referrals r where r.id = referral_id and r.referrer_id = auth.uid())
         or exists (select 1 from public.referral_rewards w where w.id = reward_id and w.referrer_id = auth.uid()));

-- New functions are server-only (service role); browser roles cannot call them.
revoke execute on function
  public.guard_bill_update(), public.log_bill_status(), public.guard_reconciliation_update(),
  public._apply_bill_payment(payment_attempts, timestamptz),
  public.record_bill_result(uuid, text, text, text, text, text, int, text, text, text),
  public.record_bill_reversal(uuid, text, text, text), public.set_refund_status(uuid, text, text),
  public.queue_push_for_notification(), public.guard_referral_update(), public.ensure_referral_code(uuid),
  public._normalise_email(text), public.create_referral(uuid, text), public.evaluate_referral(uuid),
  public.evaluate_referrer_rewards(uuid), public.run_referral_qualification(int),
  public.decide_referral_flag(uuid, uuid, text, text), public.transition_referral_reward(uuid, uuid, text, text, text)
from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
