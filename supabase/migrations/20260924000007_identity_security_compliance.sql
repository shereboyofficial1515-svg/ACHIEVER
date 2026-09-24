-- =====================================================================
-- ACHIEVER — identity, KYC, account security, traceability & compliance
--
-- Extends the existing domain tables (profiles, verification_records,
-- payout_accounts, collector_accounts, transactions, support_tickets,
-- risk_flags, roles) instead of creating parallel versions, and adds the
-- missing security/compliance entities. Everything security-relevant is
-- append-only; corrections are new rows linked to the original.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Generic append-only guard
-- ---------------------------------------------------------------------
create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'ACH:409:APPEND_ONLY:Records in % are append-only and cannot be changed or deleted', tg_table_name;
end $$;

-- ---------------------------------------------------------------------
-- 1. Roles & fine-grained permissions (least privilege)
-- ---------------------------------------------------------------------
alter table public.roles drop constraint if exists roles_code_check;
alter table public.roles add constraint roles_code_check check (code in (
  'SUPER_ADMIN','ADMIN','COMPLIANCE_ADMIN','FINANCE_ADMIN','DISPUTE_ADMIN','SECURITY_ADMIN','SUPPORT_ADMIN',
  'AUDITOR','READ_ONLY_ADMIN','OSUSU_ADMIN','OSUSU_MEMBER','COLLECTOR','SAVER'));

insert into public.roles (code, description) values
  ('COMPLIANCE_ADMIN', 'Reviews KYC, identity documents and collector applications'),
  ('FINANCE_ADMIN',    'Executes payouts, requests/approves reversals and adjustments'),
  ('DISPUTE_ADMIN',    'Investigates dispute cases and manages evidence'),
  ('SECURITY_ADMIN',   'Investigates security events, sessions and account restrictions'),
  ('AUDITOR',          'Read-only access to financial, audit and access records'),
  ('READ_ONLY_ADMIN',  'Read-only operational overview')
on conflict (code) do nothing;
update public.roles set description = 'Legacy operations role (finance operations and user status); prefer the specific roles'
 where code = 'ADMIN';

create table public.permissions (
  code        text primary key,
  description text not null
);

create table public.role_permissions (
  role_code       text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

insert into public.permissions (code, description) values
  ('overview.read',            'See the platform overview'),
  ('users.read',               'Search users and see basic account information'),
  ('users.read_sensitive',     'See private profile data (address, date of birth, contact) — access is logged'),
  ('users.manage_status',      'Suspend, reactivate or close accounts'),
  ('roles.manage',             'Grant or revoke staff roles'),
  ('kyc.review',               'Review identity verification and KYC status'),
  ('kyc.documents.view',       'Open identity documents — access is logged'),
  ('kyc.biometrics.view',      'See liveness / face-match results — access is logged'),
  ('collectors.review',        'Approve or reject collector applications'),
  ('collectors.status',        'Restrict, suspend or reinstate collectors'),
  ('finance.ledger.read',      'Read the transaction ledger and payment attempts'),
  ('finance.payouts.execute',  'Record or retry payout execution'),
  ('finance.reversal.request', 'Request a reversal or adjustment (two-person rule)'),
  ('finance.reversal.approve', 'Approve another person''s reversal/adjustment/sensitive request'),
  ('disputes.manage',          'Investigate and resolve dispute cases'),
  ('disputes.evidence.view',   'Open dispute evidence — access is logged'),
  ('support.tickets',          'Handle general support tickets'),
  ('security.events.read',     'Read security events and sessions'),
  ('security.events.manage',   'Update security events, revoke sessions'),
  ('risk.review',              'Review and change user risk status'),
  ('audit.read',               'Read the audit log'),
  ('data_access.read',         'Read the sensitive data access log'),
  ('trace.read',               'Reconstruct transaction/case traceability chains'),
  ('reports.platform',         'Run platform reports'),
  ('settings.manage',          'Change application settings'),
  ('notifications.broadcast',  'Send platform notices');

insert into public.role_permissions (role_code, permission_code)
select 'SUPER_ADMIN', code from public.permissions;

insert into public.role_permissions (role_code, permission_code) values
  -- legacy ADMIN: operations without KYC documents, biometrics or settings
  ('ADMIN','overview.read'),('ADMIN','users.read'),('ADMIN','users.manage_status'),('ADMIN','finance.ledger.read'),
  ('ADMIN','finance.payouts.execute'),('ADMIN','finance.reversal.request'),('ADMIN','finance.reversal.approve'),
  ('ADMIN','reports.platform'),('ADMIN','notifications.broadcast'),('ADMIN','support.tickets'),('ADMIN','trace.read'),
  ('COMPLIANCE_ADMIN','overview.read'),('COMPLIANCE_ADMIN','users.read'),('COMPLIANCE_ADMIN','users.read_sensitive'),
  ('COMPLIANCE_ADMIN','kyc.review'),('COMPLIANCE_ADMIN','kyc.documents.view'),('COMPLIANCE_ADMIN','kyc.biometrics.view'),
  ('COMPLIANCE_ADMIN','collectors.review'),('COMPLIANCE_ADMIN','collectors.status'),('COMPLIANCE_ADMIN','risk.review'),
  ('COMPLIANCE_ADMIN','audit.read'),('COMPLIANCE_ADMIN','trace.read'),
  ('FINANCE_ADMIN','overview.read'),('FINANCE_ADMIN','users.read'),('FINANCE_ADMIN','finance.ledger.read'),
  ('FINANCE_ADMIN','finance.payouts.execute'),('FINANCE_ADMIN','finance.reversal.request'),
  ('FINANCE_ADMIN','finance.reversal.approve'),('FINANCE_ADMIN','reports.platform'),('FINANCE_ADMIN','trace.read'),
  ('DISPUTE_ADMIN','overview.read'),('DISPUTE_ADMIN','users.read'),('DISPUTE_ADMIN','disputes.manage'),
  ('DISPUTE_ADMIN','disputes.evidence.view'),('DISPUTE_ADMIN','support.tickets'),('DISPUTE_ADMIN','finance.ledger.read'),
  ('DISPUTE_ADMIN','finance.reversal.request'),('DISPUTE_ADMIN','trace.read'),
  ('SECURITY_ADMIN','overview.read'),('SECURITY_ADMIN','users.read'),('SECURITY_ADMIN','users.read_sensitive'),
  ('SECURITY_ADMIN','users.manage_status'),('SECURITY_ADMIN','security.events.read'),('SECURITY_ADMIN','security.events.manage'),
  ('SECURITY_ADMIN','risk.review'),('SECURITY_ADMIN','audit.read'),('SECURITY_ADMIN','disputes.evidence.view'),
  ('SECURITY_ADMIN','trace.read'),
  ('SUPPORT_ADMIN','overview.read'),('SUPPORT_ADMIN','users.read'),('SUPPORT_ADMIN','support.tickets'),
  ('AUDITOR','overview.read'),('AUDITOR','users.read'),('AUDITOR','finance.ledger.read'),('AUDITOR','audit.read'),
  ('AUDITOR','data_access.read'),('AUDITOR','security.events.read'),('AUDITOR','disputes.evidence.view'),
  ('AUDITOR','reports.platform'),('AUDITOR','trace.read'),
  ('READ_ONLY_ADMIN','overview.read'),('READ_ONLY_ADMIN','users.read');

create or replace function public.has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles ur join role_permissions rp on rp.role_code = ur.role_code
                 where ur.user_id = auth.uid() and rp.permission_code = p_permission)
