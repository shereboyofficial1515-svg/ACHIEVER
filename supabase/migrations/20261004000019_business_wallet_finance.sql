-- =====================================================================
-- ACHIEVER — Business wallet (platform revenue), company payout account,
-- business withdrawals, provider float tracking and the finance overview.
--
-- Accounting (existing double-entry ledger, credit = balance up):
--   user wallets           customer money (a liability: it belongs to members)
--   fees (SYS-FEES)        ACHIEVER fee revenue  ← the ONLY source of business withdrawals
--   osusu_pool / collector_pool / bill_settlement / payout_clearing / paystack_clearing
--                          money in transit or owed to members/providers — never withdrawable
-- A business withdrawal moves revenue fees → payout_clearing (pending at the bank) →
-- paystack_clearing (paid out). A failure or reversal returns it to fees. Nothing is
-- edited in place; every movement is a new balanced ledger transaction.
-- Safe to run once (re-running the CREATE statements will fail loudly, by design).
-- =====================================================================

-- 1. A ledger transaction type for business withdrawals ----------------------------------
alter table public.wallet_transactions drop constraint if exists wallet_transactions_type_check;
alter table public.wallet_transactions add constraint wallet_transactions_type_check check (type in (
  'topup','transfer','bill_payment','osusu_contribution','collector_savings','refund','reversal','referral_reward','fee','adjustment',
  'bank_transfer','business_withdrawal'));

-- 2. The company's payout account (verified with the bank; second admin + cooling-off) -------
create table public.business_bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  bank_code       text not null check (bank_code ~ '^[A-Za-z0-9-]{2,20}$'),
  bank_name       text not null check (char_length(bank_name) <= 120),
  account_number  text not null check (account_number ~ '^\d{10}$'),
  account_name    text not null check (char_length(account_name) between 2 and 120),   -- as returned by the bank
  recipient_code  text,
  status          text not null default 'pending_approval' check (status in ('pending_approval','active','revoked','rejected')),
  reason          text not null check (char_length(reason) between 10 and 300),
  added_by        uuid not null references public.profiles(id),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  active_from     timestamptz,                                   -- usable after the cooling-off period
  revoked_by      uuid references public.profiles(id),
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (approved_by is null or approved_by <> added_by)
);
create unique index business_bank_accounts_one_active on public.business_bank_accounts ((true)) where status = 'active';
create trigger business_bank_accounts_updated_at before update on public.business_bank_accounts for each row execute function public.set_updated_at();

-- 3. Business withdrawals ------------------------------------------------------------------
create table public.business_withdrawals (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique,
  bank_account_id       uuid not null references public.business_bank_accounts(id),
  amount                bigint not null check (amount > 0),
  reason                text not null check (char_length(reason) between 10 and 300),
  status                text not null check (status in ('PENDING_APPROVAL','PENDING','PROCESSING','SUCCESS','FAILED','REVERSED','REJECTED','CANCELLED')),
  requested_by          uuid not null references public.profiles(id),
  approved_by           uuid references public.profiles(id),
  approved_at           timestamptz,
  decision_note         text check (char_length(decision_note) <= 300),
  idempotency_key       text,
  transfer_code         text,
  provider_status       text check (char_length(provider_status) <= 40),
  failure_reason        text check (char_length(failure_reason) <= 300),
  debit_transaction_id  uuid references public.wallet_transactions(id),
  refund_transaction_id uuid references public.wallet_transactions(id),
  attempts              int not null default 0,
  last_checked_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  completed_at          timestamptz,
  check (approved_by is null or approved_by <> requested_by)
);
create unique index business_withdrawals_idem_idx on public.business_withdrawals (requested_by, idempotency_key) where idempotency_key is not null;
create index business_withdrawals_open_idx on public.business_withdrawals (status, updated_at) where status in ('PENDING','PROCESSING');
create trigger business_withdrawals_updated_at before update on public.business_withdrawals for each row execute function public.set_updated_at();

