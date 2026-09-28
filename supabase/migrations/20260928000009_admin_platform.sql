-- =====================================================================
-- ACHIEVER — separate Site Administration platform.
--   * Admin access is its own identity layer: an admin_accounts row, a
--     confirmed authenticator-app (TOTP) factor and an admin_sessions row.
--     A normal sign-in (Supabase JWT) never carries staff powers.
--   * Typed platform settings with append-only change history.
--   * SMS verification switch, provider health, phone-verification fallback.
--   * Explicit account states with an append-only status history.
-- Backward compatible with the API version deployed before it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Roles & permissions
-- ---------------------------------------------------------------------
alter table public.roles drop constraint if exists roles_code_check;
alter table public.roles add constraint roles_code_check check (code in (
  'SUPER_ADMIN','ADMIN','COMPLIANCE_ADMIN','FINANCE_ADMIN','DISPUTE_ADMIN','SECURITY_ADMIN','SUPPORT_ADMIN',
  'CONTENT_ADMIN','AUDITOR','READ_ONLY_ADMIN','OSUSU_ADMIN','OSUSU_MEMBER','COLLECTOR','SAVER'));

insert into public.roles (code, description) values
  ('CONTENT_ADMIN', 'Platform notices and public content; no financial, KYC or security access')
on conflict (code) do nothing;

insert into public.permissions (code, description) values
  ('admins.read',    'See administrator accounts, their roles and sign-in activity'),
  ('admins.manage',  'Create, change, disable administrators and reset their MFA'),
  ('settings.read',  'See platform settings and their change history'),
  ('sms.read',       'See SMS verification status and provider health'),
  ('sms.configure',  'Turn SMS verification and SMS notifications on or off'),
  ('reports.export', 'Export permitted records (every export is logged)')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code)
select 'SUPER_ADMIN', code from public.permissions
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('SECURITY_ADMIN','admins.read'),('SECURITY_ADMIN','settings.read'),('SECURITY_ADMIN','sms.read'),
  ('AUDITOR','admins.read'),('AUDITOR','settings.read'),('AUDITOR','sms.read'),('AUDITOR','reports.export'),
  ('FINANCE_ADMIN','settings.read'),('FINANCE_ADMIN','reports.export'),
  ('COMPLIANCE_ADMIN','settings.read'),('COMPLIANCE_ADMIN','reports.export'),
  ('SUPPORT_ADMIN','sms.read'),
  ('READ_ONLY_ADMIN','settings.read'),
  ('ADMIN','settings.read'),('ADMIN','sms.read'),('ADMIN','reports.export'),
  ('CONTENT_ADMIN','overview.read'),('CONTENT_ADMIN','notifications.broadcast'),('CONTENT_ADMIN','settings.read')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Staff powers are never exercised with an ordinary sign-in token.
--    Administration goes only through the API's admin session (password +
--    authenticator app), which uses the service role. Row-level policies
--    that referenced staff status therefore grant nothing to browser JWTs.
-- ---------------------------------------------------------------------
create or replace function public.has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select false
$$;

create or replace function public.is_platform_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select false
$$;

-- ---------------------------------------------------------------------
-- 3. Administrator accounts (separate from roles: holding a staff role is
--    not enough to open the admin platform)
-- ---------------------------------------------------------------------
create table public.admin_accounts (
  user_id             uuid primary key references public.profiles(id) on delete restrict,
  status              text not null default 'active' check (status in ('active','disabled')),
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  disabled_at         timestamptz,
  disabled_by         uuid references public.profiles(id),
  disabled_reason     text check (char_length(disabled_reason) <= 500),
  failed_login_count  int not null default 0 check (failed_login_count >= 0),
  locked_until        timestamptz,
  last_login_at       timestamptz,
  mfa_reset_at        timestamptz,
  updated_at          timestamptz not null default now(),
  check (status = 'active' or (disabled_at is not null and disabled_reason is not null))
);
create trigger admin_accounts_updated_at before update on public.admin_accounts
  for each row execute function public.set_updated_at();

-- Authenticator-app factors. The shared secret is encrypted by the API
-- (AES-256-GCM); the database never sees it in clear text.
create table public.admin_mfa_factors (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.admin_accounts(user_id) on delete restrict,
  kind              text not null default 'totp' check (kind in ('totp')),
  secret_ciphertext text not null,
  label             text check (char_length(label) <= 60),
  confirmed_at      timestamptz,
  last_used_step    bigint,
  created_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  revoked_reason    text
);
create unique index admin_mfa_one_active_idx on public.admin_mfa_factors (user_id)
  where revoked_at is null and confirmed_at is not null;