$$;

create or replace function public.is_platform_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid()
                 and role_code in ('SUPER_ADMIN','ADMIN','COMPLIANCE_ADMIN','FINANCE_ADMIN','DISPUTE_ADMIN',
                                   'SECURITY_ADMIN','SUPPORT_ADMIN','AUDITOR','READ_ONLY_ADMIN'))
$$;

-- ---------------------------------------------------------------------
-- 2. User master profile (extends profiles)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column first_name        text check (char_length(first_name) between 1 and 60),
  add column middle_name       text check (char_length(middle_name) <= 60),
  add column last_name         text check (char_length(last_name) between 1 and 60),
  add column preferred_name    text check (char_length(preferred_name) <= 60),
  add column gender            text check (gender in ('female','male','other','prefer_not_to_say')),
  add column nationality       char(2) default 'NG' check (nationality ~ '^[A-Z]{2}$'),
  add column occupation        text check (char_length(occupation) <= 80),
  add column employment_status text check (employment_status in ('employed','self_employed','business_owner','student','unemployed','retired','other')),
  add column business_name     text check (char_length(business_name) <= 120),
  add column country           char(2) default 'NG' check (country ~ '^[A-Z]{2}$'),
  add column state_code        text references public.ng_states(code),
  add column lga_id            int references public.ng_lgas(id),
  add column city              text check (char_length(city) <= 80),
  add column address_unit      text check (char_length(address_unit) <= 40),
  add column postal_code       text check (char_length(postal_code) <= 12),
  add column address_verification_status text not null default 'unverified'
             check (address_verification_status in ('unverified','pending','verified','failed')),
  add column address_verified_at timestamptz,
  add column show_public_location boolean not null default true,
  add column deactivated_at    timestamptz,
  add column deactivation_reason text;

comment on column public.profiles.address is 'Residential address line (PRIVATE). Never shown publicly.';
comment on column public.profiles.date_of_birth is 'Authoritative DOB; age is always derived, never stored.';

-- LGA must belong to the selected state.
create or replace function public.check_profile_location() returns trigger
language plpgsql as $$
begin
  if new.lga_id is not null and (new.state_code is null or not exists (
       select 1 from ng_lgas where id = new.lga_id and state_code = new.state_code)) then
    raise exception 'ACH:422:INVALID_LGA:The selected LGA does not belong to the selected state';
  end if;
  return new;
end $$;
create trigger profiles_location_check before insert or update of state_code, lga_id on public.profiles
  for each row execute function public.check_profile_location();

create or replace function public.age_years(p_dob date) returns int
language sql stable as $$ select case when p_dob is null then null else extract(year from age(lagos_today(), p_dob))::int end $$;

-- ---------------------------------------------------------------------
-- 3. Identity documents (extends verification_records) & KYC profile
-- ---------------------------------------------------------------------
alter table public.verification_records drop constraint if exists verification_records_id_type_check;
alter table public.verification_records add constraint verification_records_id_type_check
  check (id_type in ('bvn','nin','passport','drivers_licence','voters_card'));
alter table public.verification_records drop constraint if exists verification_records_id_last4_check;
alter table public.verification_records add constraint verification_records_id_last4_check
  check (id_last4 ~ '^[0-9A-Z]{4}$');
alter table public.verification_records
  add column issuing_country  char(2) not null default 'NG',
  add column document_number_masked text,
  add column issue_date       date,
  add column expiry_date      date,
  add column liveness_status  text not null default 'not_performed'
             check (liveness_status in ('not_performed','passed','failed','unavailable')),
  add column face_match_score numeric(5,2),
  add column liveness_reference text,
  add column liveness_checked_at timestamptz;

create table public.kyc_profiles (
  user_id              uuid primary key references public.profiles(id) on delete cascade,
  level                int not null default 0 check (level between 0 and 3),
  status               text not null default 'not_started' check (status in (
                         'not_started','pending','in_review','verified','failed','expired','requires_update','restricted')),
  provider             text,
  provider_reference   text,
  verified_at          timestamptz,
  expires_at           date,
  attempt_count        int not null default 0,
  failure_reason       text,
  manual_review_status text check (manual_review_status in ('not_required','queued','in_review','completed')),
  reviewer_id          uuid references public.profiles(id),
  reviewed_at          timestamptz,
  restricted           boolean not null default false,
  restriction_reason   text,
  updated_at           timestamptz not null default now()
);
create index kyc_profiles_status_idx on public.kyc_profiles (status, level);

create table public.kyc_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  from_status text,
  to_status   text not null,
  from_level  int,
  to_level    int not null,
  actor_id    uuid references public.profiles(id),
  reason      text,
  created_at  timestamptz not null default now()
);
create index kyc_events_user_idx on public.kyc_events (user_id, created_at desc);
create trigger kyc_events_append_only before update or delete on public.kyc_events
  for each row execute function public.forbid_mutation();

create or replace function public.log_kyc_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.level is distinct from old.level then
    insert into kyc_events (user_id, from_status, to_status, from_level, to_level, actor_id, reason)
    values (new.user_id, case when tg_op = 'UPDATE' then old.status end, new.status,
            case when tg_op = 'UPDATE' then old.level end, new.level, new.reviewer_id,
            coalesce(new.restriction_reason, new.failure_reason));
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger kyc_profiles_history before insert or update on public.kyc_profiles
  for each row execute function public.log_kyc_change();

