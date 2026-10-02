-- =====================================================================
-- ACHIEVER — wallet account numbers, wallet → bank transfers, and the
-- centralised fee engine.
--
-- * Wallet account numbers: 'ACH' + 16 characters (digits 2-9 and
--   uppercase letters without I/O), random, server-generated, UNIQUE.
--   Existing wallets keep their balance and history; their old ACHW-…
--   IDs are kept as aliases (still resolvable, never reissued).
-- * Fee engine: versioned fee configurations (FIXED, PERCENTAGE,
--   FIXED_PLUS_PERCENTAGE, TIERED), min/max fee, transaction limits,
--   FEE_ADDED / FEE_INCLUDED. Changes are proposed by one administrator
--   and approved by another. fee_quote() is the single calculator; money
--   rows get their fee from it inside the database (never from a client)
--   and keep a snapshot, so later fee changes never rewrite history.
-- * Bank transfers: wallet → Nigerian bank account, paid out with
--   Paystack Transfers (or queued for manual payout). The wallet is debited
--   once (row locks), and failures / reversals refund automatically.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Wallet account numbers
-- ---------------------------------------------------------------------
create table public.wallet_account_aliases (
  code       text primary key,
  wallet_id  uuid not null references public.wallet_accounts(id),
  kind       text not null default 'legacy' check (kind in ('legacy')),
  created_at timestamptz not null default now()
);
create index wallet_account_aliases_wallet_idx on public.wallet_account_aliases (wallet_id);

-- Drop the old ACHW- format check (unnamed when created).
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.wallet_accounts'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%ACHW%'
  loop
    execute format('alter table public.wallet_accounts drop constraint %I', c.conname);
  end loop;
end $$;

create or replace function public._wallet_code() returns text
language plpgsql as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   -- no 0/O, 1/I
  bytes bytea;
  body text;
begin
  loop
    bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');   -- 16 random bytes
    body := '';
    for i in 0..15 loop body := body || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1); end loop;
    -- Always both digits and letters.
    exit when body ~ '[2-9]' and body ~ '[A-Z]';
  end loop;
  return 'ACH' || body;
end $$;

-- Existing wallets: keep the old ID as an alias, issue the new number. Balances and ledger untouched.
insert into public.wallet_account_aliases (code, wallet_id)
select wallet_code, id from public.wallet_accounts where kind = 'user' and wallet_code like 'ACHW-%'
on conflict do nothing;

do $$
declare r record; v text;
begin
  for r in select id from public.wallet_accounts where kind = 'user' and wallet_code like 'ACHW-%' loop
    loop
      v := public._wallet_code();
      exit when not exists (select 1 from public.wallet_accounts where wallet_code = v)
            and not exists (select 1 from public.wallet_account_aliases where code = v);
    end loop;
    update public.wallet_accounts set wallet_code = v where id = r.id;
  end loop;
end $$;

alter table public.wallet_accounts add constraint wallet_accounts_code_format check (
  kind <> 'user' or (wallet_code ~ '^ACH[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{16}$'
                     and substr(wallet_code, 4) ~ '[2-9]' and substr(wallet_code, 4) ~ '[A-Z]'));

-- A wallet's account number never changes once issued.
create or replace function public.guard_wallet_code() returns trigger
language plpgsql as $$
begin
  if new.wallet_code <> old.wallet_code and old.wallet_code !~ '^ACHW-' then
    raise exception 'ACH:409:WALLET_NUMBER_PERMANENT:A wallet account number cannot be changed';
  end if;
  return new;
end $$;
create trigger wallet_accounts_code_permanent before update of wallet_code on public.wallet_accounts
  for each row execute function public.guard_wallet_code();

create or replace function public.ensure_wallet(p_user_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text;
begin
  select id into v_id from wallet_accounts where user_id = p_user_id;
  if found then return v_id; end if;
  for attempt in 1..10 loop
    v_code := _wallet_code();
    continue when exists (select 1 from wallet_account_aliases where code = v_code);
    begin
      insert into wallet_accounts (kind, user_id, wallet_code) values ('user', p_user_id, v_code) returning id into v_id;
      return v_id;
    exception when unique_violation then
      select id into v_id from wallet_accounts where user_id = p_user_id;
      if found then return v_id; end if;
    end;
  end loop;
  perform app_error(500, 'WALLET_CREATE_FAILED', 'Could not create the wallet');
end $$;

/** Find a member wallet by its account number (current or legacy alias). */
create or replace function public.resolve_wallet_code(p_code text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from wallet_accounts where wallet_code = upper(p_code) and kind = 'user'),
    (select wallet_id from wallet_account_aliases where code = upper(p_code)))
$$;

-- New system account for money on its way to a bank.
alter table public.wallet_accounts drop constraint if exists wallet_accounts_kind_check;
alter table public.wallet_accounts add constraint wallet_accounts_kind_check check (kind in (
  'user','paystack_clearing','bill_settlement','fees','osusu_pool','collector_pool','rewards','adjustments','payout_clearing'));
insert into public.wallet_accounts (kind, wallet_code) values ('payout_clearing', 'SYS-PAYOUTS') on conflict do nothing;

alter table public.wallet_transactions drop constraint if exists wallet_transactions_type_check;
alter table public.wallet_transactions add constraint wallet_transactions_type_check check (type in (
  'topup','transfer','bill_payment','osusu_contribution','collector_savings','refund','reversal','referral_reward','fee','adjustment','bank_transfer'));
alter table public.wallet_transactions add column fee_snapshot jsonb;

-- ---------------------------------------------------------------------
-- 2. Fee engine
-- ---------------------------------------------------------------------
create table public.fee_configurations (
  id                         uuid primary key default gen_random_uuid(),
  code                       text not null unique default ('FEE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  service                    text not null check (service in (
                               'bank_transfer','wallet_transfer','wallet_topup',
                               'bill_airtime','bill_data','bill_electricity','bill_tv','bill_education','bill_recharge_pin','bill_betting',
                               'osusu_contribution','collector_savings','osusu_payout','referral_payout')),
  version                    int not null check (version > 0),
  fee_type                   text not null check (fee_type in ('FIXED','PERCENTAGE','FIXED_PLUS_PERCENTAGE','TIERED')),
  fixed_amount               bigint not null default 0 check (fixed_amount >= 0),
  percentage                 numeric(7,4) not null default 0 check (percentage >= 0 and percentage <= 50),
  tiers                      jsonb not null default '[]'::jsonb,   -- [{min, max|null, fixed, percentage}]
  minimum_fee                bigint check (minimum_fee is null or minimum_fee >= 0),
  maximum_fee                bigint check (maximum_fee is null or maximum_fee >= 0),
  minimum_transaction_amount bigint check (minimum_transaction_amount is null or minimum_transaction_amount > 0),
  maximum_transaction_amount bigint check (maximum_transaction_amount is null or maximum_transaction_amount > 0),
  fee_bearing_mode           text not null default 'FEE_ADDED' check (fee_bearing_mode in ('FEE_ADDED','FEE_INCLUDED')),
  enabled                    boolean not null default true,      -- false = no fee charged for this version
  currency                   char(3) not null default 'NGN',
  status                     text not null default 'PENDING_APPROVAL' check (status in ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED')),
  effective_from             timestamptz not null default now(),
  effective_until            timestamptz,
  reason                     text not null check (char_length(reason) between 5 and 1000),
  created_by                 uuid references public.profiles(id),
  approved_by                uuid references public.profiles(id),
  approved_at                timestamptz,
  decision_reason            text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (service, version),
  check (maximum_fee is null or minimum_fee is null or maximum_fee >= minimum_fee),
  check (maximum_transaction_amount is null or minimum_transaction_amount is null or maximum_transaction_amount >= minimum_transaction_amount),
  check (effective_until is null or effective_until > effective_from),
  check (jsonb_typeof(tiers) = 'array'),
  check (fee_type <> 'TIERED' or jsonb_array_length(tiers) > 0),
  -- The provider / group must receive the full amount for these services.
  check (fee_bearing_mode = 'FEE_ADDED' or service in ('bank_transfer','wallet_transfer','wallet_topup'))
);
create index fee_configurations_lookup_idx on public.fee_configurations (service, status, effective_from desc, version desc);
create trigger fee_configurations_updated_at before update on public.fee_configurations for each row execute function public.set_updated_at();