create table public.admin_backup_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.admin_accounts(user_id) on delete restrict,
  code_hash  text not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz,
  revoked_at timestamptz
);
create index admin_backup_codes_user_idx on public.admin_backup_codes (user_id) where used_at is null and revoked_at is null;

-- Password verified, second factor pending (5 minutes, limited attempts).
create table public.admin_login_challenges (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.admin_accounts(user_id) on delete restrict,
  token_hash            text not null unique,
  purpose               text not null check (purpose in ('mfa','enroll')),
  enroll_secret_ciphertext text,
  attempts              int not null default 0 check (attempts >= 0),
  ip_address            inet,
  user_agent            text,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  consumed_at           timestamptz,
  check (purpose = 'mfa' or enroll_secret_ciphertext is not null)
);
create index admin_login_challenges_user_idx on public.admin_login_challenges (user_id, created_at desc);

create table public.admin_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.admin_accounts(user_id) on delete restrict,
  token_hash      text not null unique,
  device_hash     text,
  device_label    text,
  ip_address      inet,
  user_agent      text,
  mfa_method      text not null check (mfa_method in ('totp','backup_code')),
  created_at      timestamptz not null default now(),
  last_active_at  timestamptz not null default now(),
  expires_at      timestamptz not null,
  idle_minutes    int not null check (idle_minutes between 5 and 120),
  step_up_at      timestamptz,
  ended_at        timestamptz,
  end_reason      text check (end_reason in ('logout','logout_all','revoked','idle_timeout','expired',
                                             'password_changed','mfa_reset','account_disabled','role_removed'))
);
create index admin_sessions_user_idx on public.admin_sessions (user_id, created_at desc);
create index admin_sessions_active_idx on public.admin_sessions (user_id) where ended_at is null;

-- ---------------------------------------------------------------------
-- 4. Audit & data-access logs carry the admin session and request id
-- ---------------------------------------------------------------------
alter table public.audit_logs
  add column request_id       text,
  add column admin_session_id uuid references public.admin_sessions(id),
  add column permission       text,
  add column reason           text check (char_length(reason) <= 1000),
  add column previous_state   jsonb,
  add column new_state        jsonb;
create index audit_logs_admin_session_idx on public.audit_logs (admin_session_id) where admin_session_id is not null;
create index audit_logs_admin_actions_idx on public.audit_logs (created_at desc) where action like 'admin.%';

alter table public.data_access_logs
  add column admin_session_id uuid references public.admin_sessions(id),
  add column request_id       text;

-- ---------------------------------------------------------------------
-- 5. Explicit account states
--    ACTIVE=active, PENDING=pending_verification, VERIFICATION_REQUIRED,
--    RESTRICTED (can sign in, cannot move money), SUSPENDED, DEACTIVATED=closed
-- ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check check (account_status in (
  'pending_verification','active','verification_required','restricted','suspended','closed'));
alter table public.profiles
  add column status_changed_at timestamptz,
  add column status_changed_by uuid references public.profiles(id),
  add column status_expires_at timestamptz;

create table public.account_status_history (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  previous_status text not null,
  new_status      text not null,
  reason          text not null check (char_length(reason) between 5 and 1000),
  actor_id        uuid references public.profiles(id),
  expires_at      timestamptz,
  request_id      text,
  admin_session_id uuid references public.admin_sessions(id),
  created_at      timestamptz not null default now()
);
create index account_status_history_user_idx on public.account_status_history (user_id, created_at desc);
create trigger account_status_history_append_only before update or delete on public.account_status_history
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------
-- 6. Typed platform settings
-- ---------------------------------------------------------------------
alter table public.app_settings
  add column value_type text not null default 'object' check (value_type in ('boolean','integer','string','enum','object')),
  add column category   text not null default 'general' check (category in (
    'authentication','verification','sms','email','payments','notifications','security','maintenance',
    'support','registration','kyc','collector_onboarding','transaction_limits','admin','general')),
  add column label      text,
  add column min_value  numeric,
  add column max_value  numeric,
  add column options    text[],
  add column critical   boolean not null default false;