-- 4. Provider float (VTpass wallet balance) as last read by the health check ----------------
create table public.provider_balances (
  provider         text primary key check (provider in ('vtpass')),
  environment      text check (environment in ('sandbox','production')),
  balance          bigint,
  status           text not null default 'unknown' check (status in ('operational','degraded','unavailable','not_configured','unknown')),
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  last_error       text check (char_length(last_error) <= 300),
  latency_ms       int,
  details          jsonb not null default '{}'::jsonb,
  checked_at       timestamptz not null default now()
);

-- 5. Settings (server-enforced) ------------------------------------------------------------
alter table public.app_settings drop constraint if exists app_settings_category_check;
alter table public.app_settings add constraint app_settings_category_check check (category in (
  'authentication','verification','sms','email','payments','notifications','security','maintenance',
  'support','registration','kyc','collector_onboarding','transaction_limits','admin','general','bills','referrals','wallet','fees','finance'));
insert into public.app_settings (key, value, description, value_type, category, label, min_value, max_value, options, critical) values
  ('business.withdrawal_min_kobo', '100000', 'Smallest business withdrawal (kobo)', 'integer', 'finance', 'Business withdrawal minimum (kobo)', 100, null, null, true),
  ('business.withdrawal_max_kobo', '500000000', 'Largest single business withdrawal (kobo)', 'integer', 'finance', 'Business withdrawal maximum (kobo)', 100, null, null, true),
  ('business.withdrawal_daily_kobo', '1000000000', 'Business withdrawals per day, all admins together (kobo)', 'integer', 'finance', 'Business withdrawal daily limit (kobo)', 100, null, null, true),
  ('business.withdrawal_monthly_kobo', '5000000000', 'Business withdrawals per calendar month (kobo)', 'integer', 'finance', 'Business withdrawal monthly limit (kobo)', 100, null, null, true),
  ('business.withdrawal_dual_approval_kobo', '5000000', 'At or above this amount a second administrator must approve the withdrawal (kobo)', 'integer', 'finance', 'Second approval from (kobo)', 0, null, null, true),
  ('business.bank_account_cooloff_hours', '24', 'Hours before a newly approved company payout account can be used', 'integer', 'finance', 'Payout account cooling-off (hours)', 0, 168, null, true),
  ('vtpass.low_balance_kobo', '5000000', 'Warn admins when the VTpass wallet falls below this (kobo)', 'integer', 'finance', 'VTpass low-balance alert (kobo)', 0, null, null, false)
on conflict (key) do nothing;

create or replace function public._setting_bigint(p_key text, p_default bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::bigint from app_settings where key = p_key), p_default)
$$;

-- 6. Business wallet: what is available ------------------------------------------------------
/** Fee revenue on the books, minus withdrawals waiting for a second approval (reserved). */
create or replace function public.business_available() returns bigint
language sql stable security definer set search_path = public as $$
  select greatest(0, (select balance from wallet_accounts where kind = 'fees')
    - coalesce((select sum(amount) from business_withdrawals where status = 'PENDING_APPROVAL'), 0))
$$;