-- Approved versions are history: they never change; a change is a new version.
create or replace function public.guard_fee_configuration() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'ACH:409:FEE_IMMUTABLE:Fee configurations cannot be deleted'; end if;
  if old.status <> 'PENDING_APPROVAL' then raise exception 'ACH:409:FEE_IMMUTABLE:This fee version is final; create a new version'; end if;
  if (new.service, new.version, new.fee_type, new.fixed_amount, new.percentage, new.tiers, new.minimum_fee, new.maximum_fee,
      new.minimum_transaction_amount, new.maximum_transaction_amount, new.fee_bearing_mode, new.enabled, new.created_by)
     is distinct from
     (old.service, old.version, old.fee_type, old.fixed_amount, old.percentage, old.tiers, old.minimum_fee, old.maximum_fee,
      old.minimum_transaction_amount, old.maximum_transaction_amount, old.fee_bearing_mode, old.enabled, old.created_by) then
    raise exception 'ACH:409:FEE_IMMUTABLE:A proposed fee cannot be edited; cancel it and propose again';
  end if;
  return new;
end $$;
create trigger fee_configurations_guard before update or delete on public.fee_configurations
  for each row execute function public.guard_fee_configuration();

/** The fee version in force for a service at a time (latest approved version that has started). */
create or replace function public.active_fee_configuration(p_service text, p_at timestamptz default now()) returns public.fee_configurations
language sql stable security definer set search_path = public as $$
  select * from fee_configurations
   where service = p_service and status = 'APPROVED' and effective_from <= p_at
     and (effective_until is null or effective_until > p_at)
   order by effective_from desc, version desc
   limit 1
$$;

/**
 * The single fee calculator. Returns
 *   { service, amount, fee, total_debit, recipient_amount, fee_type, fee_bearing_mode,
 *     fee_configuration_id, fee_code, fee_version, rule }
 * FEE_ADDED   : total_debit = amount + fee, recipient_amount = amount
 * FEE_INCLUDED: total_debit = amount,       recipient_amount = amount - fee
 * Percentages are rounded half-up to the kobo, then clamped to [minimum_fee, maximum_fee].
 */