/*
  KYC levels (progressive):
    0  email verified
    1  + phone verified + legal names + date of birth + state/LGA/city
    2  + government ID verified (not expired)
    3  + liveness passed + address verified
*/
create or replace function public.recompute_kyc(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p        profiles%rowtype;
  latest   verification_records%rowtype;
  valid_id verification_records%rowtype;
  k        kyc_profiles%rowtype;
  v_level  int := 0;
  v_status text;
  v_basic  boolean;
  v_attempts int;
begin
  select * into p from profiles where id = p_user_id;
  if not found then return null; end if;
  select * into latest from verification_records where user_id = p_user_id order by created_at desc limit 1;
  select * into valid_id from verification_records
   where user_id = p_user_id and status = 'verified' and (expiry_date is null or expiry_date >= lagos_today())
   order by verified_at desc nulls last limit 1;
  select count(*) into v_attempts from verification_records where user_id = p_user_id;

  v_basic := p.first_name is not null and p.last_name is not null and p.date_of_birth is not null
             and p.state_code is not null and p.lga_id is not null and p.city is not null;

  if p.email_verified_at is not null then v_level := 0; end if;
  if p.email_verified_at is not null and p.phone_verified_at is not null and v_basic then v_level := 1; end if;
  if v_level = 1 and valid_id.id is not null then v_level := 2; end if;
  if v_level = 2 and valid_id.liveness_status = 'passed' and p.address_verification_status = 'verified' then v_level := 3; end if;

  v_status := case
    when latest.id is null then 'not_started'
    when valid_id.id is not null and not v_basic then 'requires_update'
    when valid_id.id is not null then 'verified'
    when latest.status = 'verified' and latest.expiry_date < lagos_today() then 'expired'
    when latest.status = 'manual_review' then 'in_review'
    when latest.status = 'pending' then 'pending'
    when latest.status = 'failed' then 'failed'
    else 'pending' end;

  insert into kyc_profiles (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into k from kyc_profiles where user_id = p_user_id for update;
  if k.restricted then v_status := 'restricted'; end if;

  update kyc_profiles set
    level = v_level,
    status = v_status,
    provider = coalesce(valid_id.provider, latest.provider),
    provider_reference = coalesce(valid_id.provider_reference, latest.provider_reference),
    verified_at = valid_id.verified_at,
    expires_at = valid_id.expiry_date,
    attempt_count = v_attempts,
    failure_reason = case when v_status = 'failed' then latest.failure_reason else null end,
    manual_review_status = case when latest.status = 'manual_review' then 'queued'
                                when latest.reviewed_by is not null then 'completed' else 'not_required' end,
    reviewer_id = latest.reviewed_by,
    reviewed_at = case when latest.reviewed_by is not null then latest.updated_at end
  where user_id = p_user_id;
  return jsonb_build_object('level', v_level, 'status', v_status);
end $$;

-- ---------------------------------------------------------------------
-- 4. Devices, sessions, step-up verification
-- ---------------------------------------------------------------------
create table public.user_devices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  device_id_hash text not null,
  label          text not null,
  device_type    text not null default 'unknown' check (device_type in ('desktop','mobile','tablet','unknown')),
  os             text,
  browser        text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  removed_at     timestamptz,
  unique (user_id, device_id_hash)
);

create table public.user_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  device_id      uuid references public.user_devices(id),
  auth_method    text not null check (auth_method in ('password','registration','password_reset')),
  app_version    text,
  ip_address     inet,
  user_agent     text,
  created_at     timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  step_up_at     timestamptz,
  revoked_at     timestamptz,
  revoked_reason text
);
create index user_sessions_user_idx on public.user_sessions (user_id, created_at desc);

alter table public.payment_attempts add column session_id uuid references public.user_sessions(id);

-- One-time codes gain purposes for contact changes and step-up, bound to a pending value.
alter table public.otp_codes drop constraint if exists otp_codes_purpose_check;
alter table public.otp_codes add constraint otp_codes_purpose_check check (purpose in (
  'email_verification','phone_verification','password_reset','step_up','email_change','phone_change','payout_account_change'));
alter table public.otp_codes add column pending_value text;

-- ---------------------------------------------------------------------
-- 5. Append-only account change history & security events
-- ---------------------------------------------------------------------
create table public.account_change_history (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id),
  event_type  text not null check (event_type in (
                'password_changed','password_reset','phone_changed','email_changed','name_changed','dob_changed',
                'address_changed','identity_changed','payment_account_added','payment_account_changed',
                'collector_status_changed','group_role_changed','mfa_changed','recovery_changed',
                'device_added','device_removed','risk_status_changed','account_deactivated','kyc_restriction_changed')),
  previous_ref text,
  new_ref      text,
  actor_id     uuid references public.profiles(id),
  session_id   uuid references public.user_sessions(id),
  ip_address   inet,
  reason       text,
  created_at   timestamptz not null default now()
);
create index account_change_history_user_idx on public.account_change_history (user_id, created_at desc);
create trigger account_change_history_append_only before update or delete on public.account_change_history
  for each row execute function public.forbid_mutation();

create table public.security_events (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references public.profiles(id),
  event_type             text not null check (event_type in (
                           'failed_logins','account_locked','new_device','password_reset','payment_account_change',
                           'failed_payments','unusual_transaction','rapid_withdrawal','large_transaction','repeated_disputes',
                           'collector_settlement_delay','account_takeover_indicator','identity_verification_failure',
                           'admin_action','otp_failures','unusual_session','session_revoked')),
  severity               text not null check (severity in ('low','medium','high','critical')),
  description            text not null,
  session_id             uuid references public.user_sessions(id),
  related_transaction_id uuid references public.transactions(id),
  related_group_id       uuid references public.osusu_groups(id),
  related_case_id        uuid references public.support_tickets(id),
  detection_source       text not null default 'system' check (detection_source in ('system','user_report','admin','provider')),
  status                 text not null default 'flagged' check (status in (
                           'flagged','review_required','suspicious_activity','account_security_review','resolved','dismissed')),
  resolution             text,
  reviewed_by            uuid references public.profiles(id),
  reviewed_at            timestamptz,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now()
);
create index security_events_user_idx on public.security_events (user_id, created_at desc);
create index security_events_status_idx on public.security_events (status, severity, created_at desc);

-- Only investigation fields may change; the observation itself is immutable.
create or replace function public.guard_security_event() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'ACH:409:APPEND_ONLY:Security events cannot be deleted'; end if;
  if new.user_id is distinct from old.user_id or new.event_type <> old.event_type or new.severity <> old.severity
     or new.description <> old.description or new.created_at <> old.created_at or new.metadata <> old.metadata
     or new.related_transaction_id is distinct from old.related_transaction_id then
    raise exception 'ACH:409:APPEND_ONLY:Only the investigation status of a security event can change';
  end if;
  return new;
end $$;
create trigger security_events_guard before update or delete on public.security_events
  for each row execute function public.guard_security_event();

-- ---------------------------------------------------------------------
-- 6. Risk profile (explainable; no opaque score)
-- ---------------------------------------------------------------------
create table public.risk_profiles (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  risk_status        text not null default 'normal' check (risk_status in ('normal','review_required','restricted')),
  restriction_reason text,
  last_reviewed_at   timestamptz,
  reviewed_by        uuid references public.profiles(id),
  review_notes       text,
  updated_at         timestamptz not null default now()
);

alter table public.risk_flags drop constraint if exists risk_flags_reason_code_check;
alter table public.risk_flags add constraint risk_flags_reason_code_check check (reason_code in (
  'post_payout_default','payment_overdue','amount_mismatch','duplicate_payment','large_transaction',
  'repeated_failed_payments','early_return_request','repeated_complaints','manual',
  'collector_settlement_delay','payment_account_change','kyc_failure'));

-- ---------------------------------------------------------------------
-- 7. Payment accounts: status, cooldown, change history, destination snapshots
-- ---------------------------------------------------------------------
alter table public.payout_accounts
  add column status         text not null default 'verified' check (status in ('verified','cooldown','disabled')),
  add column cooldown_until timestamptz,
  add column provider       text not null default 'paystack',
  add column change_count   int not null default 0;

create table public.payment_account_changes (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references public.profiles(id),
  previous_bank_name  text,
  previous_last4      text,
  new_bank_name       text not null,
  new_last4           text not null,
  new_account_name    text not null,
  verification_method text not null check (verification_method in ('first_account','otp_email','otp_sms')),
  actor_id            uuid not null references public.profiles(id),
  session_id          uuid references public.user_sessions(id),
  ip_address          inet,
  reason              text,
  cooldown_until      timestamptz,
  created_at          timestamptz not null default now()
);
create index payment_account_changes_user_idx on public.payment_account_changes (user_id, created_at desc);
create trigger payment_account_changes_append_only before update or delete on public.payment_account_changes
  for each row execute function public.forbid_mutation();

