-- =====================================================================
-- ACHIEVER — internal wallet (double-entry ledger).
--
-- * Every user has exactly one wallet account (ACHW-XXXXXXXX). It is an
--   INTERNAL ACHIEVER identifier, not a bank account number.
-- * Money moves only through _wallet_post(): a balanced set of debit/credit
--   lines across wallet accounts, posted atomically with row locks (no double
--   spending), producing immutable ledger entries. wallet_accounts.balance is
--   a projection maintained only by _wallet_post.
-- * System accounts (Paystack clearing, bill settlement, fees, OSUSU pool,
--   rewards, adjustments) hold the other side of every movement.
-- * Browser roles can read their own rows (RLS) and write nothing.
-- =====================================================================

alter table public.app_settings drop constraint if exists app_settings_category_check;
alter table public.app_settings add constraint app_settings_category_check check (category in (
  'authentication','verification','sms','email','payments','notifications','security','maintenance',
  'support','registration','kyc','collector_onboarding','transaction_limits','admin','general','bills','referrals','wallet'));

alter table public.risk_flags drop constraint if exists risk_flags_reason_code_check;
alter table public.risk_flags add constraint risk_flags_reason_code_check check (reason_code in (
  'post_payout_default','payment_overdue','amount_mismatch','duplicate_payment','large_transaction',
  'repeated_failed_payments','early_return_request','repeated_complaints','manual',
  'collector_settlement_delay','payment_account_change','kyc_failure',
  'wallet_negative_after_reversal','wallet_large_transfer','wallet_transfer_velocity','wallet_new_recipient_large'));

-- ---------------------------------------------------------------------
-- 1. Accounts, transactions, ledger
-- ---------------------------------------------------------------------
create table public.wallet_accounts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('user','paystack_clearing','bill_settlement','fees','osusu_pool','collector_pool','rewards','adjustments')),
  user_id     uuid unique references public.profiles(id),
  wallet_code text not null unique,
  status      text not null default 'active' check (status in ('active','frozen','closed')),
  status_reason text check (char_length(status_reason) <= 300),
  balance     bigint not null default 0,
  held        bigint not null default 0 check (held >= 0),
  currency    char(3) not null default 'NGN',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((kind = 'user') = (user_id is not null)),
  check (kind <> 'user' or wallet_code ~ '^ACHW-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$')
);
create unique index wallet_accounts_system_kind_idx on public.wallet_accounts (kind) where kind <> 'user';
create trigger wallet_accounts_updated_at before update on public.wallet_accounts for each row execute function public.set_updated_at();

insert into public.wallet_accounts (kind, wallet_code) values
  ('paystack_clearing', 'SYS-PAYSTACK'), ('bill_settlement', 'SYS-BILLS'), ('fees', 'SYS-FEES'),
  ('osusu_pool', 'SYS-OSUSU'), ('collector_pool', 'SYS-COLLECTOR'), ('rewards', 'SYS-REWARDS'), ('adjustments', 'SYS-ADJUST')
on conflict do nothing;

create table public.wallet_transactions (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,
  type              text not null check (type in ('topup','transfer','bill_payment','osusu_contribution','collector_savings','refund','reversal','referral_reward','fee','adjustment')),
  status            text not null default 'success' check (status in ('pending','success','failed','reversed')),
  amount            bigint not null check (amount > 0),
  fee               bigint not null default 0 check (fee >= 0),
  user_id           uuid references public.profiles(id),
  counterparty_user_id uuid references public.profiles(id),
  description       text not null check (char_length(description) <= 200),
  idempotency_key   text,
  payment_reference text,
  bill_payment_id   uuid references public.bill_payments(id),
  group_id          uuid references public.osusu_groups(id),
  reward_id         uuid references public.referral_rewards(id),
  reverses_id       uuid references public.wallet_transactions(id),
  metadata          jsonb not null default '{}'::jsonb,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  completed_at      timestamptz default now()
);
create index wallet_transactions_user_idx on public.wallet_transactions (user_id, created_at desc);
create index wallet_transactions_counterparty_idx on public.wallet_transactions (counterparty_user_id, created_at desc) where counterparty_user_id is not null;
create index wallet_transactions_payment_ref_idx on public.wallet_transactions (payment_reference) where payment_reference is not null;
create index wallet_transactions_type_idx on public.wallet_transactions (type, created_at desc);

create table public.wallet_ledger_entries (
  id             bigint generated always as identity primary key,
  transaction_id uuid not null references public.wallet_transactions(id),
  account_id     uuid not null references public.wallet_accounts(id),
  direction      text not null check (direction in ('debit','credit')),
  amount         bigint not null check (amount > 0),
  balance_after  bigint not null,
  created_at     timestamptz not null default now()
);
create index wallet_ledger_account_idx on public.wallet_ledger_entries (account_id, id desc);
create index wallet_ledger_tx_idx on public.wallet_ledger_entries (transaction_id);
create trigger wallet_ledger_append_only before update or delete on public.wallet_ledger_entries
  for each row execute function public.forbid_mutation();

-- Completed records never change; only success -> reversed is allowed, and nothing is deleted.
create or replace function public.guard_wallet_transaction() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'ACH:409:WALLET_IMMUTABLE:Wallet transactions cannot be deleted'; end if;
  if new.reference <> old.reference or new.type <> old.type or new.amount <> old.amount or new.fee <> old.fee
     or new.user_id is distinct from old.user_id or new.counterparty_user_id is distinct from old.counterparty_user_id then
    raise exception 'ACH:409:WALLET_IMMUTABLE:Wallet transactions cannot be altered';
  end if;
  if new.status <> old.status and not (old.status = 'pending') and not (old.status = 'success' and new.status = 'reversed') then
    raise exception 'ACH:409:WALLET_IMMUTABLE:This wallet transaction is final';
  end if;
  return new;
end $$;
create trigger wallet_transactions_guard before update or delete on public.wallet_transactions
  for each row execute function public.guard_wallet_transaction();

create or replace function public._wallet_code() returns text
language plpgsql as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v text := 'ACHW-';
begin
  for i in 0..7 loop v := v || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1); end loop;
  return v;
end $$;