create or replace function public.fee_quote(p_service text, p_amount bigint, p_at timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f      fee_configurations;
  t      jsonb;
  v_fee  numeric := 0;
  v_rule text := 'No fee';
begin
  if p_amount is null or p_amount <= 0 then perform app_error(400, 'INVALID_AMOUNT', 'Enter a valid amount'); end if;
  f := active_fee_configuration(p_service, p_at);
  if f.id is null then
    return jsonb_build_object('service', p_service, 'amount', p_amount, 'fee', 0, 'total_debit', p_amount, 'recipient_amount', p_amount,
      'fee_type', null, 'fee_bearing_mode', 'FEE_ADDED', 'fee_configuration_id', null, 'fee_code', null, 'fee_version', null, 'rule', v_rule);
  end if;
  if f.minimum_transaction_amount is not null and p_amount < f.minimum_transaction_amount then
    perform app_error(422, 'AMOUNT_TOO_LOW', format('The minimum amount is %s', fmt_naira(f.minimum_transaction_amount)));
  end if;
  if f.maximum_transaction_amount is not null and p_amount > f.maximum_transaction_amount then
    perform app_error(422, 'AMOUNT_TOO_HIGH', format('The maximum amount is %s', fmt_naira(f.maximum_transaction_amount)));
  end if;

  if f.enabled then
    if f.fee_type = 'FIXED' then
      v_fee := f.fixed_amount; v_rule := fmt_naira(f.fixed_amount);
    elsif f.fee_type = 'PERCENTAGE' then
      v_fee := round(p_amount * f.percentage / 100); v_rule := trim(to_char(f.percentage, 'FM990.99')) || '%';
    elsif f.fee_type = 'FIXED_PLUS_PERCENTAGE' then
      v_fee := f.fixed_amount + round(p_amount * f.percentage / 100);
      v_rule := fmt_naira(f.fixed_amount) || ' + ' || trim(to_char(f.percentage, 'FM990.99')) || '%';
    else
      select x into t from jsonb_array_elements(f.tiers) x
       where p_amount >= coalesce((x ->> 'min')::bigint, 0) and (x ->> 'max' is null or p_amount <= (x ->> 'max')::bigint)
       order by coalesce((x ->> 'min')::bigint, 0) desc limit 1;
      if t is null then perform app_error(422, 'NO_FEE_TIER', 'This amount is not covered by the current fee schedule'); end if;
      v_fee := coalesce((t ->> 'fixed')::bigint, 0) + round(p_amount * coalesce((t ->> 'percentage')::numeric, 0) / 100);
      v_rule := 'Tiered';
    end if;
    if f.minimum_fee is not null and v_fee < f.minimum_fee then v_fee := f.minimum_fee; end if;
    if f.maximum_fee is not null and v_fee > f.maximum_fee then v_fee := f.maximum_fee; end if;
  end if;

  if f.fee_bearing_mode = 'FEE_INCLUDED' and v_fee >= p_amount then
    perform app_error(422, 'AMOUNT_TOO_LOW', 'The amount is too small to cover the fee');
  end if;
  return jsonb_build_object(
    'service', p_service, 'amount', p_amount, 'fee', v_fee::bigint,
    'total_debit', case when f.fee_bearing_mode = 'FEE_ADDED' then p_amount + v_fee::bigint else p_amount end,
    'recipient_amount', case when f.fee_bearing_mode = 'FEE_ADDED' then p_amount else p_amount - v_fee::bigint end,
    'fee_type', f.fee_type, 'fee_bearing_mode', f.fee_bearing_mode, 'fee_configuration_id', f.id,
    'fee_code', f.code, 'fee_version', f.version, 'rule', v_rule, 'enabled', f.enabled);
end $$;

/** Admin step 1: propose a new fee version (it applies only after a second administrator approves it). */
create or replace function public.propose_fee_configuration(p_actor uuid, p jsonb) returns public.fee_configurations
language plpgsql security definer set search_path = public as $$
declare
  v_version int;
  r fee_configurations;
begin
  if p ->> 'fee_type' = 'TIERED' then
    if jsonb_typeof(p -> 'tiers') <> 'array' or jsonb_array_length(p -> 'tiers') = 0 then
      perform app_error(400, 'TIERS_REQUIRED', 'Add at least one tier');
    end if;
  end if;
  perform 1 from fee_configurations where service = p ->> 'service' and status = 'PENDING_APPROVAL';
  if found then perform app_error(409, 'FEE_PENDING', 'A change for this service is already waiting for approval'); end if;
  select coalesce(max(version), 0) + 1 into v_version from fee_configurations where service = p ->> 'service';
  insert into fee_configurations (service, version, fee_type, fixed_amount, percentage, tiers, minimum_fee, maximum_fee,
    minimum_transaction_amount, maximum_transaction_amount, fee_bearing_mode, enabled, effective_from, effective_until, reason, created_by)
  values (p ->> 'service', v_version, p ->> 'fee_type', coalesce((p ->> 'fixed_amount')::bigint, 0), coalesce((p ->> 'percentage')::numeric, 0),
    coalesce(p -> 'tiers', '[]'::jsonb), (p ->> 'minimum_fee')::bigint, (p ->> 'maximum_fee')::bigint,
    (p ->> 'minimum_transaction_amount')::bigint, (p ->> 'maximum_transaction_amount')::bigint,
    coalesce(p ->> 'fee_bearing_mode', 'FEE_ADDED'), coalesce((p ->> 'enabled')::boolean, true),
    greatest(coalesce((p ->> 'effective_from')::timestamptz, now()), now()), (p ->> 'effective_until')::timestamptz,
    p ->> 'reason', p_actor)
  returning * into r;
  perform audit_event(p_actor, 'admin.fee.proposed', 'fee_configuration', r.id::text, 'success',
    jsonb_build_object('service', r.service, 'version', r.version, 'reason', r.reason));
  return r;
end $$;

/** Admin step 2: approve / reject (a different administrator unless the setting allows single approval). */
create or replace function public.decide_fee_configuration(p_id uuid, p_actor uuid, p_approve boolean, p_reason text) returns public.fee_configurations
language plpgsql security definer set search_path = public as $$
declare r fee_configurations;
begin
  if char_length(coalesce(trim(p_reason), '')) < 5 then perform app_error(400, 'REASON_REQUIRED', 'Give a reason'); end if;
  select * into r from fee_configurations where id = p_id for update;
  if not found or r.status <> 'PENDING_APPROVAL' then perform app_error(409, 'FEE_NOT_PENDING', 'This fee change is not waiting for approval'); end if;
  if p_approve and r.created_by = p_actor and setting_bigint('fees.require_second_approver', 1) = 1 then
    perform app_error(403, 'SECOND_APPROVER_REQUIRED', 'A different administrator must approve this fee change');
  end if;
  update fee_configurations
     set status = case when p_approve then 'APPROVED' else 'REJECTED' end, approved_by = p_actor, approved_at = now(),
         decision_reason = p_reason, effective_from = case when p_approve then greatest(effective_from, now()) else effective_from end
   where id = p_id returning * into r;
  perform audit_event(p_actor, 'admin.fee.' || case when p_approve then 'approved' else 'rejected' end, 'fee_configuration', r.id::text, 'success',
    jsonb_build_object('service', r.service, 'version', r.version, 'reason', p_reason, 'effective_from', r.effective_from));
  return r;
end $$;

create or replace function public.cancel_fee_configuration(p_id uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update fee_configurations set status = 'CANCELLED', decision_reason = 'Withdrawn', approved_by = p_actor, approved_at = now()
   where id = p_id and status = 'PENDING_APPROVAL';
  if not found then perform app_error(409, 'FEE_NOT_PENDING', 'This fee change is not waiting for approval'); end if;
  perform audit_event(p_actor, 'admin.fee.cancelled', 'fee_configuration', p_id::text, 'success', '{}'::jsonb);
end $$;

-- Starting fees: exactly what applies today (bill fees and the internal transfer fee from settings).
-- Bank transfers start at ₦100 added on top (admins can change it).
insert into public.fee_configurations (service, version, fee_type, fixed_amount, fee_bearing_mode, status, effective_from, reason, approved_at, decision_reason)
select s.service, 1, 'FIXED', s.amount, 'FEE_ADDED', 'APPROVED', now(), 'Initial configuration (migrated from settings)', now(), 'System migration'
from (
  values
    ('bank_transfer', 10000::bigint),
    ('wallet_transfer', coalesce((select (value #>> '{}')::bigint from public.app_settings where key = 'wallet.transfer_fee_kobo'), 0)),
    ('wallet_topup', 0::bigint),
    ('osusu_contribution', 0::bigint),
    ('collector_savings', 0::bigint),
    ('osusu_payout', 0::bigint),
    ('referral_payout', 0::bigint)
) as s(service, amount)
union all
select 'bill_' || c.cat, 1, 'FIXED', coalesce((select (value -> c.cat)::bigint from public.app_settings where key = 'bills.fee_kobo'), 0),
       'FEE_ADDED', 'APPROVED', now(), 'Initial configuration (migrated from settings)', now(), 'System migration'
from unnest(array['airtime','data','electricity','tv','education','recharge_pin','betting']) as c(cat)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Fees applied inside the database (clients never set fees)
-- ---------------------------------------------------------------------
-- Internal transfers
alter table public.wallet_transfers
  add column total_debit      bigint check (total_debit is null or total_debit > 0),
  add column recipient_amount bigint check (recipient_amount is null or recipient_amount > 0),
  add column fee_snapshot     jsonb;

create or replace function public.price_wallet_transfer() returns trigger
language plpgsql security definer set search_path = public as $$
declare q jsonb;
begin
  q := fee_quote('wallet_transfer', new.amount);
  new.fee := (q ->> 'fee')::bigint;
  new.total_debit := (q ->> 'total_debit')::bigint;
  new.recipient_amount := (q ->> 'recipient_amount')::bigint;
  new.fee_snapshot := q;
  return new;
end $$;
create trigger wallet_transfers_price before insert on public.wallet_transfers
  for each row execute function public.price_wallet_transfer();

create or replace function public._wallet_transfer_post(x wallet_transfers) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tx uuid;
  v_recipient uuid;
  v_lines jsonb;
  v_total bigint := coalesce(x.total_debit, x.amount + x.fee);
  v_to    bigint := coalesce(x.recipient_amount, x.amount);
begin
  select user_id into v_recipient from wallet_accounts where id = x.recipient_wallet_id;
  v_tx := _wallet_tx('transfer', v_to, x.sender_user_id, coalesce('Transfer: ' || nullif(x.note, ''), 'Wallet transfer'),
    jsonb_build_object('counterparty', v_recipient, 'fee', x.fee, 'idempotency_key', x.idempotency_key,
      'metadata', jsonb_build_object('transfer_id', x.id, 'reference', x.reference, 'total_debit', v_total)));
  update wallet_transactions set fee_snapshot = x.fee_snapshot where id = v_tx;
  v_lines := jsonb_build_array(
    jsonb_build_object('account', x.sender_wallet_id, 'direction', 'debit', 'amount', v_total),
    jsonb_build_object('account', x.recipient_wallet_id, 'direction', 'credit', 'amount', v_to));
  if x.fee > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', _system_account('fees'), 'direction', 'credit', 'amount', x.fee)); end if;
  perform _wallet_post(v_tx, v_lines);
  perform enqueue_notification(x.sender_user_id, 'wallet_transfer_sent', 'payments', 'Transfer sent',
    format('You sent %s from your ACHIEVER Wallet.', fmt_naira(v_to)), jsonb_build_object('wallet_transaction_id', v_tx), 'tr_out:' || x.id);
  perform enqueue_notification(v_recipient, 'wallet_transfer_received', 'payments', 'Money received',
    format('%s was added to your ACHIEVER Wallet.', fmt_naira(v_to)), jsonb_build_object('wallet_transaction_id', v_tx), 'tr_in:' || x.id);
  return v_tx;
end $$;

create or replace function public.wallet_execute_transfer(p_transfer uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x       wallet_transfers%rowtype;
  s       wallet_accounts%rowtype;
  r       wallet_accounts%rowtype;
  v_today bigint;
  v_tx    uuid;
  v_hold  uuid;
  v_total bigint;
begin
  select * into x from wallet_transfers where id = p_transfer for update;
  if not found then perform app_error(404, 'TRANSFER_NOT_FOUND', 'Transfer not found'); end if;
  if x.status = 'SUCCESS' then return jsonb_build_object('outcome', 'already_done', 'status', x.status, 'wallet_transaction_id', x.transaction_id); end if;
  if x.status <> 'AWAITING_AUTHORIZATION' or x.authorized_at is null then perform app_error(409, 'TRANSFER_NOT_AUTHORISED', 'This transfer has not been approved'); end if;
  if x.expires_at < now() then
    update wallet_transfers set status = 'CANCELLED', failure_reason = 'Review expired' where id = x.id;
    perform app_error(409, 'TRANSFER_EXPIRED', 'This transfer review expired. Start again.');
  end if;
  v_total := coalesce(x.total_debit, x.amount + x.fee);
  perform 1 from wallet_accounts where id in (x.sender_wallet_id, x.recipient_wallet_id) order by id for update;
  select * into s from wallet_accounts where id = x.sender_wallet_id;
  select * into r from wallet_accounts where id = x.recipient_wallet_id;
  if r.status <> 'active' then perform app_error(409, 'RECIPIENT_UNAVAILABLE', 'The recipient wallet cannot receive money right now'); end if;
  if x.amount > setting_bigint('wallet.transfer_single_max_kobo', 20000000) then perform app_error(422, 'TRANSFER_TOO_LARGE', 'This amount is above your single-transfer limit'); end if;
  select coalesce(sum(amount), 0) into v_today from wallet_transfers
   where sender_user_id = x.sender_user_id and status in ('SUCCESS','PENDING_REVIEW')
     and created_at >= (date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos');
  if v_today + x.amount > setting_bigint('wallet.transfer_daily_max_kobo', 50000000) then
    perform app_error(422, 'DAILY_LIMIT_REACHED', 'This transfer would exceed your daily transfer limit');
  end if;
  if s.balance - s.held < v_total then perform app_error(409, 'INSUFFICIENT_FUNDS', 'Insufficient balance. Your ACHIEVER Wallet does not have enough for this transfer and its fee.'); end if;

  if x.amount >= setting_bigint('wallet.transfer_review_threshold_kobo', 50000000) then
    insert into wallet_holds (account_id, amount, reason, transfer_id) values (s.id, v_total, 'Large transfer under review', x.id) returning id into v_hold;
    update wallet_accounts set held = held + v_total where id = s.id;
    update wallet_transfers set status = 'PENDING_REVIEW', hold_id = v_hold where id = x.id;
    perform enqueue_notification(x.sender_user_id, 'wallet_transfer_review', 'security', 'Transfer under review',
      'A large transfer is being reviewed for your protection. The amount is held in your wallet until it is approved.', jsonb_build_object('transfer_id', x.id), 'tr_rev:' || x.id);
    perform audit_event(x.sender_user_id, 'wallet.transfer.held_for_review', 'wallet_transfer', x.id::text, 'success', jsonb_build_object('amount', x.amount));
    return jsonb_build_object('outcome', 'pending_review');
  end if;

  v_tx := _wallet_transfer_post(x);
  update wallet_transfers set status = 'SUCCESS', transaction_id = v_tx, completed_at = now() where id = x.id;
  perform audit_event(x.sender_user_id, 'wallet.transfer', 'wallet_transfer', x.id::text, 'success', jsonb_build_object('amount', x.amount, 'fee', x.fee, 'recipient_wallet', r.wallet_code));
  return jsonb_build_object('outcome', 'success', 'wallet_transaction_id', v_tx);
end $$;

create or replace function public.wallet_review_transfer(p_transfer uuid, p_actor uuid, p_approve boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x    wallet_transfers%rowtype;
  v_tx uuid;
  v_total bigint;
begin
  if char_length(coalesce(trim(p_reason), '')) < 5 then perform app_error(400, 'REASON_REQUIRED', 'Give a reason'); end if;
  select * into x from wallet_transfers where id = p_transfer for update;
  if not found or x.status <> 'PENDING_REVIEW' then perform app_error(409, 'NOT_UNDER_REVIEW', 'This transfer is not waiting for review'); end if;
  if p_actor = x.sender_user_id then perform app_error(403, 'SELF_REVIEW_FORBIDDEN', 'You cannot review your own transfer'); end if;
  v_total := coalesce(x.total_debit, x.amount + x.fee);
  update wallet_holds set status = case when p_approve then 'captured' else 'released' end, released_at = now() where id = x.hold_id;
  update wallet_accounts set held = held - v_total where id = x.sender_wallet_id;
  if p_approve then
    v_tx := _wallet_transfer_post(x);
    update wallet_transfers set status = 'SUCCESS', transaction_id = v_tx, completed_at = now(), reviewed_by = p_actor, review_reason = p_reason where id = x.id;
  else
    update wallet_transfers set status = 'FAILED', failure_reason = 'Not approved after review', reviewed_by = p_actor, review_reason = p_reason, completed_at = now() where id = x.id;
    perform enqueue_notification(x.sender_user_id, 'wallet_transfer_rejected', 'security', 'Transfer not approved',
      'A transfer you made was not approved after review. The amount is available in your wallet again.', jsonb_build_object('transfer_id', x.id), 'tr_rej:' || x.id);
  end if;
  perform audit_event(p_actor, 'admin.wallet.transfer_review', 'wallet_transfer', x.id::text, 'success', jsonb_build_object('approved', p_approve, 'reason', p_reason));
  return jsonb_build_object('outcome', case when p_approve then 'success' else 'rejected' end, 'wallet_transaction_id', v_tx);
end $$;

-- Top-ups: the member pays `amount` on Paystack; the wallet receives credit_amount; the fee goes to fees.
alter table public.wallet_topups
  add column fee           bigint not null default 0 check (fee >= 0),
  add column credit_amount bigint check (credit_amount is null or credit_amount > 0),
  add column fee_snapshot  jsonb;

/** Price a top-up from the amount the member wants credited (requested_amount). amount = what Paystack charges. */
create or replace function public.price_wallet_topup() returns trigger
language plpgsql security definer set search_path = public as $$
declare q jsonb;
begin
  q := fee_quote('wallet_topup', new.amount);
  new.fee := (q ->> 'fee')::bigint;
  new.amount := (q ->> 'total_debit')::bigint;          -- charged on Paystack
  new.credit_amount := (q ->> 'recipient_amount')::bigint;  -- credited to the wallet
  new.fee_snapshot := q;
  return new;
end $$;
create trigger wallet_topups_price before insert on public.wallet_topups
  for each row execute function public.price_wallet_topup();

create or replace function public._apply_wallet_topup(a payment_attempts, p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t      wallet_topups%rowtype;
  v_tx   uuid;
  v_ref  uuid;
  v_cr   bigint;
  v_lines jsonb;
begin
  select * into t from wallet_topups where id = a.target_id for update;
  if not found or t.user_id <> a.user_id or t.amount <> a.amount or t.status not in ('INITIALIZED','PENDING') then
    v_ref := _create_refund_tx(a.user_id, a.amount, a.reference, 'topup_not_applicable');
    return jsonb_build_object('outcome', 'duplicate', 'refund_transaction_id', v_ref);
  end if;
  v_cr := coalesce(t.credit_amount, t.amount);
  v_tx := _wallet_tx('topup', v_cr, a.user_id, 'Wallet top-up (Paystack)', jsonb_build_object('payment_reference', a.reference, 'fee', t.fee));
  update wallet_transactions set fee_snapshot = t.fee_snapshot where id = v_tx;
  v_lines := jsonb_build_array(
    jsonb_build_object('account', _system_account('paystack_clearing'), 'direction', 'debit', 'amount', a.amount),
    jsonb_build_object('account', t.wallet_id, 'direction', 'credit', 'amount', v_cr));
  if a.amount - v_cr > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', _system_account('fees'), 'direction', 'credit', 'amount', a.amount - v_cr));
  end if;
  perform _wallet_post(v_tx, v_lines);
  update wallet_topups set status = 'SUCCESS', transaction_id = v_tx, completed_at = now(), payment_reference = a.reference where id = t.id;
  perform enqueue_notification(a.user_id, 'wallet_topup', 'payments', 'Wallet funded',
    format('%s has been added to your ACHIEVER Wallet.', fmt_naira(v_cr)), jsonb_build_object('wallet_transaction_id', v_tx), 'topup:' || a.reference);
  perform audit_event(a.user_id, 'wallet.topup', 'wallet_topup', t.id::text, 'success', jsonb_build_object('reference', a.reference, 'amount', v_cr, 'fee', t.fee));
  return jsonb_build_object('outcome', 'applied', 'wallet_transaction_id', v_tx, 'topup_id', t.id);
end $$;

create or replace function public.wallet_reverse_topup(p_topup uuid, p_reason text, p_status text default 'REVERSED') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t    wallet_topups%rowtype;
  w    wallet_accounts%rowtype;
  v_tx uuid;
  v_cr bigint;
  v_lines jsonb;
begin
  select * into t from wallet_topups where id = p_topup for update;
  if not found then perform app_error(404, 'TOPUP_NOT_FOUND', 'Top-up not found'); end if;
  if t.status <> 'SUCCESS' then return jsonb_build_object('outcome', 'not_applicable', 'status', t.status); end if;
  v_cr := coalesce(t.credit_amount, t.amount);
  v_tx := _wallet_tx('reversal', v_cr, t.user_id, 'Top-up reversed by the payment provider',
    jsonb_build_object('payment_reference', t.payment_reference, 'reverses_id', t.transaction_id, 'fee', t.fee, 'metadata', jsonb_build_object('reason', left(p_reason, 200))));
  v_lines := jsonb_build_array(
    jsonb_build_object('account', t.wallet_id, 'direction', 'debit', 'amount', v_cr),
    jsonb_build_object('account', _system_account('paystack_clearing'), 'direction', 'credit', 'amount', t.amount));
  if t.amount - v_cr > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', _system_account('fees'), 'direction', 'debit', 'amount', t.amount - v_cr));
  end if;
  perform _wallet_post(v_tx, v_lines, true);
  update wallet_transactions set status = 'reversed' where id = t.transaction_id and status = 'success';
  update wallet_topups set status = case when p_status = 'REFUNDED' then 'REFUNDED' else 'REVERSED' end, failure_reason = left(p_reason, 300) where id = t.id;
  select * into w from wallet_accounts where id = t.wallet_id;
  if w.balance < 0 then
    update wallet_accounts set status = 'frozen', status_reason = 'Negative balance after a reversed top-up' where id = w.id;
    insert into risk_flags (subject_user_id, context, reason_code, severity, details)
    values (t.user_id, 'payments', 'wallet_negative_after_reversal', 'high', jsonb_build_object('topup_id', t.id, 'balance', w.balance));
  end if;
  perform enqueue_notification(t.user_id, 'wallet_topup_reversed', 'payments', 'Top-up reversed',
    'A wallet top-up was reversed by the payment provider. Open ACHIEVER for details.', jsonb_build_object('topup_id', t.id), 'topup_rev:' || t.id);
  perform audit_event(null, 'wallet.topup.reversed', 'wallet_topup', t.id::text, 'success', jsonb_build_object('reason', left(p_reason, 200)));
  return jsonb_build_object('outcome', 'reversed', 'wallet_transaction_id', v_tx);
end $$;

-- Bills: the fee comes from the fee engine (per category) and is snapshotted on the bill.
alter table public.bill_payments add column fee_snapshot jsonb;

create or replace function public.price_bill_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare q jsonb;
begin
  q := fee_quote('bill_' || new.category, new.amount);
  new.fee := (q ->> 'fee')::bigint;
  new.fee_snapshot := q;
  return new;
end $$;
create trigger bill_payments_price before insert on public.bill_payments
  for each row execute function public.price_bill_payment();

-- Wallet-paid bill: purchase amount to bill settlement, fee to the fees account.
create or replace function public.wallet_pay_bill(p_bill uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b     bill_payments%rowtype;
  w     uuid;
  v_wtx uuid;
  v_tx  uuid;
  v_spent bigint;
  v_lines jsonb;
begin
  perform set_config('achiever.bill_source', 'wallet', true);
  select * into b from bill_payments where id = p_bill for update;
  if not found then perform app_error(404, 'BILL_NOT_FOUND', 'Bill payment not found'); end if;
  if b.status = 'paid' or b.status = 'processing' or b.status = 'delivered' then return jsonb_build_object('outcome', 'already_paid'); end if;
  if b.status <> 'awaiting_payment' or b.funding_source <> 'wallet' or b.authorized_at is null then
    perform app_error(409, 'BILL_NOT_PAYABLE', 'This purchase is not ready to be paid from the wallet');
  end if;
  select coalesce(sum(total_amount), 0) into v_spent from bill_payments
   where user_id = b.user_id and funding_source = 'wallet' and status in ('paid','processing','delivered')
     and created_at >= (date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos');
  if v_spent + b.total_amount > setting_bigint('wallet.bill_daily_max_kobo', 20000000) then
    perform app_error(422, 'DAILY_LIMIT_REACHED', 'This purchase would exceed your daily bill limit');
  end if;
  w := ensure_wallet(b.user_id);
  v_wtx := _wallet_tx('bill_payment', b.amount, b.user_id, coalesce(b.service_name, initcap(b.category)) || ' purchase',
    jsonb_build_object('bill_payment_id', b.id, 'fee', b.fee));
  update wallet_transactions set fee_snapshot = b.fee_snapshot where id = v_wtx;
  v_lines := jsonb_build_array(
    jsonb_build_object('account', w, 'direction', 'debit', 'amount', b.total_amount),
    jsonb_build_object('account', _system_account('bill_settlement'), 'direction', 'credit', 'amount', b.amount));
  if b.fee > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', _system_account('fees'), 'direction', 'credit', 'amount', b.fee)); end if;
  perform _wallet_post(v_wtx, v_lines);
  insert into transactions (reference, user_id, bill_payment_id, type, direction, amount, provider, provider_reference,
                            status, description, metadata)
  values (new_reference('ACH-TX'), b.user_id, b.id, 'bill_payment', 'debit', b.total_amount, 'internal',
          (select reference from wallet_transactions where id = v_wtx), 'processing',
          coalesce(b.service_name, initcap(b.category)) || ' purchase (ACHIEVER Wallet)',
          jsonb_build_object('bill_payment_id', b.id, 'service_id', b.service_id, 'fee', b.fee, 'wallet_transaction_id', v_wtx))
  returning id into v_tx;
  update bill_payments set status = 'paid', payment_reference = (select reference from wallet_transactions where id = v_wtx),
         transaction_id = v_tx, wallet_transaction_id = v_wtx where id = b.id;
  perform audit_event(b.user_id, 'bill.paid.wallet', 'bill_payment', b.id::text, 'success', jsonb_build_object('wallet_transaction_id', v_wtx, 'fee', b.fee));
  return jsonb_build_object('outcome', 'applied', 'bill_payment_id', b.id, 'wallet_transaction_id', v_wtx);
end $$;

create or replace function public._bill_refund(b bill_payments, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_wtx uuid;
  v_lines jsonb;
  v_fee_posted bigint := 0;
begin
  if b.funding_source = 'wallet' then
    -- Fee refunded too. Older wallet bills posted the whole total to bill settlement.
    select coalesce(sum(e.amount), 0) into v_fee_posted from wallet_ledger_entries e
     where e.transaction_id = b.wallet_transaction_id and e.account_id = _system_account('fees') and e.direction = 'credit';
    v_wtx := _wallet_tx('refund', b.amount, b.user_id, 'Refund: ' || coalesce(b.service_name, initcap(b.category)),
      jsonb_build_object('bill_payment_id', b.id, 'reverses_id', b.wallet_transaction_id, 'fee', b.fee, 'metadata', jsonb_build_object('reason', p_reason)));
    v_lines := jsonb_build_array(
      jsonb_build_object('account', _system_account('bill_settlement'), 'direction', 'debit', 'amount', b.total_amount - v_fee_posted),
      jsonb_build_object('account', ensure_wallet(b.user_id), 'direction', 'credit', 'amount', b.total_amount));
    if v_fee_posted > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', _system_account('fees'), 'direction', 'debit', 'amount', v_fee_posted));
    end if;
    perform _wallet_post(v_wtx, v_lines);
    insert into transactions (reference, user_id, bill_payment_id, type, direction, amount, provider, status, description, metadata, completed_at)
    values (new_reference('ACH-RF'), b.user_id, b.id, 'refund', 'credit', b.total_amount, 'internal', 'success',
            'Refund to ACHIEVER Wallet', jsonb_build_object('reason', p_reason, 'wallet_transaction_id', v_wtx), now());
    return null;
  end if;
  return _create_refund_tx(b.user_id, b.total_amount, b.payment_reference, p_reason, null, null, b.id);
end $$;

-- OSUSU and collector payments from the wallet: the group / plan receives the full amount; the fee is added.
create or replace function public.wallet_pay_osusu_contribution(p_user uuid, p_contribution uuid, p_mandate uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c     osusu_contributions%rowtype;
  g     osusu_groups%rowtype;
  v_wtx uuid;
  v_ref text;
  a     payment_attempts%rowtype;
  v_res jsonb;
  q     jsonb;
  v_fee bigint;
  v_lines jsonb;
begin
  select * into c from osusu_contributions where id = p_contribution for update;
  if not found or c.user_id <> p_user then perform app_error(404, 'CONTRIBUTION_NOT_FOUND', 'Contribution not found'); end if;
  if c.status = 'paid' then return jsonb_build_object('outcome', 'already_paid'); end if;
  select * into g from osusu_groups where id = c.group_id;
  q := fee_quote('osusu_contribution', c.amount);
  v_fee := (q ->> 'fee')::bigint;
  v_wtx := _wallet_tx('osusu_contribution', c.amount, p_user, format('%s — cycle %s contribution', g.name, c.cycle_number),
    jsonb_build_object('group_id', g.id, 'fee', v_fee, 'metadata', jsonb_build_object('contribution_id', c.id, 'mandate_id', p_mandate)));
  update wallet_transactions set fee_snapshot = q where id = v_wtx;
  v_lines := jsonb_build_array(
    jsonb_build_object('account', ensure_wallet(p_user), 'direction', 'debit', 'amount', c.amount + v_fee),
    jsonb_build_object('account', _system_account('osusu_pool'), 'direction', 'credit', 'amount', c.amount));
  if v_fee > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', _system_account('fees'), 'direction', 'credit', 'amount', v_fee)); end if;
  perform _wallet_post(v_wtx, v_lines);
  select reference into v_ref from wallet_transactions where id = v_wtx;
  insert into payment_attempts (reference, user_id, purpose, target_id, amount, status, channel, gateway_response, paid_at, verified_at, metadata)
  values (v_ref, p_user, 'osusu_contribution', c.id, c.amount, 'success', 'wallet', 'ACHIEVER Wallet', now(), now(),
          jsonb_build_object('funding', 'wallet', 'wallet_transaction_id', v_wtx, 'mandate_id', p_mandate, 'fee', v_fee))
  returning * into a;
  v_res := _apply_osusu_contribution(a, now());
  update payment_attempts set transaction_id = (v_res ->> 'transaction_id')::uuid where id = a.id;
  return v_res || jsonb_build_object('wallet_transaction_id', v_wtx, 'fee', v_fee);
end $$;

create or replace function public.wallet_pay_collector_savings(p_user uuid, p_plan uuid, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s     collector_savers%rowtype;
  v_wtx uuid;
  v_ref text;
  a     payment_attempts%rowtype;
  v_res jsonb;
  q     jsonb;
  v_fee bigint;
  v_lines jsonb;
begin
  if p_amount is null or p_amount < 10000 then perform app_error(400, 'AMOUNT_TOO_LOW', 'The minimum deposit is ₦100'); end if;
  select * into s from collector_savers where id = p_plan for update;
  if not found or s.saver_id <> p_user or s.status not in ('active','matured','return_requested') then
    perform app_error(404, 'PLAN_NOT_FOUND', 'Savings plan not found or not accepting deposits');
  end if;
  q := fee_quote('collector_savings', p_amount);
  v_fee := (q ->> 'fee')::bigint;
  v_wtx := _wallet_tx('collector_savings', p_amount, p_user, 'Savings deposit: ' || s.plan_name,
    jsonb_build_object('fee', v_fee, 'metadata', jsonb_build_object('plan_id', s.id)));
  update wallet_transactions set fee_snapshot = q where id = v_wtx;
  v_lines := jsonb_build_array(
    jsonb_build_object('account', ensure_wallet(p_user), 'direction', 'debit', 'amount', p_amount + v_fee),
    jsonb_build_object('account', _system_account('collector_pool'), 'direction', 'credit', 'amount', p_amount));
  if v_fee > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', _system_account('fees'), 'direction', 'credit', 'amount', v_fee)); end if;
  perform _wallet_post(v_wtx, v_lines);
  select reference into v_ref from wallet_transactions where id = v_wtx;
  insert into payment_attempts (reference, user_id, purpose, target_id, amount, status, channel, gateway_response, paid_at, verified_at, metadata)
  values (v_ref, p_user, 'collector_savings', s.id, p_amount, 'success', 'wallet', 'ACHIEVER Wallet', now(), now(),
          jsonb_build_object('funding', 'wallet', 'wallet_transaction_id', v_wtx, 'fee', v_fee))
  returning * into a;
  v_res := _apply_collector_savings(a, now());
  if v_res ->> 'outcome' <> 'applied' then perform app_error(409, 'DEPOSIT_NOT_APPLIED', 'This deposit could not be recorded'); end if;
  update payment_attempts set transaction_id = (v_res ->> 'transaction_id')::uuid where id = a.id;
  return v_res || jsonb_build_object('wallet_transaction_id', v_wtx, 'fee', v_fee);
end $$;

-- ---------------------------------------------------------------------
-- 4. Wallet → bank transfers
-- ---------------------------------------------------------------------
create table public.wallet_bank_transfers (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,
  user_id             uuid not null references public.profiles(id),
  wallet_id           uuid not null references public.wallet_accounts(id),
  bank_code           text not null check (bank_code ~ '^[A-Za-z0-9-]{2,20}$'),
  bank_name           text not null check (char_length(bank_name) <= 120),
  account_number      text not null check (account_number ~ '^\d{10}$'),
  account_name        text not null check (char_length(account_name) between 2 and 120),   -- as verified with the bank
  recipient_code      text,
  amount              bigint not null check (amount > 0),
  fee                 bigint not null default 0 check (fee >= 0),
  total_debit         bigint not null check (total_debit > 0),
  recipient_amount    bigint not null check (recipient_amount > 0),
  fee_snapshot        jsonb not null,
  narration           text check (char_length(narration) <= 100),
  status              text not null default 'INITIATED' check (status in ('INITIATED','PENDING','PROCESSING','SUCCESS','FAILED','REVERSED','REFUNDED','CANCELLED')),
  execution_mode      text not null default 'paystack_transfer' check (execution_mode in ('paystack_transfer','manual')),
  idempotency_key     text,
  auth_method         text,
  auth_challenge_id   uuid,
  authorized_at       timestamptz,
  debit_transaction_id  uuid references public.wallet_transactions(id),
  refund_transaction_id uuid references public.wallet_transactions(id),
  transfer_code       text,
  provider_reference  text,
  provider_status     text check (char_length(provider_status) <= 40),
  provider_cost       bigint check (provider_cost is null or provider_cost >= 0),
  provider_cost_estimated boolean not null default false,
  failure_reason      text check (char_length(failure_reason) <= 300),
  processed_by        uuid references public.profiles(id),
  manual_reference    text check (char_length(manual_reference) <= 120),
  attempts            int not null default 0,
  last_checked_at     timestamptz,
  expires_at          timestamptz not null default now() + interval '15 minutes',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz,
  check (total_debit = amount + fee or (total_debit = amount and recipient_amount = amount - fee))
);
create index wallet_bank_transfers_user_idx on public.wallet_bank_transfers (user_id, created_at desc);
create index wallet_bank_transfers_open_idx on public.wallet_bank_transfers (status, updated_at) where status in ('PENDING','PROCESSING');
create unique index wallet_bank_transfers_idem_idx on public.wallet_bank_transfers (user_id, idempotency_key) where idempotency_key is not null;
create trigger wallet_bank_transfers_updated_at before update on public.wallet_bank_transfers for each row execute function public.set_updated_at();

create or replace function public.price_bank_transfer() returns trigger
language plpgsql security definer set search_path = public as $$
declare q jsonb;
begin
  q := fee_quote('bank_transfer', new.amount);
  new.fee := (q ->> 'fee')::bigint;
  new.total_debit := (q ->> 'total_debit')::bigint;
  new.recipient_amount := (q ->> 'recipient_amount')::bigint;
  new.fee_snapshot := q;
  new.status := 'INITIATED';
  return new;
end $$;
create trigger wallet_bank_transfers_price before insert on public.wallet_bank_transfers
  for each row execute function public.price_bank_transfer();

-- Money and recipient never change after review; statuses only move forward.
create or replace function public.guard_bank_transfer() returns trigger
language plpgsql as $$
declare allowed text[];
begin
  if tg_op = 'DELETE' then raise exception 'ACH:409:BANK_TRANSFER_IMMUTABLE:Bank transfers cannot be deleted'; end if;
  if (new.reference, new.user_id, new.wallet_id, new.bank_code, new.account_number, new.account_name, new.amount, new.fee,
      new.total_debit, new.recipient_amount, new.fee_snapshot)
     is distinct from
     (old.reference, old.user_id, old.wallet_id, old.bank_code, old.account_number, old.account_name, old.amount, old.fee,
      old.total_debit, old.recipient_amount, old.fee_snapshot) then
    raise exception 'ACH:409:BANK_TRANSFER_IMMUTABLE:Transfer details cannot be changed after review';
  end if;
  if new.status <> old.status then
    allowed := case old.status
      when 'INITIATED'  then array['PENDING','CANCELLED']
      when 'PENDING'    then array['PROCESSING','SUCCESS','FAILED','REFUNDED']
      when 'PROCESSING' then array['SUCCESS','FAILED','REVERSED']
      when 'SUCCESS'    then array['REVERSED']
      else array[]::text[] end;
    if not new.status = any(allowed) then
      raise exception 'ACH:409:BANK_TRANSFER_STATUS:Bank transfer cannot move from % to %', old.status, new.status;
    end if;
  end if;
  return new;
end $$;
create trigger wallet_bank_transfers_guard before update or delete on public.wallet_bank_transfers
  for each row execute function public.guard_bank_transfer();

/**
 * Debit the wallet for an authorised bank transfer (once). Balance, limits and
 * status are checked under row locks: two transfers can never both spend the
 * same money.
 */
create or replace function public.wallet_bank_transfer_debit(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x      wallet_bank_transfers%rowtype;
  w      wallet_accounts%rowtype;
  v_today bigint;
  v_wtx  uuid;
  v_lines jsonb;
begin
  select * into x from wallet_bank_transfers where id = p_id for update;
  if not found then perform app_error(404, 'TRANSFER_NOT_FOUND', 'Transfer not found'); end if;
  if x.status <> 'INITIATED' then return jsonb_build_object('outcome', 'already_debited', 'status', x.status); end if;
  if x.authorized_at is null then perform app_error(409, 'TRANSFER_NOT_AUTHORISED', 'This transfer has not been approved'); end if;
  if x.expires_at < now() then
    update wallet_bank_transfers set status = 'CANCELLED', failure_reason = 'Review expired' where id = x.id;
    perform app_error(409, 'TRANSFER_EXPIRED', 'This transfer review expired. Start again.');
  end if;
  if setting_bigint('wallet.bank_transfers_enabled', 1) = 0 then
    perform app_error(503, 'BANK_TRANSFERS_DISABLED', 'Bank transfers are temporarily unavailable');
  end if;
  if x.amount > setting_bigint('wallet.bank_transfer_single_max_kobo', 20000000) then
    perform app_error(422, 'TRANSFER_TOO_LARGE', 'This amount is above your single bank transfer limit');
  end if;
  perform 1 from wallet_accounts where id = x.wallet_id for update;
  select coalesce(sum(amount), 0) into v_today from wallet_bank_transfers
   where user_id = x.user_id and status in ('PENDING','PROCESSING','SUCCESS')
     and created_at >= (date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos');
  if v_today + x.amount > setting_bigint('wallet.bank_transfer_daily_max_kobo', 50000000) then
    perform app_error(422, 'DAILY_LIMIT_REACHED', 'This transfer would exceed your daily bank transfer limit');
  end if;
  select * into w from wallet_accounts where id = x.wallet_id;
  if w.balance - w.held < x.total_debit then
    perform app_error(409, 'INSUFFICIENT_FUNDS', 'Insufficient balance. Your ACHIEVER Wallet does not have enough for this transfer and its fee.');
  end if;

  v_wtx := _wallet_tx('bank_transfer', x.recipient_amount, x.user_id, format('Bank transfer to %s · %s', x.account_name, x.bank_name),
    jsonb_build_object('fee', x.fee, 'idempotency_key', x.idempotency_key,
      'metadata', jsonb_build_object('bank_transfer_id', x.id, 'reference', x.reference, 'bank', x.bank_name,
        'account', '******' || right(x.account_number, 4), 'total_debit', x.total_debit)));
  update wallet_transactions set fee_snapshot = x.fee_snapshot where id = v_wtx;
  v_lines := jsonb_build_array(
    jsonb_build_object('account', x.wallet_id, 'direction', 'debit', 'amount', x.total_debit),
    jsonb_build_object('account', _system_account('payout_clearing'), 'direction', 'credit', 'amount', x.recipient_amount));
  if x.fee > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', _system_account('fees'), 'direction', 'credit', 'amount', x.fee)); end if;
  perform _wallet_post(v_wtx, v_lines);
  update wallet_bank_transfers set status = 'PENDING', debit_transaction_id = v_wtx,
         execution_mode = case when setting_bigint('wallet.bank_transfers_automatic', 1) = 1 then execution_mode else 'manual' end
   where id = x.id;
  perform audit_event(x.user_id, 'wallet.bank_transfer.debited', 'wallet_bank_transfer', x.id::text, 'success',
    jsonb_build_object('amount', x.amount, 'fee', x.fee, 'bank', x.bank_name, 'account', '******' || right(x.account_number, 4)));
  return jsonb_build_object('outcome', 'debited', 'wallet_transaction_id', v_wtx);
end $$;

create or replace function public.wallet_bank_transfer_processing(p_id uuid, p_transfer_code text, p_provider_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update wallet_bank_transfers set status = 'PROCESSING', transfer_code = coalesce(p_transfer_code, transfer_code),
         provider_status = left(p_provider_status, 40), attempts = attempts + 1
   where id = p_id and status = 'PENDING';
end $$;

/** Provider (or finance admin, for manual payouts) confirmed the bank received the money. */
create or replace function public.wallet_bank_transfer_complete(p_id uuid, p_provider_reference text, p_provider_cost bigint,
  p_cost_estimated boolean default false, p_actor uuid default null, p_manual_reference text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x     wallet_bank_transfers%rowtype;
  v_wtx uuid;
begin
  select * into x from wallet_bank_transfers where id = p_id for update;
  if not found then perform app_error(404, 'TRANSFER_NOT_FOUND', 'Transfer not found'); end if;
  if x.status = 'SUCCESS' then return jsonb_build_object('outcome', 'already_final', 'status', x.status); end if;
  if x.status not in ('PENDING','PROCESSING') then perform app_error(409, 'TRANSFER_NOT_OPEN', 'This transfer is already final'); end if;
  -- The money left ACHIEVER's provider balance.
  v_wtx := _wallet_tx('bank_transfer', x.recipient_amount, null, 'Bank payout settled: ' || x.reference,
    jsonb_build_object('metadata', jsonb_build_object('bank_transfer_id', x.id, 'settlement', true)));
  perform _wallet_post(v_wtx, jsonb_build_array(
    jsonb_build_object('account', _system_account('payout_clearing'), 'direction', 'debit', 'amount', x.recipient_amount),
    jsonb_build_object('account', _system_account('paystack_clearing'), 'direction', 'credit', 'amount', x.recipient_amount)));
  update wallet_bank_transfers set status = 'SUCCESS', completed_at = now(), provider_status = 'success',
         provider_reference = coalesce(p_provider_reference, provider_reference), provider_cost = coalesce(p_provider_cost, provider_cost),
         provider_cost_estimated = p_cost_estimated, processed_by = coalesce(p_actor, processed_by),
         manual_reference = coalesce(p_manual_reference, manual_reference)
   where id = x.id;
  perform enqueue_notification(x.user_id, 'bank_transfer_success', 'payments', 'Bank transfer successful',
    format('%s was sent to %s (%s).', fmt_naira(x.recipient_amount), x.account_name, x.bank_name),
    jsonb_build_object('bank_transfer_id', x.id), 'wbt_ok:' || x.id);
  perform audit_event(p_actor, 'wallet.bank_transfer.success', 'wallet_bank_transfer', x.id::text, 'success',
    jsonb_build_object('provider_reference', p_provider_reference, 'manual_reference', p_manual_reference));
  return jsonb_build_object('outcome', 'success');
end $$;

/**
 * Failed / reversed / refunded: the full debit (amount and fee) returns to the wallet.
 *   FAILED   : the provider rejected it (or initiation failed)
 *   REVERSED : the bank returned the money (even after a success)
 *   REFUNDED : finance cancelled a manual payout that was never sent
 */
create or replace function public.wallet_bank_transfer_fail(p_id uuid, p_status text, p_reason text, p_actor uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x     wallet_bank_transfers%rowtype;
  v_wtx uuid;
  v_from text;
  v_lines jsonb;
begin
  if p_status not in ('FAILED','REVERSED','REFUNDED') then perform app_error(400, 'INVALID_STATUS', 'Invalid status'); end if;
  select * into x from wallet_bank_transfers where id = p_id for update;
  if not found then perform app_error(404, 'TRANSFER_NOT_FOUND', 'Transfer not found'); end if;
  if x.status in ('FAILED','REVERSED','REFUNDED','CANCELLED') then return jsonb_build_object('outcome', 'already_final', 'status', x.status); end if;
  if x.status = 'INITIATED' then
    update wallet_bank_transfers set status = 'CANCELLED', failure_reason = left(p_reason, 300) where id = x.id;
    return jsonb_build_object('outcome', 'cancelled');
  end if;
  if x.status = 'SUCCESS' and p_status <> 'REVERSED' then perform app_error(409, 'TRANSFER_FINAL', 'A completed transfer can only be reversed'); end if;
  v_from := case when x.status = 'SUCCESS' then 'paystack_clearing' else 'payout_clearing' end;
  v_wtx := _wallet_tx('refund', x.recipient_amount, x.user_id, 'Refund: bank transfer ' || lower(p_status),
    jsonb_build_object('fee', x.fee, 'reverses_id', x.debit_transaction_id,
      'metadata', jsonb_build_object('bank_transfer_id', x.id, 'reason', left(p_reason, 200), 'refund_total', x.total_debit)));
  v_lines := jsonb_build_array(
    jsonb_build_object('account', _system_account(v_from), 'direction', 'debit', 'amount', x.recipient_amount),
    jsonb_build_object('account', x.wallet_id, 'direction', 'credit', 'amount', x.total_debit));
  if x.fee > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', _system_account('fees'), 'direction', 'debit', 'amount', x.fee)); end if;
  perform _wallet_post(v_wtx, v_lines);
  update wallet_bank_transfers set status = p_status, failure_reason = left(p_reason, 300), refund_transaction_id = v_wtx,
         completed_at = now(), processed_by = coalesce(p_actor, processed_by)
   where id = x.id;
  perform enqueue_notification(x.user_id, 'bank_transfer_failed', 'payments',
    case when p_status = 'REVERSED' then 'Bank transfer reversed' else 'Bank transfer not completed' end,
    format('Your transfer of %s to %s was not completed. %s (including the fee) is back in your ACHIEVER Wallet.',
      fmt_naira(x.recipient_amount), x.account_name, fmt_naira(x.total_debit)),
    jsonb_build_object('bank_transfer_id', x.id), 'wbt_fail:' || x.id);
  perform audit_event(p_actor, 'wallet.bank_transfer.' || lower(p_status), 'wallet_bank_transfer', x.id::text, 'success',
    jsonb_build_object('reason', left(p_reason, 200)));
  return jsonb_build_object('outcome', lower(p_status), 'refund_transaction_id', v_wtx);
end $$;

-- ---------------------------------------------------------------------
-- 5. Fee revenue reporting
-- ---------------------------------------------------------------------
create or replace function public.fee_revenue_report(p_from timestamptz default null, p_to timestamptz default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with win as (select coalesce(p_from, '-infinity'::timestamptz) f, coalesce(p_to, 'infinity'::timestamptz) t),
  wallet_fees as (
    -- Fees posted to the ACHIEVER fees account (credits = collected, debits = refunded with the transaction).
    select case
             when wt.type in ('osusu_contribution','collector_savings') then 'osusu'
             when wt.type = 'bill_payment' or (wt.type = 'refund' and wt.bill_payment_id is not null) then 'bills'
             when wt.type = 'bank_transfer' or (wt.type = 'refund' and wt.metadata ? 'bank_transfer_id') then 'bank_transfer'
             when wt.type in ('topup','reversal') then 'wallet_topup'
             when wt.type = 'transfer' then 'wallet_transfer'
             else 'other' end as category,
           sum(case when e.direction = 'credit' then e.amount else 0 end) collected,
           sum(case when e.direction = 'debit' then e.amount else 0 end) refunded
      from wallet_ledger_entries e
      join wallet_transactions wt on wt.id = e.transaction_id, win
     where e.account_id = _system_account('fees') and e.created_at >= win.f and e.created_at < win.t
     group by 1
  ),
  card_bills as (
    -- Bills paid by card: the fee was charged on Paystack.
    select 'bills'::text as category,
           coalesce(sum(fee) filter (where status in ('paid','processing','delivered')), 0) collected,
           coalesce(sum(fee) filter (where status in ('refund_pending','refunded','reversed')), 0) refunded
      from bill_payments, win
     where funding_source = 'paystack' and coalesce(completed_at, created_at) >= win.f and coalesce(completed_at, created_at) < win.t
  ),
  volume as (
    select case
             when type in ('osusu_contribution','collector_savings') then 'osusu'
             when type = 'bill_payment' then 'bills'
             when type = 'bank_transfer' then 'bank_transfer'
             when type = 'topup' then 'wallet_topup'
             when type = 'transfer' then 'wallet_transfer'
             else 'other' end as category,
           sum(amount) amount, count(*) n
      from wallet_transactions, win
     where status = 'success' and user_id is not null and created_at >= win.f and created_at < win.t
       and type in ('osusu_contribution','collector_savings','bill_payment','bank_transfer','topup','transfer')
     group by 1
  ),
  all_fees as (
    select category, sum(collected) collected, sum(refunded) refunded from (
      select * from wallet_fees union all select * from card_bills) u group by 1
  ),
  bank_cost as (
    select coalesce(sum(provider_cost), 0) cost from wallet_bank_transfers, win
     where status = 'SUCCESS' and completed_at >= win.f and completed_at < win.t
  )
  select jsonb_build_object(
    'fees_collected', coalesce((select sum(collected) from all_fees), 0),
    'fees_refunded',  coalesce((select sum(refunded) from all_fees), 0),
    'net_fees',       coalesce((select sum(collected - refunded) from all_fees), 0),
    'bank_provider_cost', (select cost from bank_cost),
    'net_after_provider_cost', coalesce((select sum(collected - refunded) from all_fees), 0) - (select cost from bank_cost),
    'gross_volume',   coalesce((select sum(amount) from volume), 0)
      + coalesce((select sum(amount) from bill_payments, win where funding_source = 'paystack' and status = 'delivered'
                   and coalesce(completed_at, created_at) >= win.f and coalesce(completed_at, created_at) < win.t), 0),
    'by_category', coalesce((select jsonb_object_agg(c.category, jsonb_build_object(
        'collected', coalesce(f.collected, 0), 'refunded', coalesce(f.refunded, 0), 'net', coalesce(f.collected, 0) - coalesce(f.refunded, 0),
        'volume', coalesce(v.amount, 0), 'count', coalesce(v.n, 0)))
      from (select category from all_fees union select category from volume) c
      left join all_fees f on f.category = c.category
      left join volume v on v.category = c.category), '{}'::jsonb))
$$;

alter table public.transaction_auth_challenges drop constraint if exists transaction_auth_challenges_purpose_check;
alter table public.transaction_auth_challenges add constraint transaction_auth_challenges_purpose_check
  check (purpose in ('bill_payment','wallet_transfer','wallet_mandate','wallet_payment','wallet_bank_transfer'));
alter table public.risk_flags drop constraint if exists risk_flags_reason_code_check;
alter table public.risk_flags add constraint risk_flags_reason_code_check check (reason_code in (
  'post_payout_default','payment_overdue','amount_mismatch','duplicate_payment','large_transaction',
  'repeated_failed_payments','early_return_request','repeated_complaints','manual',
  'collector_settlement_delay','payment_account_change','kyc_failure',
  'wallet_negative_after_reversal','wallet_large_transfer','wallet_transfer_velocity','wallet_new_recipient_large',
  'bank_transfer_reversed_after_success'));

-- ---------------------------------------------------------------------
-- 6. Settings, permissions, RLS
-- ---------------------------------------------------------------------
alter table public.app_settings drop constraint if exists app_settings_category_check;
alter table public.app_settings add constraint app_settings_category_check check (category in (
  'authentication','verification','sms','email','payments','notifications','security','maintenance',
  'support','registration','kyc','collector_onboarding','transaction_limits','admin','general','bills','referrals','wallet','fees'));

insert into public.app_settings (key, value, description, value_type, category, label, min_value, max_value, options, critical) values
  ('wallet.bank_transfers_enabled', '1', 'Members can send from their wallet to a Nigerian bank account (1 = on, 0 = off)', 'integer', 'wallet', 'Bank transfers', 0, 1, null, true),
  ('wallet.bank_transfers_automatic', '1', '1 = send with Paystack Transfers; 0 = queue for manual payout by finance', 'integer', 'wallet', 'Automatic bank payouts', 0, 1, null, true),
  ('wallet.bank_transfer_min_kobo', '10000', 'Smallest bank transfer (kobo)', 'integer', 'wallet', 'Minimum bank transfer (kobo)', 100, null, null, false),
  ('wallet.bank_transfer_single_max_kobo', '20000000', 'Largest single bank transfer (kobo)', 'integer', 'wallet', 'Single bank transfer limit (kobo)', 10000, 1000000000, null, true),
  ('wallet.bank_transfer_daily_max_kobo', '50000000', 'Total bank transfers per day (kobo)', 'integer', 'wallet', 'Daily bank transfer limit (kobo)', 10000, 5000000000, null, true),
  ('fees.require_second_approver', '1', 'Fee changes need approval by a different administrator (1 = yes)', 'integer', 'fees', 'Two-person fee approval', 0, 1, null, true)
on conflict (key) do nothing;
-- The internal transfer fee is now managed in Fees & Charges.
update public.app_settings set description = 'Superseded: use Admin → Fees & Charges (wallet_transfer)' where key = 'wallet.transfer_fee_kobo';
update public.app_settings set description = 'Superseded: use Admin → Fees & Charges (bill_* services)' where key = 'bills.fee_kobo';

insert into public.permissions (code, description) values
  ('fees.read',    'See fee configurations, history and fee revenue'),
  ('fees.manage',  'Propose fee changes (create, edit, schedule, disable)'),
  ('fees.approve', 'Approve or reject fee changes proposed by another administrator'),
  ('wallet.payouts', 'Process manual bank payouts from wallets (mark sent or refund)')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code)
select 'SUPER_ADMIN', code from public.permissions on conflict do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('ADMIN','fees.read'), ('FINANCE_ADMIN','fees.read'), ('FINANCE_ADMIN','fees.manage'), ('FINANCE_ADMIN','fees.approve'),
  ('FINANCE_ADMIN','wallet.payouts'), ('COMPLIANCE_ADMIN','fees.read'), ('AUDITOR','fees.read')
on conflict do nothing;

do $$
declare t text;
begin
  foreach t in array array['wallet_account_aliases','fee_configurations','wallet_bank_transfers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select, insert, update on public.%I to service_role', t);
  end loop;
end $$;
revoke all on public.wallet_account_aliases from authenticated;
grant select on public.fee_configurations, public.wallet_bank_transfers to authenticated;
-- Members may read the fees in force (transparency) and their own bank transfers.
create policy fee_configurations_read_approved on public.fee_configurations for select to authenticated using (status = 'APPROVED');
create policy wallet_bank_transfers_own on public.wallet_bank_transfers for select to authenticated using (user_id = auth.uid());

revoke execute on function
  public._wallet_code(), public.guard_wallet_code(), public.ensure_wallet(uuid), public.resolve_wallet_code(text),
  public.guard_fee_configuration(), public.active_fee_configuration(text, timestamptz), public.fee_quote(text, bigint, timestamptz),
  public.propose_fee_configuration(uuid, jsonb), public.decide_fee_configuration(uuid, uuid, boolean, text), public.cancel_fee_configuration(uuid, uuid),
  public.price_wallet_transfer(), public._wallet_transfer_post(wallet_transfers), public.wallet_execute_transfer(uuid),
  public.wallet_review_transfer(uuid, uuid, boolean, text), public.price_wallet_topup(), public._apply_wallet_topup(payment_attempts, timestamptz),
  public.wallet_reverse_topup(uuid, text, text), public.price_bill_payment(), public.wallet_pay_bill(uuid), public._bill_refund(bill_payments, text),
  public.wallet_pay_osusu_contribution(uuid, uuid, uuid), public.wallet_pay_collector_savings(uuid, uuid, bigint),
  public.price_bank_transfer(), public.guard_bank_transfer(), public.wallet_bank_transfer_debit(uuid),
  public.wallet_bank_transfer_processing(uuid, text, text), public.wallet_bank_transfer_complete(uuid, text, bigint, boolean, uuid, text),
  public.wallet_bank_transfer_fail(uuid, text, text, uuid), public.fee_revenue_report(timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