-- Snapshot the verified destination at approval so later account changes cannot
-- redirect an already-approved payout, and the ledger records where money went.
alter table public.osusu_payouts
  add column destination_bank_name text, add column destination_last4 text, add column destination_account_name text,
  add column hold_reason text, add column risk_evaluation jsonb;
alter table public.collector_returns
  add column destination_bank_name text, add column destination_last4 text, add column destination_account_name text,
  add column hold_reason text, add column risk_evaluation jsonb;
alter table public.collector_commissions
  add column destination_bank_name text, add column destination_last4 text, add column destination_account_name text,
  add column hold_reason text, add column risk_evaluation jsonb;

create or replace function public.snapshot_payout_destination() returns trigger
language plpgsql security definer set search_path = public as $$
declare pa payout_accounts%rowtype; v_user uuid;
begin
  if (tg_op = 'INSERT' and new.status in ('approved','accrued'))
     or (tg_op = 'UPDATE' and new.status in ('approved','accrued') and old.status is distinct from new.status) then
    v_user := case tg_table_name
      when 'osusu_payouts' then (to_jsonb(new) ->> 'recipient_user_id')::uuid
      when 'collector_returns' then (to_jsonb(new) ->> 'saver_id')::uuid
      else (to_jsonb(new) ->> 'collector_id')::uuid end;
    select * into pa from payout_accounts where user_id = v_user;
    new.destination_bank_name := pa.bank_name;
    new.destination_last4 := pa.account_last4;
    new.destination_account_name := pa.account_name;
  end if;
  return new;
end $$;
create trigger osusu_payouts_destination before insert or update on public.osusu_payouts
  for each row execute function public.snapshot_payout_destination();
create trigger collector_returns_destination before insert or update on public.collector_returns
  for each row execute function public.snapshot_payout_destination();
create trigger collector_commissions_destination before insert or update on public.collector_commissions
  for each row execute function public.snapshot_payout_destination();

-- ---------------------------------------------------------------------
-- 8. Collector profile & approval workflow (extends collector_accounts)
-- ---------------------------------------------------------------------
alter table public.collector_accounts drop constraint if exists collector_accounts_status_check;
alter table public.collector_accounts add constraint collector_accounts_status_check
  check (status in ('pending_review','verified','active','restricted','suspended','revoked','rejected'));
alter table public.collector_accounts alter column status set default 'pending_review';
alter table public.collector_accounts
  add column approved_by      uuid references public.profiles(id),
  add column approved_at      timestamptz,
  add column rejection_reason text,
  add column status_reason    text,
  add column status_changed_at timestamptz;

create table public.collector_status_history (
  id                   bigint generated always as identity primary key,
  collector_account_id uuid not null references public.collector_accounts(id),
  from_status          text,
  to_status            text not null,
  actor_id             uuid references public.profiles(id),
  reason               text not null,
  approval_request_id  uuid,
  created_at           timestamptz not null default now()
);
create index collector_status_history_idx on public.collector_status_history (collector_account_id, created_at desc);
create trigger collector_status_history_append_only before update or delete on public.collector_status_history
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------
-- 9. Two-person approval for sensitive actions
-- ---------------------------------------------------------------------
create table public.sensitive_action_requests (
  id               uuid primary key default gen_random_uuid(),
  action           text not null check (action in (
                     'transaction_reversal','transaction_adjustment','collector_revoke','risk_restriction_lift','large_payout_confirm')),
  target_type      text not null,
  target_id        uuid not null,
  payload          jsonb not null default '{}'::jsonb,
  reason           text not null check (char_length(reason) >= 10),
  requested_by     uuid not null references public.profiles(id),
  requested_at     timestamptz not null default now(),
  status           text not null default 'pending' check (status in ('pending','approved','rejected','executed','expired','cancelled')),
  decided_by       uuid references public.profiles(id),
  decided_at       timestamptz,
  decision_note    text,
  executed_at      timestamptz,
  execution_result jsonb,
  expires_at       timestamptz not null default now() + interval '48 hours',
  check (decided_by is null or decided_by <> requested_by)
);
create index sensitive_action_requests_status_idx on public.sensitive_action_requests (status, requested_at desc);
create unique index sensitive_action_one_open on public.sensitive_action_requests (action, target_id)
  where status in ('pending','approved');

create or replace function public._consume_approval(p_request_id uuid, p_action text, p_target uuid, p_executor uuid)
returns sensitive_action_requests
language plpgsql security definer set search_path = public as $$
declare r sensitive_action_requests%rowtype;
begin
  select * into r from sensitive_action_requests where id = p_request_id for update;
  if not found then perform app_error(404, 'APPROVAL_NOT_FOUND', 'Approval request not found'); end if;
  if r.action <> p_action or r.target_id <> p_target then
    perform app_error(409, 'APPROVAL_MISMATCH', 'This approval does not authorise that action');
  end if;
  if r.status <> 'approved' then perform app_error(409, 'APPROVAL_REQUIRED', 'A second authorised person must approve this action first'); end if;
  if r.expires_at < now() then
    update sensitive_action_requests set status = 'expired' where id = r.id;
    perform app_error(409, 'APPROVAL_EXPIRED', 'This approval has expired');
  end if;
  update sensitive_action_requests set status = 'executed', executed_at = now() where id = r.id;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 10. Transaction traceability, reversals and adjustments
-- ---------------------------------------------------------------------
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check check (type in (
  'osusu_contribution','osusu_payout','collector_savings','saver_return','commission','refund','bill_payment',
  'reversal','adjustment','fee','settlement'));
alter table public.transactions drop constraint if exists transactions_provider_check;
alter table public.transactions add constraint transactions_provider_check
  check (provider in ('paystack','paystack_transfer','manual','bill_provider','internal'));
alter table public.transactions
  add column related_transaction_id uuid references public.transactions(id),
  add column counterparty_user_id   uuid references public.profiles(id),
  add column collector_id           uuid references public.profiles(id),
  add column channel                text,
  add column session_id             uuid references public.user_sessions(id),
  add column processed_at           timestamptz,
  add column settled_at             timestamptz,
  add column failure_reason         text,
  add column dispute_case_id        uuid references public.support_tickets(id),
  add column destination_bank_name  text,
  add column destination_last4      text,
  add column created_by             uuid references public.profiles(id);
create index transactions_related_idx on public.transactions (related_transaction_id) where related_transaction_id is not null;
create index transactions_collector_idx on public.transactions (collector_id) where collector_id is not null;
create unique index transactions_one_reversal on public.transactions (related_transaction_id) where type = 'reversal';

