-- =====================================================================
-- ACHIEVER — core relational schema
-- All monetary values are stored as BIGINT in kobo (₦1 = 100 kobo).
-- Financial rows are written ONLY by SECURITY DEFINER functions invoked
-- by the backend with the service role (see 20260923000002).
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.lagos_today() returns date
language sql stable as $$
  select (now() at time zone 'Africa/Lagos')::date
$$;

-- ---------------------------------------------------------------------
-- Identity, roles
-- ---------------------------------------------------------------------
create table public.roles (
  code text primary key check (code in (
    'SUPER_ADMIN','ADMIN','SUPPORT_ADMIN','OSUSU_ADMIN','OSUSU_MEMBER','COLLECTOR','SAVER')),
  description text not null
);

insert into public.roles (code, description) values
  ('SUPER_ADMIN',  'Full platform control, including role management'),
  ('ADMIN',        'Platform operations: users, verification, payouts, reports'),
  ('SUPPORT_ADMIN','Handles support tickets and disputes'),
  ('OSUSU_ADMIN',  'Organises rotational Osusu groups'),
  ('OSUSU_MEMBER', 'Participates in Osusu groups'),
  ('COLLECTOR',    'Holds savings on behalf of individual savers'),
  ('SAVER',        'Saves with a collector');

create table public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  full_name             text not null check (char_length(full_name) between 2 and 120),
  email                 citext not null unique,
  phone                 text not null unique check (phone ~ '^\+234[0-9]{10}$'),
  address               text check (char_length(address) <= 300),
  date_of_birth         date,
  avatar_path           text,
  primary_account_type  text not null check (primary_account_type in ('osusu','collector','personal')),
  account_status        text not null default 'pending_verification'
                        check (account_status in ('pending_verification','active','suspended','closed')),
  status_reason         text,
  email_verified_at     timestamptz,
  phone_verified_at     timestamptz,
  failed_login_count    int not null default 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  last_seen_at          timestamptz,
  sessions_revoked_at   timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create index profiles_full_name_idx on public.profiles using btree (lower(full_name));
create index profiles_status_idx on public.profiles (account_status);

create table public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role_code  text not null references public.roles(code),
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role_code)
);
create index user_roles_role_idx on public.user_roles (role_code);

create table public.otp_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  purpose     text not null check (purpose in ('email_verification','phone_verification','password_reset')),
  channel     text not null check (channel in ('email','sms')),
  code_hash   text not null,
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index otp_codes_lookup_idx on public.otp_codes (user_id, purpose, created_at desc);