create or replace function public._business_withdrawal_post(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  x     business_withdrawals%rowtype;
  v_fee wallet_accounts%rowtype;
  v_wtx uuid;
begin
  select * into x from business_withdrawals where id = p_id for update;
  select * into v_fee from wallet_accounts where kind = 'fees' for update;
  -- System accounts may go negative in the generic poster: business withdrawals never may.
  if v_fee.balance < x.amount then perform app_error(409, 'INSUFFICIENT_REVENUE', 'Not enough platform revenue for this withdrawal'); end if;
  v_wtx := _wallet_tx('business_withdrawal', x.amount, null, 'Business withdrawal ' || x.reference,
    jsonb_build_object('created_by', coalesce(x.approved_by, x.requested_by), 'metadata', jsonb_build_object('business_withdrawal_id', x.id)));
  perform _wallet_post(v_wtx, jsonb_build_array(
    jsonb_build_object('account', _system_account('fees'), 'direction', 'debit', 'amount', x.amount),
    jsonb_build_object('account', _system_account('payout_clearing'), 'direction', 'credit', 'amount', x.amount)));
  update business_withdrawals set status = 'PENDING', debit_transaction_id = v_wtx where id = x.id;
end $$;

/** Request a withdrawal of platform revenue to the active company account (limits enforced here). */
create or replace function public.business_withdrawal_request(p_actor uuid, p_amount bigint, p_reason text, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_acct  business_bank_accounts%rowtype;
  v_row   business_withdrawals%rowtype;
  v_day   bigint;
  v_month bigint;
begin
  if p_idempotency_key is not null then
    select * into v_row from business_withdrawals where requested_by = p_actor and idempotency_key = p_idempotency_key;
    if found then return to_jsonb(v_row); end if;
  end if;
  perform 1 from wallet_accounts where kind = 'fees' for update;   -- one withdrawal decision at a time
  select * into v_acct from business_bank_accounts where status = 'active';
  if not found then perform app_error(409, 'NO_PAYOUT_ACCOUNT', 'Add and approve a company payout account first'); end if;
  if v_acct.active_from > now() then perform app_error(409, 'PAYOUT_ACCOUNT_COOLING_OFF', 'The company payout account is in its cooling-off period'); end if;
  if p_amount < _setting_bigint('business.withdrawal_min_kobo', 100000) then perform app_error(400, 'AMOUNT_TOO_LOW', 'Below the minimum business withdrawal'); end if;
  if p_amount > _setting_bigint('business.withdrawal_max_kobo', 500000000) then perform app_error(400, 'AMOUNT_TOO_HIGH', 'Above the maximum single business withdrawal'); end if;
  select coalesce(sum(amount), 0) into v_day from business_withdrawals
   where status not in ('FAILED','REVERSED','REJECTED','CANCELLED') and created_at >= date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  select coalesce(sum(amount), 0) into v_month from business_withdrawals
   where status not in ('FAILED','REVERSED','REJECTED','CANCELLED') and created_at >= date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  if v_day + p_amount > _setting_bigint('business.withdrawal_daily_kobo', 1000000000) then perform app_error(409, 'DAILY_LIMIT', 'This would exceed the daily business withdrawal limit'); end if;
  if v_month + p_amount > _setting_bigint('business.withdrawal_monthly_kobo', 5000000000) then perform app_error(409, 'MONTHLY_LIMIT', 'This would exceed the monthly business withdrawal limit'); end if;
  if business_available() < p_amount then perform app_error(409, 'INSUFFICIENT_REVENUE', 'Not enough platform revenue available for this withdrawal'); end if;

  insert into business_withdrawals (reference, bank_account_id, amount, reason, status, requested_by, idempotency_key)
  values (new_reference('ACH-BWD'), v_acct.id, p_amount, left(p_reason, 300),
          case when p_amount >= _setting_bigint('business.withdrawal_dual_approval_kobo', 5000000) then 'PENDING_APPROVAL' else 'PENDING' end,
          p_actor, p_idempotency_key)
  returning * into v_row;
  if v_row.status = 'PENDING' then perform _business_withdrawal_post(v_row.id); end if;
  perform audit_event(p_actor, 'business.withdrawal.requested', 'business_withdrawal', v_row.id::text, 'success',
    jsonb_build_object('amount', p_amount, 'account', '****' || right(v_acct.account_number, 4), 'needs_approval', v_row.status = 'PENDING_APPROVAL'));
  select * into v_row from business_withdrawals where id = v_row.id;
  return to_jsonb(v_row);
end $$;

/** A DIFFERENT administrator approves (or rejects) a large withdrawal. */
create or replace function public.business_withdrawal_decide(p_id uuid, p_actor uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x business_withdrawals%rowtype;
begin
  select * into x from business_withdrawals where id = p_id for update;
  if not found then perform app_error(404, 'NOT_FOUND', 'Withdrawal not found'); end if;
  if x.status <> 'PENDING_APPROVAL' then perform app_error(409, 'ALREADY_DECIDED', 'This withdrawal has already been decided'); end if;
  if x.requested_by = p_actor then perform app_error(403, 'SELF_APPROVAL_FORBIDDEN', 'A different administrator must approve this withdrawal'); end if;
  update business_withdrawals set approved_by = p_actor, approved_at = now(), decision_note = left(p_note, 300),
         status = case when p_approve then status else 'REJECTED' end where id = x.id;
  if p_approve then perform _business_withdrawal_post(x.id); end if;
  perform audit_event(p_actor, 'business.withdrawal.' || case when p_approve then 'approved' else 'rejected' end, 'business_withdrawal', x.id::text, 'success',
    jsonb_build_object('amount', x.amount, 'note', left(p_note, 200)));
  select * into x from business_withdrawals where id = p_id;
  return to_jsonb(x);
end $$;

create or replace function public.business_withdrawal_cancel(p_id uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update business_withdrawals set status = 'CANCELLED' where id = p_id and status = 'PENDING_APPROVAL' and requested_by = p_actor;
  if not found then perform app_error(409, 'NOT_CANCELLABLE', 'Only your own withdrawal awaiting approval can be cancelled'); end if;
  perform audit_event(p_actor, 'business.withdrawal.cancelled', 'business_withdrawal', p_id::text, 'success', '{}'::jsonb);
end $$;

create or replace function public.business_withdrawal_processing(p_id uuid, p_transfer_code text, p_provider_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update business_withdrawals set status = 'PROCESSING', transfer_code = coalesce(p_transfer_code, transfer_code),
         provider_status = left(p_provider_status, 40), attempts = attempts + 1
   where id = p_id and status = 'PENDING';
end $$;

/** The bank received it (provider confirmed): the cash left ACHIEVER's provider balance. */
create or replace function public.business_withdrawal_complete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x business_withdrawals%rowtype; v_wtx uuid;
begin
  select * into x from business_withdrawals where id = p_id for update;
  if not found then perform app_error(404, 'NOT_FOUND', 'Withdrawal not found'); end if;
  if x.status = 'SUCCESS' then return jsonb_build_object('outcome', 'already_final'); end if;
  if x.status not in ('PENDING','PROCESSING') then perform app_error(409, 'NOT_OPEN', 'This withdrawal is already final'); end if;
  v_wtx := _wallet_tx('business_withdrawal', x.amount, null, 'Business withdrawal settled ' || x.reference,
    jsonb_build_object('metadata', jsonb_build_object('business_withdrawal_id', x.id, 'settlement', true)));
  perform _wallet_post(v_wtx, jsonb_build_array(
    jsonb_build_object('account', _system_account('payout_clearing'), 'direction', 'debit', 'amount', x.amount),
    jsonb_build_object('account', _system_account('paystack_clearing'), 'direction', 'credit', 'amount', x.amount)));
  update business_withdrawals set status = 'SUCCESS', provider_status = 'success', completed_at = now() where id = x.id;
  perform audit_event(null, 'business.withdrawal.success', 'business_withdrawal', x.id::text, 'success', jsonb_build_object('amount', x.amount));
  return jsonb_build_object('outcome', 'success');
end $$;

/** Failed or reversed by the bank: the amount returns to platform revenue (new ledger entry). */
create or replace function public.business_withdrawal_fail(p_id uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x business_withdrawals%rowtype; v_wtx uuid; v_from text;
begin
  if p_status not in ('FAILED','REVERSED') then perform app_error(400, 'INVALID_STATUS', 'Invalid status'); end if;
  select * into x from business_withdrawals where id = p_id for update;
  if not found then perform app_error(404, 'NOT_FOUND', 'Withdrawal not found'); end if;
  if x.status in ('FAILED','REVERSED','REJECTED','CANCELLED') then return jsonb_build_object('outcome', 'already_final'); end if;
  if x.status = 'SUCCESS' and p_status <> 'REVERSED' then perform app_error(409, 'FINAL', 'A completed withdrawal can only be reversed'); end if;
  if x.status = 'PENDING_APPROVAL' then perform app_error(409, 'NOT_SENT', 'This withdrawal was never sent'); end if;
  v_from := case when x.status = 'SUCCESS' then 'paystack_clearing' else 'payout_clearing' end;
  v_wtx := _wallet_tx('business_withdrawal', x.amount, null, 'Business withdrawal returned ' || x.reference,
    jsonb_build_object('reverses_id', x.debit_transaction_id, 'metadata', jsonb_build_object('business_withdrawal_id', x.id, 'reason', left(p_reason, 200))));
  perform _wallet_post(v_wtx, jsonb_build_array(
    jsonb_build_object('account', _system_account(v_from), 'direction', 'debit', 'amount', x.amount),
    jsonb_build_object('account', _system_account('fees'), 'direction', 'credit', 'amount', x.amount)));
  update business_withdrawals set status = p_status, failure_reason = left(p_reason, 300), refund_transaction_id = v_wtx, completed_at = now() where id = x.id;
  perform audit_event(null, 'business.withdrawal.' || lower(p_status), 'business_withdrawal', x.id::text, 'success', jsonb_build_object('reason', left(p_reason, 200)));
  return jsonb_build_object('outcome', lower(p_status));
end $$;

-- 7. Company payout account: propose → a different admin approves → cooling-off ------------
create or replace function public.business_bank_account_decide(p_id uuid, p_actor uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x business_bank_accounts%rowtype;
begin
  select * into x from business_bank_accounts where id = p_id for update;
  if not found then perform app_error(404, 'NOT_FOUND', 'Account not found'); end if;
  if x.status <> 'pending_approval' then perform app_error(409, 'ALREADY_DECIDED', 'This account change has already been decided'); end if;
  if x.added_by = p_actor then perform app_error(403, 'SELF_APPROVAL_FORBIDDEN', 'A different administrator must approve the payout account'); end if;
  if p_approve then
    if exists (select 1 from business_withdrawals where status in ('PENDING_APPROVAL','PENDING','PROCESSING')) then
      perform app_error(409, 'WITHDRAWALS_OPEN', 'Finish or cancel open business withdrawals before changing the payout account');
    end if;
    update business_bank_accounts set status = 'revoked', revoked_by = p_actor, revoked_at = now() where status = 'active';
    update business_bank_accounts set status = 'active', approved_by = p_actor, approved_at = now(),
           active_from = now() + make_interval(hours => _setting_bigint('business.bank_account_cooloff_hours', 24)::int)
     where id = x.id;
  else
    update business_bank_accounts set status = 'rejected', approved_by = p_actor, approved_at = now() where id = x.id;
  end if;
  perform audit_event(p_actor, 'business.payout_account.' || case when p_approve then 'approved' else 'rejected' end, 'business_bank_account', x.id::text, 'success',
    jsonb_build_object('bank', x.bank_name, 'account', '****' || right(x.account_number, 4)));
  select * into x from business_bank_accounts where id = p_id;
  return to_jsonb(x);
end $$;

-- 8. Finance overview (server-side aggregation; no per-user rows leave the database) ---------
create or replace function public.finance_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  with u as (
    select coalesce(sum(balance), 0) as balance, coalesce(sum(held), 0) as held,
           coalesce(sum(balance) filter (where status = 'active'), 0) as active_balance,
           coalesce(sum(balance) filter (where status <> 'active'), 0) as restricted_balance,
           coalesce(sum(greatest(balance - held, 0)) filter (where status = 'active'), 0) as available,
           count(*) as wallets,
           count(*) filter (where balance > 0) as funded_wallets
      from wallet_accounts where kind = 'user'
  ), s as (
    select jsonb_object_agg(kind, balance) as balances from wallet_accounts where kind <> 'user'
  ), bt as (
    select coalesce(sum(recipient_amount) filter (where status in ('PENDING','PROCESSING')), 0) as open_amount,
           count(*) filter (where status in ('PENDING','PROCESSING')) as open_count
      from wallet_bank_transfers
  ), bw as (
    select coalesce(sum(amount) filter (where status = 'PENDING_APPROVAL'), 0) as awaiting_approval,
           coalesce(sum(amount) filter (where status in ('PENDING','PROCESSING')), 0) as in_progress,
           coalesce(sum(amount) filter (where status = 'SUCCESS'), 0) as withdrawn,
           coalesce(sum(amount) filter (where status in ('FAILED','REVERSED')), 0) as returned
      from business_withdrawals
  ), bills as (
    select coalesce(sum(commission_amount) filter (where status = 'delivered'), 0) as commission,
           coalesce(sum(provider_cost) filter (where status = 'delivered'), 0) as provider_cost,
           count(*) filter (where status in ('paid','processing')) as open_count
      from bill_payments
  )
  select jsonb_build_object(
    'customer', jsonb_build_object('balance', u.balance, 'held', u.held, 'activeBalance', u.active_balance,
      'restrictedBalance', u.restricted_balance, 'available', u.available, 'wallets', u.wallets, 'fundedWallets', u.funded_wallets),
    'system', s.balances,
    'bankTransfers', jsonb_build_object('openAmount', bt.open_amount, 'openCount', bt.open_count),
    'business', jsonb_build_object('revenueBalance', (s.balances ->> 'fees')::bigint, 'available', business_available(),
      'awaitingApproval', bw.awaiting_approval, 'inProgress', bw.in_progress, 'withdrawn', bw.withdrawn, 'returned', bw.returned),
    'bills', jsonb_build_object('vtpassCommission', bills.commission, 'providerCost', bills.provider_cost, 'openCount', bills.open_count),
    'computedAt', now())
  from u, s, bt, bw, bills
$$;

-- 9. Permissions --------------------------------------------------------------------------------
insert into public.permissions (code, description) values
  ('business.read',     'See the business wallet, finance overview, provider float and business withdrawals'),
  ('business.withdraw', 'Request withdrawals of platform revenue to the company payout account'),
  ('business.approve',  'Approve or reject business withdrawals and payout-account changes proposed by another administrator'),
  ('business.accounts', 'Propose the company payout account'),
  ('providers.check',   'Run provider health checks (no purchases)')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code)
select 'SUPER_ADMIN', code from public.permissions on conflict do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('FINANCE_ADMIN','business.read'), ('FINANCE_ADMIN','business.withdraw'), ('FINANCE_ADMIN','business.approve'),
  ('FINANCE_ADMIN','business.accounts'), ('FINANCE_ADMIN','providers.check'),
  ('AUDITOR','business.read'), ('COMPLIANCE_ADMIN','business.read'), ('ADMIN','providers.check')
on conflict do nothing;

-- 10. Access: API (service role) only ----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['business_bank_accounts','business_withdrawals','provider_balances'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to service_role', t);
  end loop;
end $$;
revoke execute on function
  public._setting_bigint(text, bigint), public.business_available(), public._business_withdrawal_post(uuid),
  public.business_withdrawal_request(uuid, bigint, text, text), public.business_withdrawal_decide(uuid, uuid, boolean, text),
  public.business_withdrawal_cancel(uuid, uuid), public.business_withdrawal_processing(uuid, text, text),
  public.business_withdrawal_complete(uuid), public.business_withdrawal_fail(uuid, text, text),
  public.business_bank_account_decide(uuid, uuid, boolean), public.finance_overview()
from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