create or replace function public.transactions_fill_trace() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_src jsonb;
begin
  -- Collections: channel and authenticated session come from the verified checkout.
  if new.provider = 'paystack' and new.provider_reference is not null and new.type <> 'refund' then
    select a.channel, a.session_id into new.channel, new.session_id
      from payment_attempts a where a.reference = new.provider_reference;
  end if;
  if new.collector_saver_id is not null and new.collector_id is null then
    select collector_id into new.collector_id from collector_savers where id = new.collector_saver_id;
  end if;
  -- Disbursements: destination recorded from the approval-time snapshot.
  if new.type = 'osusu_payout' then
    select to_jsonb(p) into v_src from osusu_payouts p where p.id = (new.metadata ->> 'payout_id')::uuid;
  elsif new.type = 'saver_return' then
    select to_jsonb(r) into v_src from collector_returns r where r.id = (new.metadata ->> 'return_id')::uuid;
  elsif new.type = 'commission' then
    select to_jsonb(c) into v_src from collector_commissions c where c.id = (new.metadata ->> 'commission_id')::uuid;
  end if;
  if v_src is not null then
    new.destination_bank_name := v_src ->> 'destination_bank_name';
    new.destination_last4 := v_src ->> 'destination_last4';
  end if;
  if new.status = 'success' then new.processed_at := coalesce(new.processed_at, new.completed_at, now()); end if;
  return new;
end $$;
create trigger transactions_trace before insert on public.transactions
  for each row execute function public.transactions_fill_trace();

-- confirm_payment() records the verified channel on the attempt after the ledger
-- row is written; carry it onto that ledger row so the trail is complete.
create or replace function public.propagate_payment_channel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.transaction_id is not null and new.channel is not null then
    update transactions set channel = new.channel, session_id = coalesce(session_id, new.session_id)
     where id = new.transaction_id and channel is null;
  end if;
  return new;
end $$;
create trigger payment_attempts_channel after update of transaction_id, channel on public.payment_attempts
  for each row execute function public.propagate_payment_channel();