create or replace function public.check_app_setting_type() returns trigger
language plpgsql as $$
declare t text := jsonb_typeof(new.value);
begin
  if new.value_type = 'boolean' and t <> 'boolean' then
    raise exception 'ACH:400:INVALID_SETTING_VALUE:% must be true or false', new.key;
  elsif new.value_type = 'integer' then
    if t <> 'number' or (new.value)::text::numeric <> trunc((new.value)::text::numeric) then
      raise exception 'ACH:400:INVALID_SETTING_VALUE:% must be a whole number', new.key;
    end if;
    if (new.min_value is not null and (new.value)::text::numeric < new.min_value)
       or (new.max_value is not null and (new.value)::text::numeric > new.max_value) then
      raise exception 'ACH:400:INVALID_SETTING_VALUE:% must be between % and %', new.key, new.min_value, new.max_value;
    end if;
  elsif new.value_type in ('string','enum') then
    if t <> 'string' then raise exception 'ACH:400:INVALID_SETTING_VALUE:% must be text', new.key; end if;
    if new.value_type = 'enum' and not ((new.value #>> '{}') = any(coalesce(new.options, '{}'))) then
      raise exception 'ACH:400:INVALID_SETTING_VALUE:% must be one of %', new.key, new.options;
    end if;
  elsif new.value_type = 'object' and t <> 'object' then
    raise exception 'ACH:400:INVALID_SETTING_VALUE:% must be an object', new.key;
  end if;
  return new;
end $$;

create table public.app_setting_changes (
  id               bigint generated always as identity primary key,
  setting_key      text not null references public.app_settings(key),
  previous_value   jsonb,
  new_value        jsonb not null,
  reason           text not null check (char_length(reason) between 5 and 1000),
  actor_id         uuid not null references public.profiles(id),
  admin_session_id uuid references public.admin_sessions(id),
  request_id       text,
  created_at       timestamptz not null default now()
);
create index app_setting_changes_key_idx on public.app_setting_changes (setting_key, created_at desc);
create trigger app_setting_changes_append_only before update or delete on public.app_setting_changes
  for each row execute function public.forbid_mutation();

-- Metadata for existing settings (values untouched)
update public.app_settings s set value_type = m.value_type, category = m.category, label = m.label,
       min_value = m.min_value, max_value = m.max_value, options = m.options, critical = m.critical
from (values
  ('undertaking.current_version','string','collector_onboarding','Operator undertaking version',null::numeric,null::numeric,null::text[],false),
  ('risk.large_collector_contribution_kobo','integer','transaction_limits','Large collector contribution (kobo)',1,null,null,false),
  ('risk.failed_payments_threshold','integer','security','Failed payments before review',1,100,null,false),
  ('notifications.sms_daily_cap','integer','notifications','Non-security SMS per user per day',0,100,null,false),
  ('payouts.execution_mode','enum','payments','Payout execution',null,null,array['manual','paystack_transfer'],true),
  ('platform.maintenance_mode','boolean','maintenance','Maintenance mode',null,null,null,true),
  ('kyc.required_levels','object','kyc','KYC level per activity',null,null,null,true),
  ('security.payment_account_cooldown_hours','integer','security','Payout account change cooldown (hours)',0,168,null,true),
  ('risk.withdrawal_review_threshold_kobo','integer','transaction_limits','Withdrawal review threshold (kobo)',1,null,null,false),
  ('security.step_up_minutes','integer','security','Member re-confirmation window (minutes)',1,60,null,false),
  ('finance.large_payout_threshold_kobo','integer','payments','Two-person approval above (kobo)',1,null,null,true)
) as m(key, value_type, category, label, min_value, max_value, options, critical)
where s.key = m.key;

insert into public.app_settings (key, value, description, value_type, category, label, min_value, max_value, options, critical) values
  ('sms.verification_enabled', 'false', 'Phone verification codes by SMS (Termii). When off, email verification is used and phone verification is deferred.', 'boolean', 'sms', 'SMS verification', null, null, null, true),
  ('sms.notifications_enabled', 'false', 'Non-security notices by SMS', 'boolean', 'sms', 'SMS notifications', null, null, null, false),
  ('registration.enabled', 'true', 'Allow new accounts to be created', 'boolean', 'registration', 'New registrations', null, null, null, true),
  ('auth.password_min_length', '10', 'Minimum password length (never below 10)', 'integer', 'authentication', 'Minimum password length', 10, 64, null, true),
  ('auth.login_max_attempts', '5', 'Wrong passwords before a temporary lock', 'integer', 'authentication', 'Sign-in attempts before lock', 3, 10, null, true),
  ('auth.lockout_minutes', '15', 'How long a locked account waits', 'integer', 'authentication', 'Lockout duration (minutes)', 5, 1440, null, false),
  ('auth.otp_expiry_minutes', '10', 'Lifetime of emailed/SMS verification codes', 'integer', 'verification', 'Code expiry (minutes)', 5, 30, null, false),
  ('auth.otp_max_attempts', '5', 'Wrong entries before a code is locked', 'integer', 'verification', 'Code attempts', 3, 10, null, true),
  ('auth.otp_resend_cooldown_seconds', '60', 'Wait before another code can be requested', 'integer', 'verification', 'Resend cooldown (seconds)', 30, 600, null, false),
  ('admin.session_idle_minutes', '30', 'Admin sessions end after this much inactivity', 'integer', 'admin', 'Admin idle timeout (minutes)', 5, 60, null, true),
  ('admin.session_max_hours', '12', 'Admin sessions end after this long regardless of activity', 'integer', 'admin', 'Admin session lifetime (hours)', 1, 24, null, true),
  ('admin.step_up_minutes', '5', 'Sensitive admin actions need an authenticator code within this window', 'integer', 'admin', 'Admin re-confirmation window (minutes)', 1, 30, null, true)
on conflict (key) do nothing;

create trigger app_settings_typed before insert or update on public.app_settings
  for each row execute function public.check_app_setting_type();

-- ---------------------------------------------------------------------
-- 7. External provider health (SMS today; email later)
-- ---------------------------------------------------------------------
create table public.provider_health (
  provider             text primary key check (provider in ('termii','resend')),
  status               text not null default 'not_configured' check (status in ('operational','degraded','unavailable','not_configured')),
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  last_error_code      text check (char_length(last_error_code) <= 120),
  consecutive_failures int not null default 0,
  total_successes      bigint not null default 0,
  total_failures       bigint not null default 0,
  last_latency_ms      int,
  circuit_open_until   timestamptz,
  updated_at           timestamptz not null default now()
);
insert into public.provider_health (provider) values ('termii'), ('resend') on conflict do nothing;

-- ---------------------------------------------------------------------
-- 8. Phone verification fallback: when SMS verification is off (or the
--    provider is unavailable) the verified email stands in, and the phone
--    is verified later. The waiver is recorded, never silent.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column phone_verification_waived_at timestamptz,
  add column phone_verification_waiver    text check (phone_verification_waiver in ('sms_disabled','sms_unavailable'));

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
  v_phone  boolean;
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
  -- Phone: verified by SMS, or (while SMS verification is unavailable) covered by the verified email.
  v_phone := p.phone_verified_at is not null or p.phone_verification_waived_at is not null;

  if p.email_verified_at is not null then v_level := 0; end if;
  if p.email_verified_at is not null and v_phone and v_basic then v_level := 1; end if;
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
-- 9. Dashboard aggregates in one round trip (counts, no row transfer)
-- ---------------------------------------------------------------------
create or replace function public.admin_dashboard_metrics() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'users', (select count(*) from profiles),
    'active_users_30d', (select count(*) from profiles where last_seen_at > now() - interval '30 days'),
    'pending_verification', (select count(*) from profiles where account_status in ('pending_verification','verification_required')),
    'restricted_users', (select count(*) from profiles where account_status in ('restricted','suspended')),
    'kyc_verified', (select count(*) from kyc_profiles where level >= 2),
    'kyc_review_queue', (select count(*) from verification_records where status in ('pending','manual_review')),
    'osusu_groups_active', (select count(*) from osusu_groups where status in ('recruiting','active')),
    'collectors_active', (select count(*) from collector_accounts where status = 'active'),
    'payments_pending', (select count(*) from payment_attempts where status = 'initialized' and created_at > now() - interval '48 hours'),
    'payments_failed_24h', (select count(*) from payment_attempts where status in ('failed','amount_mismatch') and created_at > now() - interval '24 hours'),
    'payouts_queued', (select count(*) from osusu_payouts where status in ('scheduled','approved','processing')),
    'transactions_24h', (select count(*) from transactions where created_at > now() - interval '24 hours'),
    'volume_30d_kobo', (select coalesce(sum(amount), 0) from transactions where status = 'success' and created_at > now() - interval '30 days'),
    'tickets_open', (select count(*) from support_tickets where status in ('open','in_progress','awaiting_user')),
    'cases_open', (select count(*) from support_tickets where category <> 'other' and status in ('open','in_progress','awaiting_user')),
    'security_events_open', (select count(*) from security_events where status in ('flagged','review_required','suspicious_activity','account_security_review')),
    'risk_flags_open', (select count(*) from risk_flags where status in ('review_required','risk_review')),
    'approvals_pending', (select count(*) from sensitive_action_requests where status in ('pending','approved')),
    'deletion_requests_open', (select count(*) from data_deletion_requests where status in ('pending','in_review'))
  )
$$;

-- ---------------------------------------------------------------------
-- 10. RLS & grants: admin tables are reachable only through the API
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['admin_accounts','admin_mfa_factors','admin_backup_codes','admin_login_challenges',
                           'admin_sessions','account_status_history','app_setting_changes','provider_health'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;
-- Users may read their own status history (why an account was restricted).
grant select on public.account_status_history to authenticated;
create policy account_status_history_own_read on public.account_status_history for select to authenticated
  using (user_id = auth.uid());

revoke execute on function public.admin_dashboard_metrics() from public, anon, authenticated;
grant execute on function public.admin_dashboard_metrics() to service_role;