create or replace function public.ensure_wallet(p_user_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from wallet_accounts where user_id = p_user_id;
  if found then return v_id; end if;
  for attempt in 1..10 loop
    begin
      insert into wallet_accounts (kind, user_id, wallet_code) values ('user', p_user_id, _wallet_code()) returning id into v_id;
      return v_id;
    exception when unique_violation then
      select id into v_id from wallet_accounts where user_id = p_user_id;
      if found then return v_id; end if;
    end;
  end loop;
  perform app_error(500, 'WALLET_CREATE_FAILED', 'Could not create the wallet');
end $$;

create or replace function public._system_account(p_kind text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from wallet_accounts where kind = p_kind
$$;

/**
 * Post a balanced set of lines for one wallet transaction.
 *   p_lines: [{ "account": uuid, "direction": "debit"|"credit", "amount": kobo }, ...]
 * Locks every account (in id order: no deadlocks), refuses to overdraw a user
 * wallet (balance - held) unless p_allow_negative (reversals of money already
 * spent), refuses frozen/closed user wallets, writes immutable entries.
 */
create or replace function public._wallet_post(p_tx uuid, p_lines jsonb, p_allow_negative boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  l    jsonb;
  acc  wallet_accounts%rowtype;
  v_dr bigint := 0;
  v_cr bigint := 0;
  v_amt bigint;
begin
  for l in select * from jsonb_array_elements(p_lines) loop
    v_amt := (l ->> 'amount')::bigint;
    if v_amt is null or v_amt <= 0 then perform app_error(400, 'INVALID_AMOUNT', 'Invalid ledger amount'); end if;
    if l ->> 'direction' = 'debit' then v_dr := v_dr + v_amt; elsif l ->> 'direction' = 'credit' then v_cr := v_cr + v_amt;
    else perform app_error(400, 'INVALID_LINE', 'Invalid ledger direction'); end if;
  end loop;
  if v_dr <> v_cr or v_dr = 0 then perform app_error(500, 'LEDGER_UNBALANCED', 'Ledger lines do not balance'); end if;

  perform 1 from wallet_accounts where id in (select (x ->> 'account')::uuid from jsonb_array_elements(p_lines) x) order by id for update;

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into acc from wallet_accounts where id = (l ->> 'account')::uuid;
    if not found then perform app_error(404, 'WALLET_NOT_FOUND', 'Wallet not found'); end if;
    v_amt := (l ->> 'amount')::bigint;
    if l ->> 'direction' = 'debit' then
      if acc.kind = 'user' and not p_allow_negative then
        if acc.status <> 'active' then perform app_error(403, 'WALLET_NOT_ACTIVE', 'This wallet cannot send money right now. Contact support.'); end if;
        if acc.balance - acc.held < v_amt then perform app_error(409, 'INSUFFICIENT_FUNDS', 'Your ACHIEVER Wallet balance is not enough for this payment.'); end if;
      end if;
      update wallet_accounts set balance = balance - v_amt where id = acc.id returning * into acc;
    else
      if acc.kind = 'user' and acc.status = 'closed' then perform app_error(403, 'WALLET_CLOSED', 'The receiving wallet is closed'); end if;
      update wallet_accounts set balance = balance + v_amt where id = acc.id returning * into acc;
    end if;
    insert into wallet_ledger_entries (transaction_id, account_id, direction, amount, balance_after)
    values (p_tx, acc.id, l ->> 'direction', v_amt, acc.balance);
  end loop;
end $$;

create or replace function public._wallet_tx(p_type text, p_amount bigint, p_user uuid, p_description text, p_extra jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into wallet_transactions (reference, type, amount, fee, user_id, counterparty_user_id, description, idempotency_key,
                                   payment_reference, bill_payment_id, group_id, reward_id, reverses_id, metadata, created_by, status)
  values (new_reference('ACH-WTX'), p_type, p_amount, coalesce((p_extra ->> 'fee')::bigint, 0), p_user,
          (p_extra ->> 'counterparty')::uuid, p_description, p_extra ->> 'idempotency_key', p_extra ->> 'payment_reference',
          (p_extra ->> 'bill_payment_id')::uuid, (p_extra ->> 'group_id')::uuid, (p_extra ->> 'reward_id')::uuid,
          (p_extra ->> 'reverses_id')::uuid, coalesce(p_extra -> 'metadata', '{}'::jsonb), (p_extra ->> 'created_by')::uuid,
          coalesce(p_extra ->> 'status', 'success'))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Top-ups (Paystack). Credited only after server-side confirmation.
-- ---------------------------------------------------------------------
alter table public.payment_attempts drop constraint if exists payment_attempts_purpose_check;
alter table public.payment_attempts add constraint payment_attempts_purpose_check
  check (purpose in ('osusu_contribution','collector_savings','bill_payment','wallet_topup'));

create table public.wallet_topups (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id),
  wallet_id         uuid not null references public.wallet_accounts(id),
  amount            bigint not null check (amount > 0),
  status            text not null default 'INITIALIZED' check (status in ('INITIALIZED','PENDING','SUCCESS','FAILED','ABANDONED','REVERSED','REFUNDED')),
  payment_reference text unique,
  transaction_id    uuid references public.wallet_transactions(id),
  idempotency_key   text,
  failure_reason    text check (char_length(failure_reason) <= 300),
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);
create index wallet_topups_user_idx on public.wallet_topups (user_id, created_at desc);
create unique index wallet_topups_idem_idx on public.wallet_topups (user_id, idempotency_key) where idempotency_key is not null;

create or replace function public._apply_wallet_topup(a payment_attempts, p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t    wallet_topups%rowtype;
  v_tx uuid;
  v_ref uuid;
begin
  select * into t from wallet_topups where id = a.target_id for update;
  if not found or t.user_id <> a.user_id or t.amount <> a.amount or t.status not in ('INITIALIZED','PENDING') then
    -- Already credited or not ours: the money goes back (never credited twice).
    v_ref := _create_refund_tx(a.user_id, a.amount, a.reference, 'topup_not_applicable');
    return jsonb_build_object('outcome', 'duplicate', 'refund_transaction_id', v_ref);
  end if;
  v_tx := _wallet_tx('topup', a.amount, a.user_id, 'Wallet top-up (Paystack)', jsonb_build_object('payment_reference', a.reference));
  perform _wallet_post(v_tx, jsonb_build_array(
    jsonb_build_object('account', _system_account('paystack_clearing'), 'direction', 'debit', 'amount', a.amount),
    jsonb_build_object('account', t.wallet_id, 'direction', 'credit', 'amount', a.amount)));
  update wallet_topups set status = 'SUCCESS', transaction_id = v_tx, completed_at = now(), payment_reference = a.reference where id = t.id;
  perform enqueue_notification(a.user_id, 'wallet_topup', 'payments', 'Wallet funded',
    format('%s has been added to your ACHIEVER Wallet.', fmt_naira(a.amount)), jsonb_build_object('wallet_transaction_id', v_tx), 'topup:' || a.reference);
  perform audit_event(a.user_id, 'wallet.topup', 'wallet_topup', t.id::text, 'success', jsonb_build_object('reference', a.reference, 'amount', a.amount));
  return jsonb_build_object('outcome', 'applied', 'wallet_transaction_id', v_tx, 'topup_id', t.id);
end $$;

-- Paystack attempt failed / abandoned -> the top-up says so.
create or replace function public.sync_wallet_topup_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.purpose = 'wallet_topup' and new.status <> old.status and new.status in ('failed','abandoned') then
    update wallet_topups set status = upper(new.status), failure_reason = left(new.gateway_response, 300), completed_at = now()
     where id = new.target_id and status in ('INITIALIZED','PENDING');
  end if;
  return new;
end $$;
create trigger payment_attempts_sync_topup after update of status on public.payment_attempts
  for each row execute function public.sync_wallet_topup_status();

-- A top-up refunded/charged back by Paystack after it was credited: reverse it.
create or replace function public.wallet_reverse_topup(p_topup uuid, p_reason text, p_status text default 'REVERSED') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t    wallet_topups%rowtype;
  w    wallet_accounts%rowtype;
  v_tx uuid;
begin
  select * into t from wallet_topups where id = p_topup for update;
  if not found then perform app_error(404, 'TOPUP_NOT_FOUND', 'Top-up not found'); end if;
  if t.status <> 'SUCCESS' then return jsonb_build_object('outcome', 'not_applicable', 'status', t.status); end if;
  v_tx := _wallet_tx('reversal', t.amount, t.user_id, 'Top-up reversed by the payment provider',
    jsonb_build_object('payment_reference', t.payment_reference, 'reverses_id', t.transaction_id, 'metadata', jsonb_build_object('reason', left(p_reason, 200))));
  -- The money may already be spent: allow the wallet to go below zero, then freeze it for review.
  perform _wallet_post(v_tx, jsonb_build_array(
    jsonb_build_object('account', t.wallet_id, 'direction', 'debit', 'amount', t.amount),
    jsonb_build_object('account', _system_account('paystack_clearing'), 'direction', 'credit', 'amount', t.amount)), true);
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

-- ---------------------------------------------------------------------
-- 3. Internal transfers
-- ---------------------------------------------------------------------
create table public.wallet_holds (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.wallet_accounts(id),
  amount         bigint not null check (amount > 0),
  reason         text not null check (char_length(reason) <= 200),
  status         text not null default 'active' check (status in ('active','captured','released')),
  transfer_id    uuid,
  created_at     timestamptz not null default now(),
  released_at    timestamptz
);
create index wallet_holds_active_idx on public.wallet_holds (account_id) where status = 'active';

create table public.wallet_transfers (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,
  sender_user_id      uuid not null references public.profiles(id),
  sender_wallet_id    uuid not null references public.wallet_accounts(id),
  recipient_wallet_id uuid not null references public.wallet_accounts(id),
  amount              bigint not null check (amount > 0),
  fee                 bigint not null default 0 check (fee >= 0),
  note                text check (char_length(note) <= 120),
  status              text not null default 'AWAITING_AUTHORIZATION' check (status in ('AWAITING_AUTHORIZATION','PENDING_REVIEW','SUCCESS','FAILED','CANCELLED','REVERSED')),
  idempotency_key     text,
  auth_method         text,
  auth_challenge_id   uuid,
  authorized_at       timestamptz,
  hold_id             uuid references public.wallet_holds(id),
  transaction_id      uuid references public.wallet_transactions(id),
  failure_reason      text check (char_length(failure_reason) <= 300),
  reviewed_by         uuid references public.profiles(id),
  review_reason       text,
  expires_at          timestamptz not null default now() + interval '15 minutes',
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  check (sender_wallet_id <> recipient_wallet_id)
);
create index wallet_transfers_sender_idx on public.wallet_transfers (sender_user_id, created_at desc);
create index wallet_transfers_recipient_idx on public.wallet_transfers (recipient_wallet_id, created_at desc);
create unique index wallet_transfers_idem_idx on public.wallet_transfers (sender_user_id, idempotency_key) where idempotency_key is not null;

create or replace function public._wallet_transfer_post(x wallet_transfers) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tx uuid;
  v_recipient uuid;
  v_lines jsonb;
begin
  select user_id into v_recipient from wallet_accounts where id = x.recipient_wallet_id;
  v_tx := _wallet_tx('transfer', x.amount, x.sender_user_id, coalesce('Transfer: ' || nullif(x.note, ''), 'Wallet transfer'),
    jsonb_build_object('counterparty', v_recipient, 'fee', x.fee, 'idempotency_key', x.idempotency_key, 'metadata', jsonb_build_object('transfer_id', x.id, 'reference', x.reference)));
  v_lines := jsonb_build_array(
    jsonb_build_object('account', x.sender_wallet_id, 'direction', 'debit', 'amount', x.amount + x.fee),
    jsonb_build_object('account', x.recipient_wallet_id, 'direction', 'credit', 'amount', x.amount));
  if x.fee > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', _system_account('fees'), 'direction', 'credit', 'amount', x.fee)); end if;
  perform _wallet_post(v_tx, v_lines);
  perform enqueue_notification(x.sender_user_id, 'wallet_transfer_sent', 'payments', 'Transfer sent',
    format('You sent %s from your ACHIEVER Wallet.', fmt_naira(x.amount)), jsonb_build_object('wallet_transaction_id', v_tx), 'tr_out:' || x.id);
  perform enqueue_notification(v_recipient, 'wallet_transfer_received', 'payments', 'Money received',
    format('%s was added to your ACHIEVER Wallet.', fmt_naira(x.amount)), jsonb_build_object('wallet_transaction_id', v_tx), 'tr_in:' || x.id);
  return v_tx;
end $$;

/**
 * Execute an authorised transfer (the transaction PIN / code / biometric was
 * verified by the API). Limits are enforced here, on the same locked rows.
 */
create or replace function public.wallet_execute_transfer(p_transfer uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x       wallet_transfers%rowtype;
  s       wallet_accounts%rowtype;
  r       wallet_accounts%rowtype;
  v_today bigint;
  v_tx    uuid;
  v_hold  uuid;
begin
  select * into x from wallet_transfers where id = p_transfer for update;
  if not found then perform app_error(404, 'TRANSFER_NOT_FOUND', 'Transfer not found'); end if;
  if x.status = 'SUCCESS' then return jsonb_build_object('outcome', 'already_done', 'status', x.status, 'wallet_transaction_id', x.transaction_id); end if;
  if x.status <> 'AWAITING_AUTHORIZATION' or x.authorized_at is null then perform app_error(409, 'TRANSFER_NOT_AUTHORISED', 'This transfer has not been approved'); end if;
  if x.expires_at < now() then
    update wallet_transfers set status = 'CANCELLED', failure_reason = 'Review expired' where id = x.id;
    perform app_error(409, 'TRANSFER_EXPIRED', 'This transfer review expired. Start again.');
  end if;
  -- Lock both wallets (id order) before checking balances and limits.
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
  if s.balance - s.held < x.amount + x.fee then perform app_error(409, 'INSUFFICIENT_FUNDS', 'Your ACHIEVER Wallet balance is not enough for this transfer.'); end if;

  -- Large transfers: funds are held and a person reviews before they move.
  if x.amount >= setting_bigint('wallet.transfer_review_threshold_kobo', 50000000) then
    insert into wallet_holds (account_id, amount, reason, transfer_id) values (s.id, x.amount + x.fee, 'Large transfer under review', x.id) returning id into v_hold;
    update wallet_accounts set held = held + x.amount + x.fee where id = s.id;
    update wallet_transfers set status = 'PENDING_REVIEW', hold_id = v_hold where id = x.id;
    perform enqueue_notification(x.sender_user_id, 'wallet_transfer_review', 'security', 'Transfer under review',
      'A large transfer is being reviewed for your protection. The amount is held in your wallet until it is approved.', jsonb_build_object('transfer_id', x.id), 'tr_rev:' || x.id);
    perform audit_event(x.sender_user_id, 'wallet.transfer.held_for_review', 'wallet_transfer', x.id::text, 'success', jsonb_build_object('amount', x.amount));
    return jsonb_build_object('outcome', 'pending_review');
  end if;

  v_tx := _wallet_transfer_post(x);
  update wallet_transfers set status = 'SUCCESS', transaction_id = v_tx, completed_at = now() where id = x.id;
  perform audit_event(x.sender_user_id, 'wallet.transfer', 'wallet_transfer', x.id::text, 'success', jsonb_build_object('amount', x.amount, 'recipient_wallet', r.wallet_code));
  return jsonb_build_object('outcome', 'success', 'wallet_transaction_id', v_tx);
end $$;

/** Admin decision on a held (large) transfer. */
create or replace function public.wallet_review_transfer(p_transfer uuid, p_actor uuid, p_approve boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x    wallet_transfers%rowtype;
  v_tx uuid;
begin
  if char_length(coalesce(trim(p_reason), '')) < 5 then perform app_error(400, 'REASON_REQUIRED', 'Give a reason'); end if;
  select * into x from wallet_transfers where id = p_transfer for update;
  if not found or x.status <> 'PENDING_REVIEW' then perform app_error(409, 'NOT_UNDER_REVIEW', 'This transfer is not waiting for review'); end if;
  if p_actor = x.sender_user_id then perform app_error(403, 'SELF_REVIEW_FORBIDDEN', 'You cannot review your own transfer'); end if;
  update wallet_holds set status = case when p_approve then 'captured' else 'released' end, released_at = now() where id = x.hold_id;
  update wallet_accounts set held = held - (x.amount + x.fee) where id = x.sender_wallet_id;
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

-- ---------------------------------------------------------------------
-- 4. Bills paid from the wallet (refunds go back to the wallet instantly)
-- ---------------------------------------------------------------------
alter table public.bill_payments drop constraint if exists bill_payments_auth_method_check;
alter table public.bill_payments add constraint bill_payments_auth_method_check check (auth_method in ('email_otp','device_biometric','pin'));
alter table public.bill_payments
  add column funding_source        text not null default 'paystack' check (funding_source in ('paystack','wallet')),
  add column wallet_transaction_id uuid references public.wallet_transactions(id);

create or replace function public.wallet_pay_bill(p_bill uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b     bill_payments%rowtype;
  w     uuid;
  v_wtx uuid;
  v_tx  uuid;
  v_spent bigint;
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
  v_wtx := _wallet_tx('bill_payment', b.total_amount, b.user_id, coalesce(b.service_name, initcap(b.category)) || ' purchase',
    jsonb_build_object('bill_payment_id', b.id, 'fee', b.fee));
  perform _wallet_post(v_wtx, jsonb_build_array(
    jsonb_build_object('account', w, 'direction', 'debit', 'amount', b.total_amount),
    jsonb_build_object('account', _system_account('bill_settlement'), 'direction', 'credit', 'amount', b.total_amount)));
  insert into transactions (reference, user_id, bill_payment_id, type, direction, amount, provider, provider_reference,
                            status, description, metadata)
  values (new_reference('ACH-TX'), b.user_id, b.id, 'bill_payment', 'debit', b.total_amount, 'internal',
          (select reference from wallet_transactions where id = v_wtx), 'processing',
          coalesce(b.service_name, initcap(b.category)) || ' purchase (ACHIEVER Wallet)',
          jsonb_build_object('bill_payment_id', b.id, 'service_id', b.service_id, 'fee', b.fee, 'wallet_transaction_id', v_wtx))
  returning id into v_tx;
  update bill_payments set status = 'paid', payment_reference = (select reference from wallet_transactions where id = v_wtx),
         transaction_id = v_tx, wallet_transaction_id = v_wtx where id = b.id;
  perform audit_event(b.user_id, 'bill.paid.wallet', 'bill_payment', b.id::text, 'success', jsonb_build_object('wallet_transaction_id', v_wtx));
  return jsonb_build_object('outcome', 'applied', 'bill_payment_id', b.id, 'wallet_transaction_id', v_wtx);
end $$;

/** Money back for a failed / reversed bill: wallet bills refund instantly to the wallet; card bills via Paystack. */
create or replace function public._bill_refund(b bill_payments, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_wtx uuid;
begin
  if b.funding_source = 'wallet' then
    v_wtx := _wallet_tx('refund', b.total_amount, b.user_id, 'Refund: ' || coalesce(b.service_name, initcap(b.category)),
      jsonb_build_object('bill_payment_id', b.id, 'reverses_id', b.wallet_transaction_id, 'metadata', jsonb_build_object('reason', p_reason)));
    perform _wallet_post(v_wtx, jsonb_build_array(
      jsonb_build_object('account', _system_account('bill_settlement'), 'direction', 'debit', 'amount', b.total_amount),
      jsonb_build_object('account', ensure_wallet(b.user_id), 'direction', 'credit', 'amount', b.total_amount)));
    insert into transactions (reference, user_id, bill_payment_id, type, direction, amount, provider, status, description, metadata, completed_at)
    values (new_reference('ACH-RF'), b.user_id, b.id, 'refund', 'credit', b.total_amount, 'internal', 'success',
            'Refund to ACHIEVER Wallet', jsonb_build_object('reason', p_reason, 'wallet_transaction_id', v_wtx), now());
    return null; -- nothing for Paystack to do
  end if;
  return _create_refund_tx(b.user_id, b.total_amount, b.payment_reference, p_reason, null, null, b.id);
end $$;

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
      format('Your %s purchase of %s was successful. Open ACHIEVER to view your receipt.', coalesce(b.service_name, b.category), fmt_naira(b.amount)),
      jsonb_build_object('bill_payment_id', b.id), 'bill_done:' || b.id);
    perform audit_event(b.user_id, 'bill.delivered', 'bill_payment', b.id::text, 'success',
      jsonb_build_object('provider_reference', p_provider_reference, 'source', p_source));
    return jsonb_build_object('outcome', 'delivered');
  elsif p_outcome = 'failed' then
    update transactions set status = 'failed', completed_at = now() where id = b.transaction_id;
    v_ref := _bill_refund(b, 'bill_failed');
    update bill_payments set status = 'refund_pending', last_error = left(p_error, 300), last_provider_code = p_provider_code,
           provider_reference = coalesce(provider_reference, p_provider_reference),
           provider_transaction_id = coalesce(provider_transaction_id, p_provider_transaction_id),
           completed_at = now(), attempts = attempts + 1, next_retry_at = null
     where id = b.id;
    if b.funding_source = 'wallet' then update bill_payments set status = 'refunded' where id = b.id; end if;
    perform enqueue_notification(b.user_id, 'bill_failed', 'payments', 'Purchase not completed',
      case when b.funding_source = 'wallet' then 'Your purchase could not be completed. The money is back in your ACHIEVER Wallet.'
           else 'Your purchase could not be completed. A refund has been started. Open ACHIEVER for details.' end,
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
    return record_bill_result(p_bill_id, 'failed', null, null, null, coalesce(p_reason, 'Reversed by provider'), 300, p_source, null, p_provider_code);
  end if;
  if b.status <> 'delivered' then perform app_error(409, 'BILL_NOT_REVERSIBLE', 'Only a completed purchase can be reversed'); end if;

  update transactions set status = 'reversed', completed_at = now() where id = b.transaction_id and status = 'success';
  v_ref := _bill_refund(b, 'bill_reversed');
  update bill_payments set status = 'reversed', reversed_at = now(), last_error = left(coalesce(p_reason, 'Reversed by provider'), 300),
         last_provider_code = p_provider_code
   where id = b.id;
  if b.funding_source = 'wallet' then update bill_payments set status = 'refunded' where id = b.id; end if;
  perform enqueue_notification(b.user_id, 'bill_reversed', 'payments', 'Transaction reversed',
    case when b.funding_source = 'wallet' then 'A purchase was reversed by the provider. The money is back in your ACHIEVER Wallet.'
         else 'A purchase was reversed by the provider. A refund has been started. Open ACHIEVER for details.' end,
    jsonb_build_object('bill_payment_id', b.id), 'bill_reversed:' || b.id);
  perform audit_event(b.user_id, 'bill.reversed', 'bill_payment', b.id::text, 'success',
    jsonb_build_object('reason', left(p_reason, 200), 'source', p_source));
  return jsonb_build_object('outcome', 'reversed', 'refund_transaction_id', v_ref, 'payment_reference', b.payment_reference);
end $$;

-- ---------------------------------------------------------------------
-- 5. OSUSU contributions and collector savings from the wallet
--    (the same application functions as card payments, so cycle
--     accounting, late flags and notifications are identical)
-- ---------------------------------------------------------------------
create or replace function public._apply_osusu_contribution(a payment_attempts, p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c      osusu_contributions%rowtype;
  g      osusu_groups%rowtype;
  cy     osusu_cycles%rowtype;
  v_tx   uuid;
  v_late boolean;
  v_ref  uuid;
  v_provider text := case when a.metadata ->> 'funding' = 'wallet' then 'internal' else 'paystack' end;
begin
  select * into c from osusu_contributions where id = a.target_id for update;
  if not found then
    if v_provider = 'internal' then perform app_error(404, 'CONTRIBUTION_NOT_FOUND', 'Contribution not found'); end if;
    v_ref := _create_refund_tx(a.user_id, a.amount, a.reference, 'target_missing');
    return jsonb_build_object('outcome', 'duplicate', 'refund_transaction_id', v_ref);
  end if;
  select * into g from osusu_groups where id = c.group_id;
  if c.status = 'paid' or c.user_id <> a.user_id or c.amount <> a.amount then
    if v_provider = 'internal' then perform app_error(409, 'CONTRIBUTION_NOT_PAYABLE', 'This contribution is already paid or does not match'); end if;
    v_ref := _create_refund_tx(a.user_id, a.amount, a.reference, 'duplicate_payment', c.group_id);
    insert into risk_flags (subject_user_id, context, reason_code, severity, group_id, details)
    values (a.user_id, 'payments', 'duplicate_payment', 'low', c.group_id,
            jsonb_build_object('reference', a.reference, 'contribution_id', c.id));
    perform enqueue_notification(a.user_id, 'payment_duplicate', 'payments', 'Duplicate payment received',
      format('We received %s for a contribution that was already paid. A refund has been initiated.', fmt_naira(a.amount)),
      jsonb_build_object('reference', a.reference), 'dup:' || a.reference);
    return jsonb_build_object('outcome', 'duplicate', 'refund_transaction_id', v_ref);
  end if;

  select * into cy from osusu_cycles where id = c.cycle_id for update;
  v_late := (p_paid_at at time zone 'Africa/Lagos')::date > c.due_date + g.grace_period_days;

  insert into transactions (reference, user_id, group_id, type, direction, amount, provider, provider_reference,
                            status, description, metadata, completed_at)
  values (new_reference('ACH-TX'), a.user_id, c.group_id, 'osusu_contribution', 'debit', a.amount, v_provider,
          a.reference, 'success', format('%s — cycle %s contribution', g.name, c.cycle_number),
          jsonb_build_object('contribution_id', c.id, 'cycle_number', c.cycle_number, 'late', v_late, 'funding', coalesce(a.metadata ->> 'funding', 'paystack')), now())
  returning id into v_tx;

  update osusu_contributions set status = 'paid', paid_at = p_paid_at, is_late = v_late, transaction_id = v_tx where id = c.id;
  update osusu_cycles
     set collected_amount = collected_amount + c.amount,
         paid_count = paid_count + 1,
         status = case when status = 'open' and paid_count + 1 >= member_count then 'funded' else status end,
         funded_at = case when status = 'open' and paid_count + 1 >= member_count then now() else funded_at end
   where id = cy.id;

  if not exists (select 1 from osusu_contributions where member_id = c.member_id and status = 'overdue') then
    update osusu_members set risk_status = 'good' where id = c.member_id and risk_status = 'payment_overdue';
  end if;

  perform enqueue_notification(a.user_id, 'osusu_contribution_paid', 'payments', 'Payment recorded',
    format('Your payment of %s has been successfully recorded for %s (cycle %s).', fmt_naira(a.amount), g.name, c.cycle_number),
    jsonb_build_object('group_id', g.id, 'transaction_id', v_tx), 'paid:' || a.reference);
  if cy.paid_count + 1 >= cy.member_count and cy.status = 'open' then
    perform enqueue_notification(g.admin_id, 'osusu_cycle_funded', 'payouts', 'Cycle fully funded',
      format('Cycle %s of %s is fully funded. You can now approve the payout.', c.cycle_number, g.name),
      jsonb_build_object('group_id', g.id, 'cycle_id', cy.id), 'funded:' || cy.id);
  end if;
  perform audit_event(a.user_id, 'osusu.contribution.paid', 'osusu_contribution', c.id::text, 'success',
    jsonb_build_object('reference', a.reference, 'transaction_id', v_tx, 'late', v_late, 'funding', v_provider));
  return jsonb_build_object('outcome', 'applied', 'transaction_id', v_tx, 'group_id', g.id, 'contribution_id', c.id);
end $$;

/** Pay one OSUSU contribution from the member's wallet (manual or by an authorised mandate). */
create or replace function public.wallet_pay_osusu_contribution(p_user uuid, p_contribution uuid, p_mandate uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c     osusu_contributions%rowtype;
  g     osusu_groups%rowtype;
  v_wtx uuid;
  v_ref text;
  a     payment_attempts%rowtype;
  v_res jsonb;
begin
  select * into c from osusu_contributions where id = p_contribution for update;
  if not found or c.user_id <> p_user then perform app_error(404, 'CONTRIBUTION_NOT_FOUND', 'Contribution not found'); end if;
  if c.status = 'paid' then return jsonb_build_object('outcome', 'already_paid'); end if;
  select * into g from osusu_groups where id = c.group_id;
  v_wtx := _wallet_tx('osusu_contribution', c.amount, p_user, format('%s — cycle %s contribution', g.name, c.cycle_number),
    jsonb_build_object('group_id', g.id, 'metadata', jsonb_build_object('contribution_id', c.id, 'mandate_id', p_mandate)));
  perform _wallet_post(v_wtx, jsonb_build_array(
    jsonb_build_object('account', ensure_wallet(p_user), 'direction', 'debit', 'amount', c.amount),
    jsonb_build_object('account', _system_account('osusu_pool'), 'direction', 'credit', 'amount', c.amount)));
  select reference into v_ref from wallet_transactions where id = v_wtx;
  insert into payment_attempts (reference, user_id, purpose, target_id, amount, status, channel, gateway_response, paid_at, verified_at, metadata)
  values (v_ref, p_user, 'osusu_contribution', c.id, c.amount, 'success', 'wallet', 'ACHIEVER Wallet', now(), now(),
          jsonb_build_object('funding', 'wallet', 'wallet_transaction_id', v_wtx, 'mandate_id', p_mandate))
  returning * into a;
  v_res := _apply_osusu_contribution(a, now());
  update payment_attempts set transaction_id = (v_res ->> 'transaction_id')::uuid where id = a.id;
  return v_res || jsonb_build_object('wallet_transaction_id', v_wtx);
end $$;

/** One-off collector savings deposit from the wallet (recorded in the plan exactly like a card deposit). */
create or replace function public.wallet_pay_collector_savings(p_user uuid, p_plan uuid, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s     collector_savers%rowtype;
  v_wtx uuid;
  v_ref text;
  a     payment_attempts%rowtype;
  v_res jsonb;
begin
  if p_amount is null or p_amount < 10000 then perform app_error(400, 'AMOUNT_TOO_LOW', 'The minimum deposit is ₦100'); end if;
  select * into s from collector_savers where id = p_plan for update;
  if not found or s.saver_id <> p_user or s.status not in ('active','matured','return_requested') then
    perform app_error(404, 'PLAN_NOT_FOUND', 'Savings plan not found or not accepting deposits');
  end if;
  v_wtx := _wallet_tx('collector_savings', p_amount, p_user, 'Savings deposit: ' || s.plan_name, jsonb_build_object('metadata', jsonb_build_object('plan_id', s.id)));
  perform _wallet_post(v_wtx, jsonb_build_array(
    jsonb_build_object('account', ensure_wallet(p_user), 'direction', 'debit', 'amount', p_amount),
    jsonb_build_object('account', _system_account('collector_pool'), 'direction', 'credit', 'amount', p_amount)));
  select reference into v_ref from wallet_transactions where id = v_wtx;
  insert into payment_attempts (reference, user_id, purpose, target_id, amount, status, channel, gateway_response, paid_at, verified_at, metadata)
  values (v_ref, p_user, 'collector_savings', s.id, p_amount, 'success', 'wallet', 'ACHIEVER Wallet', now(), now(),
          jsonb_build_object('funding', 'wallet', 'wallet_transaction_id', v_wtx))
  returning * into a;
  v_res := _apply_collector_savings(a, now());
  if v_res ->> 'outcome' <> 'applied' then perform app_error(409, 'DEPOSIT_NOT_APPLIED', 'This deposit could not be recorded'); end if;
  update payment_attempts set transaction_id = (v_res ->> 'transaction_id')::uuid where id = a.id;
  return v_res || jsonb_build_object('wallet_transaction_id', v_wtx);
end $$;

-- Collector deposits: same rules for card and wallet; the ledger provider says which.
create or replace function public._apply_collector_savings(a payment_attempts, p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s      collector_savers%rowtype;
  v_tx   uuid;
  v_ref  uuid;
  v_big  bigint := setting_bigint('risk.large_collector_contribution_kobo', 50000000);
  v_provider text := case when a.metadata ->> 'funding' = 'wallet' then 'internal' else 'paystack' end;
begin
  select * into s from collector_savers where id = a.target_id for update;
  if not found or s.saver_id <> a.user_id or s.status not in ('active','matured','return_requested') then
    if v_provider = 'internal' then perform app_error(404, 'PLAN_NOT_FOUND', 'Savings plan not found or not accepting deposits'); end if;
    v_ref := _create_refund_tx(a.user_id, a.amount, a.reference, 'plan_not_accepting', null, a.target_id);
    perform enqueue_notification(a.user_id, 'payment_refund', 'payments', 'Payment will be refunded',
      format('Your payment of %s could not be applied because the plan is no longer accepting contributions. A refund has been initiated.',
             fmt_naira(a.amount)),
      jsonb_build_object('reference', a.reference), 'plan_closed:' || a.reference);
    return jsonb_build_object('outcome', 'duplicate', 'refund_transaction_id', v_ref);
  end if;

  insert into transactions (reference, user_id, collector_saver_id, type, direction, amount, provider, provider_reference,
                            status, description, metadata, completed_at)
  values (new_reference('ACH-TX'), a.user_id, s.id, 'collector_savings', 'debit', a.amount, v_provider, a.reference,
          'success', format('Savings — %s', s.plan_name), jsonb_build_object('plan_id', s.id), now())
  returning id into v_tx;
  insert into collector_contributions (collector_saver_id, saver_id, amount, paid_at, transaction_id)
  values (s.id, a.user_id, a.amount, p_paid_at, v_tx);
  update collector_savers set balance = balance + a.amount, total_contributed = total_contributed + a.amount where id = s.id;

  if a.amount >= v_big then
    insert into risk_flags (subject_user_id, context, reason_code, severity, collector_saver_id, details)
    values (a.user_id, 'collector', 'large_transaction', 'medium', s.id,
            jsonb_build_object('reference', a.reference, 'amount', a.amount));
  end if;

  perform enqueue_notification(a.user_id, 'collector_savings_paid', 'payments', 'Savings recorded',
    format('Your payment of %s has been successfully recorded. New balance: %s.', fmt_naira(a.amount), fmt_naira(s.balance + a.amount)),
    jsonb_build_object('plan_id', s.id, 'transaction_id', v_tx), 'paid:' || a.reference);
  perform enqueue_notification(s.collector_id, 'collector_savings_received', 'payments', 'Saver contribution received',
    format('%s was saved into plan "%s".', fmt_naira(a.amount), s.plan_name),
    jsonb_build_object('plan_id', s.id), 'paid_c:' || a.reference);
  perform audit_event(a.user_id, 'collector.contribution.paid', 'collector_saver', s.id::text, 'success',
    jsonb_build_object('reference', a.reference, 'transaction_id', v_tx));
  return jsonb_build_object('outcome', 'applied', 'transaction_id', v_tx, 'plan_id', s.id);
end $$;

-- Paystack confirmation now also routes wallet top-ups.
create or replace function public.confirm_payment(
  p_reference text, p_amount bigint, p_currency text, p_channel text, p_gateway_response text,
  p_paid_at timestamptz, p_source text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a        payment_attempts%rowtype;
  v_result jsonb;
  v_ref    uuid;
begin
  select * into a from payment_attempts where reference = p_reference for update;
  if not found then return jsonb_build_object('outcome', 'unknown_reference'); end if;
  if a.status in ('success','amount_mismatch','duplicate') then
    return jsonb_build_object('outcome', 'already_processed', 'status', a.status, 'purpose', a.purpose,
                              'target_id', a.target_id, 'transaction_id', a.transaction_id);
  end if;

  if p_amount <> a.amount or upper(p_currency) <> a.currency then
    v_ref := _create_refund_tx(a.user_id, p_amount, p_reference, 'amount_mismatch');
    update payment_attempts set status = 'amount_mismatch', channel = p_channel, gateway_response = p_gateway_response,
           paid_at = p_paid_at, verified_at = now(), refund_transaction_id = v_ref
     where id = a.id;
    insert into risk_flags (subject_user_id, context, reason_code, severity, details)
    values (a.user_id, 'payments', 'amount_mismatch', 'high',
            jsonb_build_object('reference', p_reference, 'expected', a.amount, 'received', p_amount, 'currency', p_currency));
    perform audit_event(null, 'payment.amount_mismatch', 'payment_attempt', a.id::text, 'failure',
      jsonb_build_object('reference', p_reference, 'expected', a.amount, 'received', p_amount, 'source', p_source));
    return jsonb_build_object('outcome', 'amount_mismatch', 'purpose', a.purpose, 'refund_transaction_id', v_ref,
                              'reference', p_reference, 'user_id', a.user_id);
  end if;

  if a.purpose = 'osusu_contribution' then
    v_result := _apply_osusu_contribution(a, p_paid_at);
  elsif a.purpose = 'collector_savings' then
    v_result := _apply_collector_savings(a, p_paid_at);
  elsif a.purpose = 'wallet_topup' then
    v_result := _apply_wallet_topup(a, p_paid_at);
  else
    v_result := _apply_bill_payment(a, p_paid_at);
  end if;

  update payment_attempts
     set status = case when v_result ->> 'outcome' = 'duplicate' then 'duplicate' else 'success' end,
         channel = p_channel, gateway_response = p_gateway_response, paid_at = p_paid_at, verified_at = now(),
         transaction_id = case when a.purpose = 'wallet_topup' then null else (v_result ->> 'transaction_id')::uuid end,
         refund_transaction_id = (v_result ->> 'refund_transaction_id')::uuid
   where id = a.id;
  perform audit_event(null, 'payment.confirmed', 'payment_attempt', a.id::text, 'success',
    jsonb_build_object('reference', p_reference, 'source', p_source, 'outcome', v_result ->> 'outcome'));

  return v_result || jsonb_build_object('purpose', a.purpose, 'reference', p_reference, 'user_id', a.user_id,
                                        'target_id', a.target_id);
end $$;

-- ---------------------------------------------------------------------
-- 6. Automatic payments (mandates)
-- ---------------------------------------------------------------------
create table public.wallet_payment_mandates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id),
  source_wallet_id  uuid not null references public.wallet_accounts(id),
  destination_type  text not null check (destination_type in ('osusu_group')),
  destination_id    uuid not null,
  amount            bigint not null check (amount > 0),
  frequency         text not null check (frequency in ('daily','weekly','biweekly','monthly','per_cycle')),
  start_date        date not null,
  end_date          date,
  maximum_total     bigint check (maximum_total is null or maximum_total > 0),
  total_paid        bigint not null default 0,
  max_attempts      int not null default 3 check (max_attempts between 1 and 5),
  retry_hours       int not null default 24 check (retry_hours between 1 and 168),
  status            text not null default 'PENDING_AUTHORIZATION' check (status in ('PENDING_AUTHORIZATION','ACTIVE','PAUSED','CANCELLED','EXPIRED','COMPLETED')),
  auth_method       text,
  auth_challenge_id uuid,
  authorized_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  cancelled_at      timestamptz,
  cancel_reason     text check (char_length(cancel_reason) <= 300),
  check (end_date is null or end_date >= start_date)
);
create unique index wallet_mandates_one_active_idx on public.wallet_payment_mandates (user_id, destination_type, destination_id)
  where status in ('PENDING_AUTHORIZATION','ACTIVE','PAUSED');
create index wallet_mandates_status_idx on public.wallet_payment_mandates (status);
create trigger wallet_mandates_updated_at before update on public.wallet_payment_mandates for each row execute function public.set_updated_at();

create table public.wallet_mandate_runs (
  id              bigint generated always as identity primary key,
  mandate_id      uuid not null references public.wallet_payment_mandates(id),
  contribution_id uuid,
  attempt         int not null,
  status          text not null check (status in ('SUCCESS','INSUFFICIENT_FUNDS','FAILED','SKIPPED')),
  amount          bigint,
  wallet_transaction_id uuid references public.wallet_transactions(id),
  reason          text check (char_length(reason) <= 300),
  created_at      timestamptz not null default now(),
  unique (mandate_id, contribution_id, attempt)
);
create index wallet_mandate_runs_mandate_idx on public.wallet_mandate_runs (mandate_id, contribution_id);
create trigger wallet_mandate_runs_append_only before update or delete on public.wallet_mandate_runs
  for each row execute function public.forbid_mutation();

/**
 * Job: pay due OSUSU contributions for ACTIVE mandates. Never overdraws:
 * insufficient funds are recorded and notified, retried only up to
 * max_attempts, retry_hours apart — never indefinitely.
 */
create or replace function public.run_wallet_mandates(p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m        wallet_payment_mandates%rowtype;
  c        osusu_contributions%rowtype;
  v_tries  int;
  v_last   timestamptz;
  v_res    jsonb;
  v_paid   int := 0;
  v_short  int := 0;
  v_today  date := (now() at time zone 'Africa/Lagos')::date;
begin
  -- Expire mandates past their end date.
  update wallet_payment_mandates set status = 'EXPIRED' where status in ('ACTIVE','PAUSED') and end_date is not null and end_date < v_today;

  for m in select * from wallet_payment_mandates where status = 'ACTIVE' and start_date <= v_today order by created_at limit p_limit loop
    for c in
      select oc.* from osusu_contributions oc
       where oc.group_id = m.destination_id and oc.user_id = m.user_id and oc.status in ('pending','overdue')
         and oc.due_date <= v_today and oc.due_date >= m.start_date
       order by oc.due_date
    loop
      select count(*), max(created_at) into v_tries, v_last from wallet_mandate_runs where mandate_id = m.id and contribution_id = c.id;
      continue when v_tries >= m.max_attempts;
      continue when v_last is not null and v_last > now() - make_interval(hours => m.retry_hours);
      if c.amount > setting_bigint('wallet.max_auto_contribution_kobo', 50000000) or (m.maximum_total is not null and m.total_paid + c.amount > m.maximum_total) then
        insert into wallet_mandate_runs (mandate_id, contribution_id, attempt, status, amount, reason)
        values (m.id, c.id, v_tries + 1, 'SKIPPED', c.amount, 'Above the authorised limit');
        update wallet_payment_mandates set status = 'COMPLETED' where id = m.id and maximum_total is not null and total_paid + c.amount > maximum_total;
        continue;
      end if;
      begin
        v_res := wallet_pay_osusu_contribution(m.user_id, c.id, m.id);
        insert into wallet_mandate_runs (mandate_id, contribution_id, attempt, status, amount, wallet_transaction_id)
        values (m.id, c.id, v_tries + 1, 'SUCCESS', c.amount, (v_res ->> 'wallet_transaction_id')::uuid);
        update wallet_payment_mandates set total_paid = total_paid + c.amount where id = m.id;
        v_paid := v_paid + 1;
      exception when others then
        if sqlerrm like '%INSUFFICIENT_FUNDS%' then
          insert into wallet_mandate_runs (mandate_id, contribution_id, attempt, status, amount, reason)
          values (m.id, c.id, v_tries + 1, 'INSUFFICIENT_FUNDS', c.amount, 'Wallet balance not enough');
          perform enqueue_notification(m.user_id, 'auto_contribution_insufficient', 'reminders', 'Automatic contribution not paid',
            'Your scheduled OSUSU contribution could not be completed because your ACHIEVER Wallet balance is insufficient.',
            jsonb_build_object('group_id', m.destination_id), 'mandate_low:' || m.id || ':' || c.id || ':' || (v_tries + 1));
          v_short := v_short + 1;
        else
          insert into wallet_mandate_runs (mandate_id, contribution_id, attempt, status, amount, reason)
          values (m.id, c.id, v_tries + 1, 'FAILED', c.amount, left(sqlerrm, 300));
        end if;
      end;
    end loop;
  end loop;
  return jsonb_build_object('paid', v_paid, 'insufficient', v_short);
end $$;

-- ---------------------------------------------------------------------
-- 7. Referral reward paid into the wallet (two-person rule kept)
-- ---------------------------------------------------------------------
create or replace function public.wallet_pay_referral_reward(p_reward uuid, p_actor uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w     referral_rewards%rowtype;
  v_wtx uuid;
  v_ref text;
begin
  select * into w from referral_rewards where id = p_reward for update;
  if not found then perform app_error(404, 'REWARD_NOT_FOUND', 'Reward not found'); end if;
  if w.status <> 'APPROVED' then perform app_error(409, 'INVALID_REWARD_TRANSITION', 'Only an approved reward can be paid'); end if;
  if w.approved_by is not null and w.approved_by = p_actor then
    perform app_error(403, 'SECOND_APPROVER_REQUIRED', 'A different administrator must record the payment');
  end if;
  v_wtx := _wallet_tx('referral_reward', w.amount, w.referrer_id, 'Referral reward', jsonb_build_object('reward_id', w.id, 'created_by', p_actor));
  perform _wallet_post(v_wtx, jsonb_build_array(
    jsonb_build_object('account', _system_account('rewards'), 'direction', 'debit', 'amount', w.amount),
    jsonb_build_object('account', ensure_wallet(w.referrer_id), 'direction', 'credit', 'amount', w.amount)));
  select reference into v_ref from wallet_transactions where id = v_wtx;
  perform transition_referral_reward(p_reward, p_actor, 'mark_paid', p_reason, v_ref);
  return jsonb_build_object('status', 'PAID', 'wallet_transaction_id', v_wtx, 'reference', v_ref);
end $$;

-- ---------------------------------------------------------------------
-- 8. Admin adjustments: requested by one administrator, approved by another
-- ---------------------------------------------------------------------
create table public.wallet_adjustment_requests (
  id             uuid primary key default gen_random_uuid(),
  wallet_id      uuid not null references public.wallet_accounts(id),
  direction      text not null check (direction in ('credit','debit')),
  amount         bigint not null check (amount > 0),
  reason         text not null check (char_length(reason) between 10 and 1000),
  requested_by   uuid not null references public.profiles(id),
  status         text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  decided_by     uuid references public.profiles(id),
  decided_at     timestamptz,
  decision_reason text,
  transaction_id uuid references public.wallet_transactions(id),
  created_at     timestamptz not null default now()
);

create or replace function public.wallet_decide_adjustment(p_request uuid, p_actor uuid, p_approve boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  q     wallet_adjustment_requests%rowtype;
  w     wallet_accounts%rowtype;
  v_wtx uuid;
begin
  if char_length(coalesce(trim(p_reason), '')) < 5 then perform app_error(400, 'REASON_REQUIRED', 'Give a reason'); end if;
  select * into q from wallet_adjustment_requests where id = p_request for update;
  if not found or q.status <> 'PENDING' then perform app_error(409, 'NOT_PENDING', 'This adjustment is not pending'); end if;
  if q.requested_by = p_actor then perform app_error(403, 'SECOND_APPROVER_REQUIRED', 'A different administrator must approve this adjustment'); end if;
  select * into w from wallet_accounts where id = q.wallet_id;
  if p_approve then
    v_wtx := _wallet_tx('adjustment', q.amount, w.user_id, 'Account adjustment', jsonb_build_object('created_by', p_actor, 'metadata', jsonb_build_object('request_id', q.id, 'direction', q.direction)));
    perform _wallet_post(v_wtx, case when q.direction = 'credit' then jsonb_build_array(
        jsonb_build_object('account', _system_account('adjustments'), 'direction', 'debit', 'amount', q.amount),
        jsonb_build_object('account', w.id, 'direction', 'credit', 'amount', q.amount))
      else jsonb_build_array(
        jsonb_build_object('account', w.id, 'direction', 'debit', 'amount', q.amount),
        jsonb_build_object('account', _system_account('adjustments'), 'direction', 'credit', 'amount', q.amount)) end);
  end if;
  update wallet_adjustment_requests set status = case when p_approve then 'APPROVED' else 'REJECTED' end, decided_by = p_actor, decided_at = now(),
         decision_reason = p_reason, transaction_id = v_wtx where id = q.id;
  perform audit_event(p_actor, 'admin.wallet.adjustment_' || case when p_approve then 'approved' else 'rejected' end, 'wallet_adjustment', q.id::text, 'success',
    jsonb_build_object('amount', q.amount, 'direction', q.direction, 'reason', p_reason, 'requested_by', q.requested_by));
  return jsonb_build_object('status', case when p_approve then 'APPROVED' else 'REJECTED' end, 'wallet_transaction_id', v_wtx);
end $$;

-- ---------------------------------------------------------------------
-- 9. Transaction approval: purposes, PIN-only method for small amounts
-- ---------------------------------------------------------------------
alter table public.transaction_auth_challenges drop constraint if exists transaction_auth_challenges_purpose_check;
alter table public.transaction_auth_challenges add constraint transaction_auth_challenges_purpose_check
  check (purpose in ('bill_payment','wallet_transfer','wallet_mandate','wallet_payment'));
alter table public.transaction_auth_challenges drop constraint if exists transaction_auth_challenges_method_check;
alter table public.transaction_auth_challenges add constraint transaction_auth_challenges_method_check
  check (method in ('email_otp','device_biometric','pin'));
alter table public.transaction_auth_challenges drop constraint if exists transaction_auth_challenges_check;
alter table public.transaction_auth_challenges add constraint transaction_auth_challenges_check check (
  (method = 'email_otp' and code_hash is not null) or (method = 'device_biometric' and nonce is not null and device_key_id is not null) or method = 'pin');

-- Progressive PIN lockout: each lock in a row lasts longer; repeated locks need a reset.
alter table public.transaction_credentials
  add column lock_count     int not null default 0 check (lock_count >= 0),
  add column last_locked_at timestamptz,
  add column reset_required boolean not null default false;

alter table public.transaction_security_events drop constraint if exists transaction_security_events_type_check;
alter table public.transaction_security_events add constraint transaction_security_events_type_check check (type in (
  'transaction_pin_set','transaction_pin_changed','transaction_pin_failed','transaction_pin_locked','transaction_pin_warning','transaction_pin_review',
  'biometric_enabled','biometric_disabled','biometric_key_invalidated',
  'auth_challenge_issued','auth_challenge_verified','auth_challenge_failed','transaction_authorized',
  'wallet_transfer_large','mandate_created','mandate_cancelled'));

-- ---------------------------------------------------------------------
-- 10. Settings (limits are enforced server-side; changes are audited)
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, description, value_type, category, label, min_value, max_value, options, critical) values
  ('wallet.enabled', 'true', 'ACHIEVER Wallet available to members (see regulatory note in docs/WALLET.md)', 'boolean', 'wallet', 'Wallet', null, null, null, true),
  ('wallet.transfers_enabled', 'true', 'Member-to-member transfers inside ACHIEVER', 'boolean', 'wallet', 'Internal transfers', null, null, null, true),
  ('wallet.topup_min_kobo', '10000', 'Smallest top-up (kobo)', 'integer', 'wallet', 'Minimum top-up (kobo)', 10000, null, null, false),
  ('wallet.topup_max_kobo', '50000000', 'Largest single top-up (kobo)', 'integer', 'wallet', 'Maximum top-up (kobo)', 10000, 1000000000, null, true),
  ('wallet.max_balance_kobo', '500000000', 'Maximum wallet balance (kobo)', 'integer', 'wallet', 'Maximum balance (kobo)', 100000, 10000000000, null, true),
  ('wallet.transfer_min_kobo', '10000', 'Smallest transfer (kobo)', 'integer', 'wallet', 'Minimum transfer (kobo)', 100, null, null, false),
  ('wallet.transfer_single_max_kobo', '20000000', 'Largest single transfer (kobo)', 'integer', 'wallet', 'Single transfer limit (kobo)', 10000, 1000000000, null, true),
  ('wallet.transfer_daily_max_kobo', '50000000', 'Total transfers per day (kobo)', 'integer', 'wallet', 'Daily transfer limit (kobo)', 10000, 5000000000, null, true),
  ('wallet.transfer_review_threshold_kobo', '50000000', 'Transfers at or above this are held for review (kobo)', 'integer', 'wallet', 'Transfer review threshold (kobo)', 10000, null, null, true),
  ('wallet.transfer_fee_kobo', '0', 'Fee per internal transfer (kobo)', 'integer', 'wallet', 'Transfer fee (kobo)', 0, 1000000, null, true),
  ('wallet.bill_daily_max_kobo', '20000000', 'Total wallet-funded bill purchases per day (kobo)', 'integer', 'wallet', 'Daily bill limit (kobo)', 10000, 1000000000, null, true),
  ('wallet.max_auto_contribution_kobo', '50000000', 'Largest single automatic contribution (kobo)', 'integer', 'wallet', 'Max automatic contribution (kobo)', 10000, null, null, true),
  ('wallet.transfer_hourly_max_count', '10', 'Transfers allowed per hour before a pause (velocity check)', 'integer', 'wallet', 'Transfers per hour', 1, 100, null, true),
  ('wallet.new_recipient_step_up_kobo', '2000000', 'First transfer to a new wallet at or above this always needs the emailed code (kobo)', 'integer', 'wallet', 'New recipient step-up (kobo)', 0, null, null, true),
  ('security.transaction_pin_review_after', '3', 'PIN locks in a row before the PIN must be reset', 'integer', 'security', 'PIN locks before reset', 2, 10, null, true),
  ('security.email_code_threshold_kobo', '5000000', 'Payments/transfers at or above this also need an emailed code on the web (kobo)', 'integer', 'security', 'Email code above (kobo)', 0, null, null, true)
on conflict (key) do nothing;

-- Admin permissions (least privilege; adjustments need two different administrators)
insert into public.permissions (code, description) values
  ('wallet.read',   'See wallets, balances and wallet transactions (personal data masked)'),
  ('wallet.manage', 'Freeze or unfreeze wallets and review held transfers'),
  ('wallet.adjust', 'Request or approve wallet adjustments (a second administrator must approve)')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code)
select 'SUPER_ADMIN', code from public.permissions on conflict do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('ADMIN','wallet.read'), ('FINANCE_ADMIN','wallet.read'), ('FINANCE_ADMIN','wallet.manage'), ('FINANCE_ADMIN','wallet.adjust'),
  ('COMPLIANCE_ADMIN','wallet.read'), ('COMPLIANCE_ADMIN','wallet.manage'), ('AUDITOR','wallet.read')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 11. RLS and grants
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['wallet_accounts','wallet_transactions','wallet_ledger_entries','wallet_topups','wallet_holds',
                           'wallet_transfers','wallet_payment_mandates','wallet_mandate_runs','wallet_adjustment_requests']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.wallet_adjustment_requests, public.wallet_holds from authenticated;

create policy wallet_accounts_own on public.wallet_accounts for select to authenticated using (user_id = auth.uid());
create policy wallet_tx_own on public.wallet_transactions for select to authenticated using (user_id = auth.uid() or counterparty_user_id = auth.uid());
create policy wallet_ledger_own on public.wallet_ledger_entries for select to authenticated
  using (exists (select 1 from public.wallet_accounts a where a.id = account_id and a.user_id = auth.uid()));
create policy wallet_topups_own on public.wallet_topups for select to authenticated using (user_id = auth.uid());
create policy wallet_transfers_party on public.wallet_transfers for select to authenticated
  using (sender_user_id = auth.uid() or exists (select 1 from public.wallet_accounts a where a.id = recipient_wallet_id and a.user_id = auth.uid()));
create policy wallet_mandates_own on public.wallet_payment_mandates for select to authenticated using (user_id = auth.uid());
create policy wallet_mandate_runs_own on public.wallet_mandate_runs for select to authenticated
  using (exists (select 1 from public.wallet_payment_mandates m where m.id = mandate_id and m.user_id = auth.uid()));

revoke execute on function
  public.guard_wallet_transaction(), public._wallet_code(), public.ensure_wallet(uuid), public._system_account(text),
public._wallet_post(uuid, jsonb, boolean), public._wallet_tx(text, bigint, uuid, text, jsonb),
  public._apply_wallet_topup(payment_attempts, timestamptz), public.sync_wallet_topup_status(), public.wallet_reverse_topup(uuid, text, text),
  public._wallet_transfer_post(wallet_transfers), public.wallet_execute_transfer(uuid), public.wallet_review_transfer(uuid, uuid, boolean, text),
  public.wallet_pay_bill(uuid), public._bill_refund(bill_payments, text), public._apply_osusu_contribution(payment_attempts, timestamptz),
  public.wallet_pay_osusu_contribution(uuid, uuid, uuid), public.wallet_pay_collector_savings(uuid, uuid, bigint),
  public.run_wallet_mandates(int), public.wallet_pay_referral_reward(uuid, uuid, text), public.wallet_decide_adjustment(uuid, uuid, boolean, text),
  public.record_bill_result(uuid, text, text, text, text, text, int, text, text, text), public.record_bill_reversal(uuid, text, text, text)
from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