-- A completed transaction is never edited: it is REVERSED by a linked entry.
create or replace function public.reverse_transaction(p_transaction_id uuid, p_request_id uuid, p_executor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t   transactions%rowtype;
  req sensitive_action_requests%rowtype;
  c   osusu_contributions%rowtype;
  s   collector_savers%rowtype;
  g   osusu_groups%rowtype;
  v_rev uuid;
  v_refund uuid;
begin
  select * into t from transactions where id = p_transaction_id for update;
  if not found then perform app_error(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found'); end if;
  req := _consume_approval(p_request_id, 'transaction_reversal', p_transaction_id, p_executor);
  if t.status <> 'success' then perform app_error(409, 'NOT_REVERSIBLE', 'Only successful transactions can be reversed'); end if;
  if t.type not in ('osusu_contribution','collector_savings') then
    perform app_error(422, 'REVERSAL_NOT_SUPPORTED', 'This transaction type cannot be reversed; record an adjustment instead');
  end if;

  if t.type = 'osusu_contribution' then
    select * into c from osusu_contributions where transaction_id = t.id for update;
    if not exists (select 1 from osusu_payouts where cycle_id = c.cycle_id and status = 'scheduled') then
      perform app_error(409, 'REVERSAL_BLOCKED_PAYOUT', 'The cycle payout has already been approved or paid; resolve through an adjustment');
    end if;
    select * into g from osusu_groups where id = c.group_id;
    update osusu_contributions
       set status = case when due_date + g.grace_period_days < lagos_today() then 'overdue' else 'pending' end,
           paid_at = null, is_late = false, transaction_id = null
     where id = c.id;
    update osusu_cycles
       set collected_amount = collected_amount - c.amount, paid_count = paid_count - 1,
           status = case when status = 'funded' then 'open' else status end,
           funded_at = case when status = 'funded' then null else funded_at end
     where id = c.cycle_id;
  else
    select * into s from collector_savers where id = t.collector_saver_id for update;
    if s.status not in ('active','matured','return_requested') or s.balance < t.amount then
      perform app_error(409, 'REVERSAL_BLOCKED_PLAN', 'The savings plan can no longer absorb this reversal');
    end if;
    update collector_savers set balance = balance - t.amount, total_contributed = total_contributed - t.amount where id = s.id;
    update collector_contributions set status = 'reversed' where transaction_id = t.id;
  end if;

  insert into transactions (reference, user_id, group_id, collector_saver_id, type, direction, amount, provider,
                            status, description, metadata, completed_at, related_transaction_id, created_by, collector_id)
  values (new_reference('ACH-RV'), t.user_id, t.group_id, t.collector_saver_id, 'reversal',
          case when t.direction = 'debit' then 'credit' else 'debit' end, t.amount, 'internal', 'success',
          'Reversal of ' || t.reference,
          jsonb_build_object('reason', req.reason, 'approval_request_id', req.id, 'requested_by', req.requested_by,
                             'approved_by', req.decided_by),
          now(), t.id, p_executor, t.collector_id)
  returning id into v_rev;
  update transactions set status = 'reversed' where id = t.id;

  if coalesce((req.payload ->> 'refund')::boolean, false) then
    v_refund := _create_refund_tx(t.user_id, t.amount, t.provider_reference, 'reversal', t.group_id, t.collector_saver_id);
  end if;

  perform enqueue_notification(t.user_id, 'transaction_reversed', 'payments', 'Transaction reversed',
    format('Transaction %s (%s) was reversed after review.%s', t.reference, fmt_naira(t.amount),
           case when v_refund is not null then ' A refund has been initiated.' else '' end),
    jsonb_build_object('transaction_id', t.id, 'reversal_id', v_rev), 'reversed:' || t.id);
  perform audit_event(p_executor, 'transaction.reversed', 'transaction', t.id::text, 'success',
    jsonb_build_object('reversal_id', v_rev, 'approval_request_id', req.id, 'refund_transaction_id', v_refund));
  update sensitive_action_requests set execution_result = jsonb_build_object('reversal_transaction_id', v_rev, 'refund_transaction_id', v_refund)
   where id = req.id;
  return jsonb_build_object('reversal_transaction_id', v_rev, 'refund_transaction_id', v_refund);
end $$;

-- Ledger-only correction, linked to the original entry.
create or replace function public.record_adjustment(p_request_id uuid, p_executor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare req sensitive_action_requests%rowtype; v_id uuid; v_related transactions%rowtype;
begin
  select * into req from sensitive_action_requests where id = p_request_id;
  if not found then perform app_error(404, 'APPROVAL_NOT_FOUND', 'Approval request not found'); end if;
  req := _consume_approval(p_request_id, 'transaction_adjustment', req.target_id, p_executor);
  select * into v_related from transactions where id = (req.payload ->> 'related_transaction_id')::uuid;
  insert into transactions (reference, user_id, group_id, collector_saver_id, type, direction, amount, provider, status,
                            description, metadata, completed_at, related_transaction_id, created_by)
  values (new_reference('ACH-AJ'), (req.payload ->> 'user_id')::uuid, v_related.group_id, v_related.collector_saver_id,
          'adjustment', req.payload ->> 'direction', (req.payload ->> 'amount')::bigint, 'internal', 'success',
          coalesce(req.payload ->> 'description', 'Ledger adjustment'),
          jsonb_build_object('reason', req.reason, 'approval_request_id', req.id, 'requested_by', req.requested_by,
                             'approved_by', req.decided_by),
          now(), v_related.id, p_executor)
  returning id into v_id;
  perform audit_event(p_executor, 'transaction.adjusted', 'transaction', v_id::text, 'success',
    jsonb_build_object('approval_request_id', req.id, 'related_transaction_id', v_related.id));
  update sensitive_action_requests set execution_result = jsonb_build_object('adjustment_transaction_id', v_id) where id = req.id;
  return jsonb_build_object('adjustment_transaction_id', v_id);
end $$;

-- ---------------------------------------------------------------------
-- 11. Collector status changes (audited, revocation needs two people)
-- ---------------------------------------------------------------------
create or replace function public.set_collector_status(
  p_account_id uuid, p_status text, p_actor uuid, p_reason text, p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a collector_accounts%rowtype; v_req sensitive_action_requests%rowtype;
begin
  if p_reason is null or char_length(p_reason) < 5 then perform app_error(422, 'REASON_REQUIRED', 'A reason is required'); end if;
  select * into a from collector_accounts where id = p_account_id for update;
  if not found then perform app_error(404, 'COLLECTOR_NOT_FOUND', 'Collector account not found'); end if;
  if a.status = p_status then return jsonb_build_object('unchanged', true); end if;
  if a.status = 'revoked' then perform app_error(409, 'COLLECTOR_REVOKED', 'A revoked collector cannot be reinstated'); end if;
  if p_status = 'revoked' then
    v_req := _consume_approval(p_request_id, 'collector_revoke', p_account_id, p_actor);
  end if;
  if p_status = 'active' and a.status in ('pending_review','verified') then
    update collector_accounts set approved_by = p_actor, approved_at = now() where id = a.id;
  end if;
  update collector_accounts
     set status = p_status, status_reason = p_reason, status_changed_at = now(),
         rejection_reason = case when p_status = 'rejected' then p_reason else rejection_reason end
   where id = a.id;
  insert into collector_status_history (collector_account_id, from_status, to_status, actor_id, reason, approval_request_id)
  values (a.id, a.status, p_status, p_actor, p_reason, v_req.id);
  insert into account_change_history (user_id, event_type, previous_ref, new_ref, actor_id, reason)
  values (a.collector_id, 'collector_status_changed', a.status, p_status, p_actor, p_reason);
  perform enqueue_notification(a.collector_id, 'collector_status_changed', 'account', 'Collector status updated',
    format('Your collector account "%s" is now %s. Reason: %s', a.business_name, replace(p_status, '_', ' '), p_reason),
    jsonb_build_object('collector_account_id', a.id), 'collector_status:' || a.id || ':' || p_status || ':' || extract(epoch from now())::bigint);
  perform audit_event(p_actor, 'collector.status.' || p_status, 'collector_account', a.id::text, 'success',
    jsonb_build_object('from', a.status, 'reason', p_reason));
  return jsonb_build_object('from', a.status, 'to', p_status);
end $$;

-- ---------------------------------------------------------------------
-- 12. Dispute cases & evidence (extends support_tickets)
-- ---------------------------------------------------------------------
alter table public.support_tickets drop constraint if exists support_tickets_category_check;
alter table public.support_tickets add constraint support_tickets_category_check check (category in (
  'incorrect_payment','missing_contribution','incorrect_balance','payout_issue','collector_issue','bill_payment_issue',
  'unauthorized_activity','missing_payout','incorrect_contribution','fake_payment','failed_withdrawal',
  'collector_settlement','account_takeover','suspected_fraud','other'));
create sequence public.case_number_seq;
alter table public.support_tickets
  add column case_number        text unique,
  add column respondent_user_id uuid references public.profiles(id),
  add column collector_id       uuid references public.profiles(id),
  add column amount             bigint check (amount is null or amount > 0),
  add column resolution         text,
  add column resolution_outcome text check (resolution_outcome in (
               'in_favour_of_complainant','in_favour_of_respondent','no_fault_found','referred_externally','withdrawn'));

create or replace function public.assign_case_number() returns trigger
language plpgsql as $$
begin
  if new.case_number is null then
    new.case_number := 'CASE-' || to_char(now() at time zone 'Africa/Lagos', 'YYYY') || '-' ||
                       lpad(nextval('public.case_number_seq')::text, 6, '0');
  end if;
  return new;
end $$;
create trigger support_tickets_case_number before insert on public.support_tickets
  for each row execute function public.assign_case_number();
update public.support_tickets set case_number = 'CASE-' || to_char(created_at at time zone 'Africa/Lagos', 'YYYY') || '-' ||
       lpad(nextval('public.case_number_seq')::text, 6, '0') where case_number is null;

create table public.case_transactions (
  case_id        uuid not null references public.support_tickets(id),
  transaction_id uuid not null references public.transactions(id),
  linked_by      uuid not null references public.profiles(id),
  note           text,
  linked_at      timestamptz not null default now(),
  primary key (case_id, transaction_id)
);
create trigger case_transactions_append_only before update or delete on public.case_transactions
  for each row execute function public.forbid_mutation();

create table public.case_events (
  id         bigint generated always as identity primary key,
  case_id    uuid not null references public.support_tickets(id),
  actor_id   uuid references public.profiles(id),
  event_type text not null check (event_type in (
               'created','status_changed','priority_changed','assigned','evidence_added','transaction_linked','note','resolved','reopened')),
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index case_events_case_idx on public.case_events (case_id, created_at);
create trigger case_events_append_only before update or delete on public.case_events
  for each row execute function public.forbid_mutation();

create table public.dispute_evidence (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references public.support_tickets(id),
  evidence_type      text not null check (evidence_type in (
                       'transaction_record','payment_receipt','platform_record','message','document','screenshot',
                       'provider_response','security_event','audit_log')),
  source             text not null check (source in ('complainant','respondent','investigator','system')),
  description        text check (char_length(description) <= 1000),
  storage_path       text unique,
  mime_type          text,
  size_bytes         int,
  sha256             text check (sha256 ~ '^[0-9a-f]{64}$'),
  linked_record_type text,
  linked_record_id   text,
  supersedes_id      uuid references public.dispute_evidence(id),
  uploaded_by        uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  check (storage_path is not null or linked_record_id is not null)
);
create index dispute_evidence_case_idx on public.dispute_evidence (case_id, created_at);
create trigger dispute_evidence_append_only before update or delete on public.dispute_evidence
  for each row execute function public.forbid_mutation();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dispute-evidence', 'dispute-evidence', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 13. Sensitive data access log (who looked at what, and why)
-- ---------------------------------------------------------------------
create table public.data_access_logs (
  id              bigint generated always as identity primary key,
  actor_id        uuid not null references public.profiles(id),
  subject_user_id uuid references public.profiles(id),
  resource_type   text not null,
  resource_id     text,
  fields          text[] not null default '{}',
  reason          text not null check (char_length(reason) >= 5),
  session_id      uuid references public.user_sessions(id),
  ip_address      inet,
  created_at      timestamptz not null default now()
);
create index data_access_logs_actor_idx on public.data_access_logs (actor_id, created_at desc);
create index data_access_logs_subject_idx on public.data_access_logs (subject_user_id, created_at desc);
create trigger data_access_logs_append_only before update or delete on public.data_access_logs
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------
-- 14. Osusu group identity & member contribution profile
-- ---------------------------------------------------------------------
alter table public.osusu_groups
  add column rules    text check (char_length(rules) <= 4000),
  add column end_date date;

create or replace function public.osusu_group_end_date() returns trigger
language plpgsql as $$
begin
  update osusu_groups set end_date = greatest(coalesce(end_date, new.due_date), new.due_date) where id = new.group_id;
  return new;
end $$;
create trigger osusu_cycles_end_date after insert on public.osusu_cycles
  for each row execute function public.osusu_group_end_date();

create view public.osusu_member_stats with (security_invoker = true) as
select m.id as member_id, m.group_id, m.user_id, m.status, m.payout_position, m.has_received_payout,
       m.joined_at, m.removed_at as exit_at,
       count(c.*) filter (where c.status = 'paid')                        as contributions_paid,
       count(c.*) filter (where c.status = 'paid' and c.is_late)          as contributions_late,
       count(c.*) filter (where c.status = 'overdue')                     as contributions_missed,
       coalesce(sum(c.amount) filter (where c.status = 'paid'), 0)        as total_contributed,
       coalesce(sum(c.amount) filter (where c.status in ('pending','overdue')), 0) as outstanding,
       min(c.due_date) filter (where c.status in ('pending','overdue'))   as next_due_date,
       coalesce((select sum(p.amount) from osusu_payouts p where p.recipient_member_id = m.id and p.status = 'paid'), 0) as total_received
  from osusu_members m
  left join osusu_contributions c on c.member_id = m.id
 group by m.id;

-- ---------------------------------------------------------------------
-- 15. Collector trust statistics & explainable risk factors
-- ---------------------------------------------------------------------
create view public.collector_trust_stats with (security_invoker = true) as
select a.id as collector_account_id, a.collector_id, a.status, a.created_at as application_date, a.approved_at,
       (select count(distinct s.saver_id) from collector_savers s where s.collector_account_id = a.id
          and s.status in ('active','matured','return_requested','return_processing')) as members_managed,
       (select count(*) from collector_savers s where s.collector_account_id = a.id) as plans_total,
       (select coalesce(sum(t.amount), 0) from transactions t join collector_savers s on s.id = t.collector_saver_id
         where s.collector_account_id = a.id and t.type = 'collector_savings' and t.status = 'success') as total_processed,
       (select coalesce(sum(r.gross_amount), 0) from collector_returns r join collector_savers s on s.id = r.collector_saver_id
         where s.collector_account_id = a.id and r.status = 'paid') as total_settled,
       (select coalesce(sum(s.balance), 0) from collector_savers s where s.collector_account_id = a.id
          and s.status in ('active','matured','return_requested','return_processing')) as outstanding_settlements,
       (select count(*) from collector_savers s where s.collector_account_id = a.id and s.status = 'matured'
          and s.matured_at < now() - interval '7 days') as overdue_settlements,
       (select count(*) from support_tickets t where t.collector_id = a.collector_id
          or t.related_collector_saver_id in (select id from collector_savers where collector_account_id = a.id)) as complaints,
       (select count(*) from support_tickets t where (t.collector_id = a.collector_id
          or t.related_collector_saver_id in (select id from collector_savers where collector_account_id = a.id))
          and t.status in ('open','in_progress','awaiting_user')) as open_disputes,
       (select count(*) from collector_status_history h where h.collector_account_id = a.id and h.to_status in ('suspended','restricted')) as suspensions
  from collector_accounts a;

create view public.risk_profile_factors with (security_invoker = true) as
select p.id as user_id,
       (lagos_today() - (p.created_at at time zone 'Africa/Lagos')::date) as account_age_days,
       coalesce(k.level, 0) as verification_level,
       coalesce(k.status, 'not_started') as kyc_status,
       (select count(*) from security_events e where e.user_id = p.id and e.created_at > now() - interval '90 days') as security_events_90d,
       (select count(*) from security_events e where e.user_id = p.id and e.severity in ('high','critical')
          and e.status not in ('resolved','dismissed')) as open_high_security_events,
       (select count(*) from support_tickets t where t.respondent_user_id = p.id or t.collector_id = p.id) as disputes_as_respondent,
       (select count(*) from support_tickets t where t.user_id = p.id) as disputes_filed,
       (select count(*) from verification_records v where v.user_id = p.id and v.status = 'failed') as failed_verifications,
       (select count(*) from payment_attempts a where a.user_id = p.id and a.status = 'failed'
          and a.created_at > now() - interval '30 days') as failed_payments_30d,
       (select count(*) from risk_flags f where f.subject_user_id = p.id and f.status in ('review_required','risk_review')) as open_risk_flags,
       (select count(*) from osusu_contributions c where c.user_id = p.id and c.status = 'overdue') as overdue_contributions,
       (select max(created_at) from payment_account_changes x where x.user_id = p.id) as last_payment_account_change,
       coalesce(r.risk_status, 'normal') as risk_status, r.restriction_reason, r.last_reviewed_at, r.reviewed_by, r.review_notes
  from profiles p
  left join kyc_profiles k on k.user_id = p.id
  left join risk_profiles r on r.user_id = p.id;

-- Safe, public trust information only (no contact, address, IDs, finances or security data).
create view public.user_trust_profile with (security_invoker = true) as
select p.id as user_id,
       coalesce(p.preferred_name, p.first_name, split_part(p.full_name, ' ', 1)) ||
         coalesce(' ' || left(coalesce(p.last_name, nullif(split_part(p.full_name, ' ', 2), '')), 1) || '.', '') as display_name,
       p.avatar_path,
       case when p.show_public_location then concat_ws(', ', p.city, s.name) end as public_location,
       case when p.show_public_location then p.country end as country,
       (p.created_at at time zone 'Africa/Lagos')::date as member_since,
       p.email_verified_at is not null as email_verified,
       p.phone_verified_at is not null as phone_verified,
       coalesce(k.level, 0) >= 2 as identity_verified,
       exists (select 1 from payout_accounts pa where pa.user_id = p.id and pa.status = 'verified') as payment_account_verified,
       (select count(*) from osusu_members m join osusu_groups g on g.id = m.group_id
         where m.user_id = p.id and m.status = 'active' and g.status = 'completed') as completed_groups,
       (select count(*) from osusu_contributions c where c.user_id = p.id and c.status = 'paid') as contributions_paid,
       (select count(*) from osusu_contributions c where c.user_id = p.id and c.status = 'paid' and not c.is_late) as contributions_on_time,
       p.account_status = 'active' and p.deactivated_at is null as active
  from profiles p
  left join kyc_profiles k on k.user_id = p.id
  left join ng_states s on s.code = p.state_code;

-- ---------------------------------------------------------------------
-- 16. Compliance/security dashboard aggregate
-- ---------------------------------------------------------------------
create or replace function public.compliance_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'kyc_pending', (select count(*) from kyc_profiles where status in ('pending','in_review')),
    'kyc_failed', (select count(*) from kyc_profiles where status = 'failed'),
    'kyc_expired', (select count(*) from kyc_profiles where status = 'expired'),
    'security_events_open', (select count(*) from security_events where status not in ('resolved','dismissed')),
    'security_events_high', (select count(*) from security_events where status not in ('resolved','dismissed') and severity in ('high','critical')),
    'account_takeover_alerts', (select count(*) from security_events where event_type = 'account_takeover_indicator' and status not in ('resolved','dismissed')),
    'risk_reviews', (select count(*) from risk_profiles where risk_status <> 'normal'),
    'risk_flags_open', (select count(*) from risk_flags where status in ('review_required','risk_review')),
    'disputes_open', (select count(*) from support_tickets where status in ('open','in_progress','awaiting_user')),
    'collector_applications', (select count(*) from collector_accounts where status in ('pending_review','verified')),
    'payment_account_changes_7d', (select count(*) from payment_account_changes where created_at > now() - interval '7 days'),
    'held_disbursements', (select count(*) from osusu_payouts where hold_reason is not null and status in ('approved','processing'))
                        + (select count(*) from collector_returns where hold_reason is not null and status in ('approved','processing'))
                        + (select count(*) from collector_commissions where hold_reason is not null and status in ('accrued','processing')),
    'approvals_pending', (select count(*) from sensitive_action_requests where status = 'pending' and expires_at > now()),
    'data_access_24h', (select count(*) from data_access_logs where created_at > now() - interval '24 hours')
  )
$$;

-- Job: expire identity documents and flag late collector settlements (neutral wording).
create or replace function public.run_compliance_checks() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_expired int := 0; v_delays int := 0;
begin
  for r in select distinct user_id from verification_records
            where status = 'verified' and expiry_date is not null and expiry_date < lagos_today() loop
    perform recompute_kyc(r.user_id);
    v_expired := v_expired + 1;
  end loop;
  for r in select s.id, s.collector_id, s.balance from collector_savers s
            where s.status = 'matured' and s.matured_at < now() - interval '7 days' and s.balance > 0 loop
    insert into risk_flags (subject_user_id, context, reason_code, severity, status, collector_saver_id, details)
    select r.collector_id, 'collector', 'collector_settlement_delay', 'medium', 'review_required', r.id,
           jsonb_build_object('balance', r.balance)
     where not exists (select 1 from risk_flags f where f.collector_saver_id = r.id
                         and f.reason_code = 'collector_settlement_delay' and f.status in ('review_required','risk_review'));
    if found then v_delays := v_delays + 1; end if;
  end loop;
  update sensitive_action_requests set status = 'expired' where status in ('pending','approved') and expires_at < now();
  return jsonb_build_object('kyc_rechecked', v_expired, 'settlement_delays_flagged', v_delays);
end $$;

-- Backfill KYC profiles for existing users.
do $$ declare r record; begin
  for r in select id from public.profiles loop perform public.recompute_kyc(r.id); end loop;
end $$;

-- ---------------------------------------------------------------------
-- 17. Row Level Security for the new entities (defence in depth)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['permissions','role_permissions','kyc_profiles','kyc_events','user_devices','user_sessions',
    'account_change_history','security_events','risk_profiles','payment_account_changes','collector_status_history',
    'sensitive_action_requests','case_transactions','case_events','dispute_evidence','data_access_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;
grant select on public.osusu_member_stats, public.collector_trust_stats, public.risk_profile_factors, public.user_trust_profile to service_role;

create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy kyc_profiles_read on public.kyc_profiles for select to authenticated
  using (user_id = auth.uid() or public.has_permission('kyc.review'));
create policy kyc_events_read on public.kyc_events for select to authenticated using (public.has_permission('kyc.review'));
-- Device/session rows contain IP and device hashes: staff only (users get a safe view via the API).
create policy user_devices_read on public.user_devices for select to authenticated using (public.has_permission('security.events.read'));
create policy user_sessions_read on public.user_sessions for select to authenticated using (public.has_permission('security.events.read'));
create policy account_change_history_read on public.account_change_history for select to authenticated
  using (public.has_permission('security.events.read') or public.has_permission('audit.read'));
create policy security_events_read on public.security_events for select to authenticated using (public.has_permission('security.events.read'));
create policy risk_profiles_read on public.risk_profiles for select to authenticated using (public.has_permission('risk.review'));
create policy payment_account_changes_read on public.payment_account_changes for select to authenticated
  using (public.has_permission('security.events.read') or public.has_permission('finance.ledger.read'));
create policy collector_status_history_read on public.collector_status_history for select to authenticated
  using (public.has_permission('collectors.review') or public.has_permission('audit.read'));
create policy sensitive_action_requests_read on public.sensitive_action_requests for select to authenticated
  using (public.has_permission('finance.reversal.request') or public.has_permission('finance.reversal.approve') or public.has_permission('collectors.status'));
create policy case_transactions_read on public.case_transactions for select to authenticated using (public.has_permission('disputes.manage'));
create policy case_events_read on public.case_events for select to authenticated using (public.has_permission('disputes.manage'));
create policy dispute_evidence_read on public.dispute_evidence for select to authenticated using (public.has_permission('disputes.evidence.view'));
create policy data_access_logs_read on public.data_access_logs for select to authenticated using (public.has_permission('data_access.read'));

-- Replace legacy role checks with permissions on existing sensitive tables.
drop policy if exists transactions_own_read on public.transactions;
create policy transactions_own_read on public.transactions for select to authenticated
  using (user_id = auth.uid() or public.has_permission('finance.ledger.read'));
drop policy if exists payment_attempts_own_read on public.payment_attempts;
create policy payment_attempts_own_read on public.payment_attempts for select to authenticated
  using (user_id = auth.uid() or public.has_permission('finance.ledger.read'));
drop policy if exists verification_own_read on public.verification_records;
create policy verification_own_read on public.verification_records for select to authenticated
  using (user_id = auth.uid() or public.has_permission('kyc.review'));
drop policy if exists audit_logs_staff_read on public.audit_logs;
create policy audit_logs_staff_read on public.audit_logs for select to authenticated using (public.has_permission('audit.read'));
drop policy if exists risk_flags_staff_read on public.risk_flags;
create policy risk_flags_staff_read on public.risk_flags for select to authenticated
  using (public.has_permission('risk.review') or public.has_permission('security.events.read'));
-- Private profile data: own row, or staff allowed to read sensitive profiles.
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_permission('users.read_sensitive'));

-- Browser roles may never write the new financial/security tables, and may not
-- change their own verification-bearing profile columns.
revoke update on public.profiles from authenticated;
grant update (full_name, preferred_name, occupation, show_public_location) on public.profiles to authenticated;

-- New functions are server-only (re-assert; default privileges can differ per project).
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
grant execute on function
  public.has_role(text), public.has_permission(text), public.is_platform_staff(), public.is_group_member(uuid),
  public.is_group_admin(uuid), public.is_conversation_member(uuid), public.is_plan_party(uuid),
  public.shares_context_with(uuid), public.lagos_today()
to authenticated;

insert into public.app_settings (key, value, description) values
  ('kyc.required_levels', '{"contribute":1,"receive_payout":2,"withdraw":2,"operator":2}',
   'Minimum KYC level (0-3) required per activity'),
  ('security.payment_account_cooldown_hours', '24', 'Hours a newly changed payout account is held before automated payouts'),
  ('risk.withdrawal_review_threshold_kobo', '50000000', 'Disbursements at or above this amount (kobo) are held for manual review'),
  ('security.step_up_minutes', '10', 'Minutes a step-up verification remains valid for sensitive staff actions'),
  ('finance.large_payout_threshold_kobo', '100000000', 'Manual payout confirmations at or above this amount need a second approver')
on conflict (key) do nothing;