create table public.payout_accounts (
  user_id                 uuid primary key references public.profiles(id) on delete cascade,
  bank_code               text not null,
  bank_name               text not null,
  account_name            text not null,
  account_last4           text not null check (account_last4 ~ '^[0-9]{4}$'),
  paystack_recipient_code text,
  verified_at             timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger payout_accounts_updated_at before update on public.payout_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Osusu (rotational group savings)
-- ---------------------------------------------------------------------
create table public.osusu_groups (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 3 and 80),
  description         text check (char_length(description) <= 1000),
  image_path          text,
  admin_id            uuid not null references public.profiles(id),
  contribution_amount bigint not null check (contribution_amount between 10000 and 1000000000),
  currency            char(3) not null default 'NGN' check (currency = 'NGN'),
  frequency           text not null check (frequency in ('daily','weekly','biweekly','monthly')),
  max_members         int not null check (max_members between 2 and 100),
  start_date          date not null,
  grace_period_days   int not null default 1 check (grace_period_days between 0 and 14),
  payout_order_method text not null default 'join_order' check (payout_order_method in ('join_order','random','manual')),
  requires_approval   boolean not null default true,
  meeting_schedule    text check (char_length(meeting_schedule) <= 200),
  join_code           text not null unique check (join_code ~ '^[A-Z0-9]{8}$'),
  status              text not null default 'recruiting' check (status in ('recruiting','active','completed','cancelled')),
  current_cycle       int not null default 0,
  total_cycles        int,
  started_at          timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger osusu_groups_updated_at before update on public.osusu_groups
  for each row execute function public.set_updated_at();
create index osusu_groups_admin_idx on public.osusu_groups (admin_id);
create index osusu_groups_status_idx on public.osusu_groups (status);
create index osusu_groups_name_idx on public.osusu_groups (lower(name));

create table public.osusu_members (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null references public.osusu_groups(id) on delete cascade,
  user_id               uuid not null references public.profiles(id),
  status                text not null default 'pending_approval'
                        check (status in ('pending_approval','active','rejected','removed','left')),
  is_admin              boolean not null default false,
  payout_position       int check (payout_position > 0),
  has_received_payout   boolean not null default false,
  payout_received_cycle int,
  risk_status           text not null default 'good'
                        check (risk_status in ('good','payment_overdue','review_required','risk_review')),
  joined_at             timestamptz not null default now(),
  approved_at           timestamptz,
  removed_at            timestamptz,
  removal_reason        text,
  updated_at            timestamptz not null default now(),
  unique (group_id, user_id),
  constraint osusu_members_position_unique unique (group_id, payout_position) deferrable initially immediate
);
create trigger osusu_members_updated_at before update on public.osusu_members
  for each row execute function public.set_updated_at();
create index osusu_members_user_idx on public.osusu_members (user_id, status);
create index osusu_members_group_idx on public.osusu_members (group_id, status);

-- ---------------------------------------------------------------------
-- Collector (individual savings held by a collector)
-- ---------------------------------------------------------------------
create table public.collector_accounts (
  id                       uuid primary key default gen_random_uuid(),
  collector_id             uuid not null unique references public.profiles(id),
  business_name            text not null check (char_length(business_name) between 3 and 100),
  description              text check (char_length(description) <= 1000),
  operating_area           text check (char_length(operating_area) <= 150),
  default_commission_type  text not null default 'percentage' check (default_commission_type in ('percentage','fixed')),
  -- percentage: basis points (100 = 1%), fixed: kobo
  default_commission_value bigint not null default 0 check (default_commission_value >= 0),
  status                   text not null default 'active' check (status in ('active','suspended')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (default_commission_type <> 'percentage' or default_commission_value <= 2000)
);
create trigger collector_accounts_updated_at before update on public.collector_accounts
  for each row execute function public.set_updated_at();

-- A savings plan between one collector and one saver.
create table public.collector_savers (
  id                    uuid primary key default gen_random_uuid(),
  collector_account_id  uuid not null references public.collector_accounts(id),
  collector_id          uuid not null references public.profiles(id),
  saver_id              uuid not null references public.profiles(id),
  plan_name             text not null default 'Savings plan' check (char_length(plan_name) between 3 and 80),
  frequency             text not null check (frequency in ('daily','weekly','monthly','flexible')),
  expected_amount       bigint check (expected_amount is null or expected_amount > 0),
  start_date            date not null,
  end_date              date not null,
  commission_type       text not null check (commission_type in ('percentage','fixed')),
  commission_value      bigint not null check (commission_value >= 0),
  balance               bigint not null default 0 check (balance >= 0),
  total_contributed     bigint not null default 0 check (total_contributed >= 0),
  total_returned        bigint not null default 0 check (total_returned >= 0),
  status                text not null default 'active'
                        check (status in ('active','matured','return_requested','return_processing','returned','cancelled')),
  matured_at            timestamptz,
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (end_date > start_date),
  check (saver_id <> collector_id),
  check (commission_type <> 'percentage' or commission_value <= 2000)
);
create trigger collector_savers_updated_at before update on public.collector_savers
  for each row execute function public.set_updated_at();
create index collector_savers_account_idx on public.collector_savers (collector_account_id, status);
create index collector_savers_saver_idx on public.collector_savers (saver_id, status);
create index collector_savers_end_idx on public.collector_savers (end_date) where status = 'active';

-- ---------------------------------------------------------------------
-- Bill payments (VTU / utilities via a pluggable provider)
-- ---------------------------------------------------------------------
create table public.bill_payments (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,
  user_id             uuid not null references public.profiles(id),
  category            text not null check (category in ('airtime','data','electricity')),
  service_id          text not null,
  variation_code      text,
  customer_identifier text not null,
  customer_name       text,
  phone               text not null,
  amount              bigint not null check (amount between 5000 and 50000000),
  status              text not null default 'awaiting_payment'
                      check (status in ('awaiting_payment','paid','processing','delivered','failed','refund_pending','refunded','cancelled')),
  payment_reference   text,
  transaction_id      uuid,
  provider            text not null,
  provider_request_id text unique,
  provider_reference  text,
  token               text,
  units               text,
  attempts            int not null default 0,
  last_error          text,
  next_retry_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz
);
create trigger bill_payments_updated_at before update on public.bill_payments
  for each row execute function public.set_updated_at();
create index bill_payments_user_idx on public.bill_payments (user_id, created_at desc);
create index bill_payments_status_idx on public.bill_payments (status, next_retry_at);

-- ---------------------------------------------------------------------
-- Ledger
-- direction is relative to the user who owns the row:
--   debit  = money left the user (contribution, savings, bill)
--   credit = money reached the user (payout, saver return, commission, refund)
-- ---------------------------------------------------------------------
create table public.transactions (
  id                 uuid primary key default gen_random_uuid(),
  reference          text not null unique,
  user_id            uuid not null references public.profiles(id),
  group_id           uuid references public.osusu_groups(id),
  collector_saver_id uuid references public.collector_savers(id),
  bill_payment_id    uuid references public.bill_payments(id),
  type               text not null check (type in (
                       'osusu_contribution','osusu_payout','collector_savings','saver_return',
                       'commission','refund','bill_payment')),
  direction          text not null check (direction in ('debit','credit')),
  amount             bigint not null check (amount > 0),
  currency           char(3) not null default 'NGN',
  provider           text not null check (provider in ('paystack','paystack_transfer','manual','bill_provider','internal')),
  provider_reference text,
  status             text not null check (status in ('pending','processing','success','failed','reversed')),
  description        text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);
create index transactions_user_idx on public.transactions (user_id, created_at desc);
create index transactions_type_status_idx on public.transactions (type, status, created_at desc);
create index transactions_group_idx on public.transactions (group_id) where group_id is not null;
create index transactions_plan_idx on public.transactions (collector_saver_id) where collector_saver_id is not null;
create index transactions_provider_ref_idx on public.transactions (provider_reference);

alter table public.bill_payments
  add constraint bill_payments_transaction_fk foreign key (transaction_id) references public.transactions(id);

-- Ledger rows are immutable except for status progression.
create or replace function public.guard_transaction_update() returns trigger
language plpgsql as $$
begin
  if new.amount <> old.amount or new.user_id <> old.user_id or new.type <> old.type
     or new.direction <> old.direction or new.reference <> old.reference or new.currency <> old.currency then
    raise exception 'ACH:409:LEDGER_IMMUTABLE:Ledger entries cannot be altered';
  end if;
  if old.status in ('success','failed','reversed') and new.status <> old.status
     and not (old.status = 'success' and new.status = 'reversed') then
    raise exception 'ACH:409:LEDGER_FINAL:Ledger entry is already final';
  end if;
  return new;
end $$;
create trigger transactions_guard before update on public.transactions
  for each row execute function public.guard_transaction_update();
create or replace function public.forbid_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'ACH:409:DELETE_FORBIDDEN:Records in % cannot be deleted', tg_table_name;
end $$;
create trigger transactions_no_delete before delete on public.transactions
  for each row execute function public.forbid_delete();

-- Osusu cycles, contributions and payouts -----------------------------
create table public.osusu_cycles (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.osusu_groups(id) on delete cascade,
  cycle_number        int not null check (cycle_number > 0),
  due_date            date not null,
  recipient_member_id uuid not null references public.osusu_members(id),
  member_count        int not null check (member_count > 0),
  expected_amount     bigint not null check (expected_amount >= 0),
  collected_amount    bigint not null default 0 check (collected_amount >= 0),
  paid_count          int not null default 0 check (paid_count >= 0),
  status              text not null default 'upcoming'
                      check (status in ('upcoming','open','funded','payout_pending','paid_out')),
  opened_at           timestamptz,
  funded_at           timestamptz,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  unique (group_id, cycle_number)
);
create index osusu_cycles_status_idx on public.osusu_cycles (group_id, status);

create table public.osusu_contributions (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.osusu_groups(id) on delete cascade,
  cycle_id       uuid not null references public.osusu_cycles(id) on delete cascade,
  cycle_number   int not null,
  member_id      uuid not null references public.osusu_members(id),
  user_id        uuid not null references public.profiles(id),
  amount         bigint not null check (amount > 0),
  due_date       date not null,
  status         text not null default 'pending' check (status in ('pending','paid','overdue')),
  is_late        boolean not null default false,
  paid_at        timestamptz,
  transaction_id uuid references public.transactions(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (cycle_id, member_id)
);
create trigger osusu_contributions_updated_at before update on public.osusu_contributions
  for each row execute function public.set_updated_at();
create index osusu_contributions_user_idx on public.osusu_contributions (user_id, status, due_date);
create index osusu_contributions_group_idx on public.osusu_contributions (group_id, status);
create index osusu_contributions_due_idx on public.osusu_contributions (due_date) where status = 'pending';

create table public.osusu_payouts (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.osusu_groups(id) on delete cascade,
  cycle_id            uuid not null unique references public.osusu_cycles(id) on delete cascade,
  cycle_number        int not null,
  recipient_member_id uuid not null references public.osusu_members(id),
  recipient_user_id   uuid not null references public.profiles(id),
  amount              bigint not null default 0 check (amount >= 0),
  status              text not null default 'scheduled'
                      check (status in ('scheduled','approved','processing','paid','failed','cancelled')),
  payout_reference    text unique,
  execution_mode      text check (execution_mode in ('manual','paystack_transfer')),
  transfer_code       text,
  provider_reference  text,
  approved_by         uuid references public.profiles(id),
  approved_at         timestamptz,
  processed_by        uuid references public.profiles(id),
  paid_at             timestamptz,
  failure_reason      text,
  transaction_id      uuid references public.transactions(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger osusu_payouts_updated_at before update on public.osusu_payouts
  for each row execute function public.set_updated_at();
create index osusu_payouts_status_idx on public.osusu_payouts (status);
create index osusu_payouts_recipient_idx on public.osusu_payouts (recipient_user_id);

-- Collector money movement ----------------------------------------------
create table public.collector_contributions (
  id                 uuid primary key default gen_random_uuid(),
  collector_saver_id uuid not null references public.collector_savers(id),
  saver_id           uuid not null references public.profiles(id),
  amount             bigint not null check (amount > 0),
  status             text not null default 'paid' check (status in ('paid','reversed')),
  paid_at            timestamptz not null,
  transaction_id     uuid not null references public.transactions(id),
  created_at         timestamptz not null default now()
);
create index collector_contributions_plan_idx on public.collector_contributions (collector_saver_id, paid_at desc);

create table public.collector_returns (
  id                 uuid primary key default gen_random_uuid(),
  collector_saver_id uuid not null references public.collector_savers(id),
  saver_id           uuid not null references public.profiles(id),
  collector_id       uuid not null references public.profiles(id),
  gross_amount       bigint not null check (gross_amount >= 0),
  commission_amount  bigint not null check (commission_amount >= 0),
  net_amount         bigint not null check (net_amount >= 0),
  is_early           boolean not null default false,
  reason             text check (char_length(reason) <= 500),
  status             text not null default 'requested'
                     check (status in ('requested','approved','processing','paid','rejected','failed')),
  return_reference   text unique,
  execution_mode     text check (execution_mode in ('manual','paystack_transfer')),
  transfer_code      text,
  provider_reference text,
  requested_by       uuid not null references public.profiles(id),
  requested_at       timestamptz not null default now(),
  approved_by        uuid references public.profiles(id),
  approved_at        timestamptz,
  processed_by       uuid references public.profiles(id),
  paid_at            timestamptz,
  rejection_reason   text,
  failure_reason     text,
  transaction_id     uuid references public.transactions(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (gross_amount = net_amount + commission_amount)
);
create trigger collector_returns_updated_at before update on public.collector_returns
  for each row execute function public.set_updated_at();
create unique index collector_returns_one_open_idx on public.collector_returns (collector_saver_id)
  where status in ('requested','approved','processing');
create index collector_returns_status_idx on public.collector_returns (status);

create table public.collector_commissions (
  id                   uuid primary key default gen_random_uuid(),
  collector_saver_id   uuid not null references public.collector_savers(id),
  collector_account_id uuid not null references public.collector_accounts(id),
  collector_id         uuid not null references public.profiles(id),
  return_id            uuid not null unique references public.collector_returns(id),
  amount               bigint not null check (amount > 0),
  status               text not null default 'accrued' check (status in ('accrued','processing','settled','failed')),
  commission_reference text not null unique,
  execution_mode       text check (execution_mode in ('manual','paystack_transfer')),
  transfer_code        text,
  provider_reference   text,
  transaction_id       uuid references public.transactions(id),
  settled_at           timestamptz,
  failure_reason       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger collector_commissions_updated_at before update on public.collector_commissions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Payments (Paystack) — initiation and confirmation are separate records
-- ---------------------------------------------------------------------
create table public.payment_attempts (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,
  user_id           uuid not null references public.profiles(id),
  purpose           text not null check (purpose in ('osusu_contribution','collector_savings','bill_payment')),
  target_id         uuid not null,
  amount            bigint not null check (amount > 0),
  currency          char(3) not null default 'NGN',
  status            text not null default 'initialized'
                    check (status in ('initialized','success','failed','abandoned','amount_mismatch','duplicate')),
  access_code       text,
  authorization_url text,
  channel           text,
  gateway_response  text,
  paid_at           timestamptz,
  verified_at       timestamptz,
  transaction_id    uuid references public.transactions(id),
  refund_transaction_id uuid references public.transactions(id),
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger payment_attempts_updated_at before update on public.payment_attempts
  for each row execute function public.set_updated_at();
create index payment_attempts_target_idx on public.payment_attempts (target_id, status);
create index payment_attempts_user_idx on public.payment_attempts (user_id, created_at desc);
create index payment_attempts_pending_idx on public.payment_attempts (created_at) where status = 'initialized';

create table public.payment_webhooks (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null check (provider in ('paystack','livekit')),
  event           text not null,
  event_key       text not null unique,
  reference       text,
  signature_valid boolean not null,
  payload         jsonb not null,
  status          text not null default 'received' check (status in ('received','processed','failed','ignored')),
  attempts        int not null default 0,
  error           text,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz
);
create index payment_webhooks_status_idx on public.payment_webhooks (status, received_at);

-- ---------------------------------------------------------------------
-- Notifications (transactional outbox for in-app / email / SMS)
-- ---------------------------------------------------------------------
create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  type           text not null,
  category       text not null check (category in ('security','payments','reminders','payouts','meetings','messages','account','system')),
  title          text not null,
  body           text not null,
  data           jsonb not null default '{}'::jsonb,
  dedupe_key     text unique,
  read_at        timestamptz,
  email_status   text not null default 'skipped' check (email_status in ('pending','sent','failed','skipped')),
  sms_status     text not null default 'skipped' check (sms_status in ('pending','sent','failed','skipped')),
  email_attempts int not null default 0,
  sms_attempts   int not null default 0,
  last_error     text,
  created_at     timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_outbox_idx on public.notifications (created_at)
  where email_status = 'pending' or sms_status = 'pending';

create table public.notification_preferences (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  email_enabled     boolean not null default true,
  sms_enabled       boolean not null default true,
  category_settings jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now()
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Messaging, calls, meetings
-- ---------------------------------------------------------------------
create table public.conversations (
  id                 uuid primary key default gen_random_uuid(),
  type               text not null check (type in ('group','direct','collector')),
  osusu_group_id     uuid unique references public.osusu_groups(id) on delete cascade,
  collector_saver_id uuid unique references public.collector_savers(id) on delete cascade,
  direct_key         text unique,
  title              text,
  created_by         uuid references public.profiles(id),
  last_message_at    timestamptz,
  created_at         timestamptz not null default now(),
  check ((type = 'group') = (osusu_group_id is not null)),
  check ((type = 'collector') = (collector_saver_id is not null)),
  check ((type = 'direct') = (direct_key is not null))
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            text not null default 'member' check (role in ('admin','member')),
  last_read_at    timestamptz,
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id) where left_at is null;

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid references public.profiles(id),
  kind            text not null default 'text' check (kind in ('text','attachment','system','call')),
  body            text check (char_length(body) <= 4000),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index messages_conversation_idx on public.messages (conversation_id, created_at desc);

create table public.message_attachments (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  storage_path    text not null unique,
  file_name       text not null,
  mime_type       text not null,
  size_bytes      int not null check (size_bytes > 0),
  created_at      timestamptz not null default now()
);
create index message_attachments_message_idx on public.message_attachments (message_id);

create table public.meetings (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references public.osusu_groups(id) on delete cascade,
  organizer_id     uuid not null references public.profiles(id),
  title            text not null check (char_length(title) between 3 and 120),
  description      text check (char_length(description) <= 1000),
  starts_at        timestamptz not null,
  duration_minutes int not null default 60 check (duration_minutes between 10 and 480),
  status           text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','cancelled')),
  call_enabled     boolean not null default true,
  call_id          uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger meetings_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();
create index meetings_group_idx on public.meetings (group_id, starts_at);

create table public.calls (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  room_name        text not null unique,
  initiated_by     uuid not null references public.profiles(id),
  call_type        text not null check (call_type in ('voice','video')),
  scope            text not null check (scope in ('direct','group')),
  status           text not null default 'ringing' check (status in ('ringing','active','ended','missed','rejected','cancelled')),
  meeting_id       uuid references public.meetings(id),
  started_at       timestamptz not null default now(),
  answered_at      timestamptz,
  ended_at         timestamptz,
  duration_seconds int,
  ended_by         uuid references public.profiles(id)
);
create index calls_conversation_idx on public.calls (conversation_id, started_at desc);
create unique index calls_one_live_per_conversation on public.calls (conversation_id) where status in ('ringing','active');
alter table public.meetings add constraint meetings_call_fk foreign key (call_id) references public.calls(id);

create table public.call_participants (
  call_id   uuid not null references public.calls(id) on delete cascade,
  user_id   uuid not null references public.profiles(id),
  status    text not null default 'invited' check (status in ('invited','joined','rejected','left','missed')),
  joined_at timestamptz,
  left_at   timestamptz,
  primary key (call_id, user_id)
);
create index call_participants_user_idx on public.call_participants (user_id);

-- ---------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------
create table public.invites (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('osusu_group','collector_saver')),
  group_id             uuid references public.osusu_groups(id) on delete cascade,
  collector_account_id uuid references public.collector_accounts(id) on delete cascade,
  invited_by           uuid not null references public.profiles(id),
  email                citext,
  phone                text,
  token_hash           text not null unique,
  terms                jsonb not null default '{}'::jsonb,
  status               text not null default 'pending' check (status in ('pending','accepted','declined','expired','revoked')),
  expires_at           timestamptz not null,
  accepted_by          uuid references public.profiles(id),
  accepted_at          timestamptz,
  created_at           timestamptz not null default now(),
  check (email is not null or phone is not null),
  check ((kind = 'osusu_group') = (group_id is not null)),
  check ((kind = 'collector_saver') = (collector_account_id is not null))
);
create index invites_group_idx on public.invites (group_id, status);
create index invites_collector_idx on public.invites (collector_account_id, status);

-- ---------------------------------------------------------------------
-- Identity verification & operator undertakings
-- Raw BVN/NIN values are NEVER stored: only a keyed hash + last 4 digits.
-- ---------------------------------------------------------------------
create table public.verification_records (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  id_type            text not null check (id_type in ('bvn','nin')),
  id_number_hash     text not null,
  id_last4           text not null check (id_last4 ~ '^[0-9]{4}$'),
  provider           text not null,
  provider_reference text,
  status             text not null default 'pending' check (status in ('pending','verified','failed','manual_review')),
  name_match         boolean,
  document_path      text,
  failure_reason     text,
  reviewed_by        uuid references public.profiles(id),
  review_note        text,
  created_at         timestamptz not null default now(),
  verified_at        timestamptz,
  updated_at         timestamptz not null default now()
);
create trigger verification_records_updated_at before update on public.verification_records
  for each row execute function public.set_updated_at();
create index verification_records_user_idx on public.verification_records (user_id, created_at desc);
create index verification_records_status_idx on public.verification_records (status);
-- the same identity cannot verify two different accounts
create unique index verification_identity_unique on public.verification_records (id_type, id_number_hash)
  where status = 'verified';

create table public.admin_undertakings (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  undertaking_version text not null,
  role_context        text not null check (role_context in ('OSUSU_ADMIN','COLLECTOR')),
  text_sha256         text not null,
  accepted            boolean not null check (accepted),
  accepted_at         timestamptz not null default now(),
  ip_address          inet,
  user_agent          text,
  unique (user_id, undertaking_version, role_context)
);

-- ---------------------------------------------------------------------
-- Risk / default monitoring (neutral statuses only)
-- ---------------------------------------------------------------------
create table public.risk_flags (
  id                 uuid primary key default gen_random_uuid(),
  subject_user_id    uuid not null references public.profiles(id),
  context            text not null check (context in ('osusu','collector','payments','account')),
  reason_code        text not null check (reason_code in (
                       'post_payout_default','payment_overdue','amount_mismatch','duplicate_payment',
                       'large_transaction','repeated_failed_payments','early_return_request','repeated_complaints','manual')),
  severity           text not null default 'medium' check (severity in ('low','medium','high')),
  status             text not null default 'review_required' check (status in ('review_required','risk_review','resolved','dismissed')),
  group_id           uuid references public.osusu_groups(id),
  collector_saver_id uuid references public.collector_savers(id),
  details            jsonb not null default '{}'::jsonb,
  resolved_by        uuid references public.profiles(id),
  resolved_at        timestamptz,
  resolution_note    text,
  created_at         timestamptz not null default now()
);
create index risk_flags_status_idx on public.risk_flags (status, created_at desc);
create unique index risk_flags_open_unique on public.risk_flags
  (subject_user_id, reason_code, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(collector_saver_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('review_required','risk_review') and reason_code in ('post_payout_default','payment_overdue','repeated_failed_payments');

-- ---------------------------------------------------------------------
-- Support / disputes
-- ---------------------------------------------------------------------
create table public.support_tickets (
  id                         uuid primary key default gen_random_uuid(),
  reference                  text not null unique,
  user_id                    uuid not null references public.profiles(id),
  category                   text not null check (category in (
                               'incorrect_payment','missing_contribution','incorrect_balance','payout_issue',
                               'collector_issue','bill_payment_issue','unauthorized_activity','other')),
  subject                    text not null check (char_length(subject) between 5 and 150),
  description                text not null check (char_length(description) between 10 and 4000),
  status                     text not null default 'open' check (status in ('open','in_progress','awaiting_user','resolved','closed')),
  priority                   text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  related_transaction_id     uuid references public.transactions(id),
  related_group_id           uuid references public.osusu_groups(id),
  related_collector_saver_id uuid references public.collector_savers(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  resolved_at                timestamptz
);
create trigger support_tickets_updated_at before update on public.support_tickets
  for each row execute function public.set_updated_at();
create index support_tickets_user_idx on public.support_tickets (user_id, created_at desc);
create index support_tickets_status_idx on public.support_tickets (status, priority);

create table public.ticket_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.support_tickets(id) on delete cascade,
  author_id  uuid not null references public.profiles(id),
  body       text not null check (char_length(body) between 1 and 4000),
  internal   boolean not null default false,
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);

create table public.ticket_assignments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id),
  assigned_by uuid not null references public.profiles(id),
  active      boolean not null default true,
  assigned_at timestamptz not null default now()
);
create unique index ticket_assignments_active_idx on public.ticket_assignments (ticket_id) where active;

-- ---------------------------------------------------------------------
-- Audit, settings, jobs
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id            bigint generated always as identity primary key,
  actor_id      uuid references public.profiles(id) on delete set null,
  action        text not null,
  resource_type text not null,
  resource_id   text,
  result        text not null default 'success' check (result in ('success','failure','denied')),
  ip_address    inet,
  user_agent    text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_resource_idx on public.audit_logs (resource_type, resource_id);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

create or replace function public.forbid_audit_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'ACH:409:AUDIT_IMMUTABLE:Audit records are append-only';
end $$;
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.forbid_audit_mutation();

create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);

insert into public.app_settings (key, value, description) values
  ('undertaking.current_version', '"2026-09-v1"', 'Version of the operator undertaking users must accept'),
  ('risk.large_collector_contribution_kobo', '50000000', 'Collector contributions at or above this amount (kobo) are flagged for review'),
  ('risk.failed_payments_threshold', '5', 'Failed payment attempts in 24h that trigger a review flag'),
  ('notifications.sms_daily_cap', '10', 'Maximum non-security SMS per user per day'),
  ('payouts.execution_mode', '"manual"', 'manual | paystack_transfer — how approved payouts are executed'),
  ('platform.maintenance_mode', 'false', 'When true, new payments are paused');

create table public.job_locks (
  name       text primary key,
  owner      text not null,
  expires_at timestamptz not null
);
