-- =====================================================================
-- ACHIEVER — settings, verification challenges, data deletion requests,
-- social sign-in and notification categories.
-- Extends existing tables; append-only rules from 007 still apply.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Social sign-in sessions
-- ---------------------------------------------------------------------
alter table public.user_sessions drop constraint if exists user_sessions_auth_method_check;
alter table public.user_sessions add constraint user_sessions_auth_method_check
  check (auth_method in ('password','registration','password_reset','oauth_google','oauth_facebook'));

alter table public.account_change_history drop constraint if exists account_change_history_event_type_check;
alter table public.account_change_history add constraint account_change_history_event_type_check check (event_type in (
  'password_changed','password_reset','phone_changed','email_changed','name_changed','dob_changed',
  'address_changed','identity_changed','payment_account_added','payment_account_changed',
  'collector_status_changed','group_role_changed','mfa_changed','recovery_changed',
  'device_added','device_removed','risk_status_changed','account_deactivated','kyc_restriction_changed',
  'login_method_linked','login_method_unlinked','deletion_requested','deletion_cancelled','personal_data_erased'));

-- ---------------------------------------------------------------------
-- 2. Per-user preferences (accessibility, messages, privacy, security)
-- ---------------------------------------------------------------------
create table public.user_preferences (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  accessibility jsonb not null default '{}'::jsonb,
  messages      jsonb not null default '{}'::jsonb,
  privacy       jsonb not null default '{}'::jsonb,
  security      jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);
create trigger user_preferences_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. Verification challenges for sensitive account changes
--    (password / email / phone / payout account / account deletion).
--    Only an HMAC of the code is stored; single use; limited attempts;
--    bound to user, action and session.
-- ---------------------------------------------------------------------
create table public.security_challenges (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  action             text not null check (action in ('password_change','email_change','phone_change','payout_account_change','account_deletion')),
  channel            text not null check (channel in ('email','sms')),
  destination_masked text not null,
  code_hash          text not null,
  attempts           int not null default 0,
  max_attempts       int not null default 5 check (max_attempts between 1 and 10),
  session_id         uuid references public.user_sessions(id),
  ip_address         inet,
  expires_at         timestamptz not null,
  verified_at        timestamptz,
  consumed_at        timestamptz,
  created_at         timestamptz not null default now(),
  check (consumed_at is null or verified_at is not null)
);
create index security_challenges_user_idx on public.security_challenges (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- 4. Account / personal-data deletion requests
-- ---------------------------------------------------------------------
create table public.data_deletion_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id),
  request_type    text not null check (request_type in ('account','personal_data')),
  status          text not null default 'pending'
                  check (status in ('pending','in_review','completed','rejected','cancelled')),
  reason          text check (char_length(reason) <= 1000),
  -- Cooling-off period: the user can cancel until this time.
  cancellable_until timestamptz not null default now() + interval '7 days',
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  decision_note   text check (char_length(decision_note) <= 2000),
  retained_summary text,
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (decided_by is null or decided_by <> user_id)
);
create unique index data_deletion_one_open on public.data_deletion_requests (user_id, request_type)
  where status in ('pending','in_review');
create index data_deletion_status_idx on public.data_deletion_requests (status, created_at);
create trigger data_deletion_requests_updated_at before update on public.data_deletion_requests
  for each row execute function public.set_updated_at();
-- Deletion requests are part of the compliance record: never deleted.
create trigger data_deletion_requests_no_delete before delete on public.data_deletion_requests
  for each row execute function public.forbid_mutation();

insert into public.permissions (code, description) values
  ('privacy.requests.manage', 'Review and complete account / personal-data deletion requests')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code) values
  ('SUPER_ADMIN','privacy.requests.manage'), ('COMPLIANCE_ADMIN','privacy.requests.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5. Notification categories: groups, support, marketing
--    (security remains mandatory and is not a preference)
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_category_check;
alter table public.notifications add constraint notifications_category_check check (category in (
  'security','payments','reminders','payouts','meetings','messages','account','system','groups','support','marketing'));

create or replace function public.default_notification_categories() returns jsonb
language sql immutable as $$
  select '{
    "payments":  {"email": true,  "sms": true},
    "reminders": {"email": true,  "sms": true},
    "payouts":   {"email": true,  "sms": true},
    "meetings":  {"email": true,  "sms": false},
    "groups":    {"email": true,  "sms": false},
    "messages":  {"email": false, "sms": false},
    "account":   {"email": true,  "sms": false},
    "support":   {"email": true,  "sms": false},
    "system":    {"email": false, "sms": false},
    "marketing": {"email": false, "sms": false}
  }'::jsonb
$$;

-- ---------------------------------------------------------------------
-- 6. Privacy: remove optional personal data while keeping the records
--    that must be retained (identity/KYC, ledger, disputes, audit).
-- ---------------------------------------------------------------------
create or replace function public.erase_optional_personal_data(p_user_id uuid, p_actor uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles%rowtype;
begin
  select * into p from profiles where id = p_user_id for update;
  if not found then perform app_error(404, 'USER_NOT_FOUND', 'User not found'); end if;
  update profiles set
    preferred_name = null, occupation = null, employment_status = null, business_name = null,
    avatar_path = null, show_public_location = false
  where id = p_user_id;
  delete from user_preferences where user_id = p_user_id;
  delete from user_devices where user_id = p_user_id and not exists (
    select 1 from user_sessions s where s.device_id = user_devices.id);
  insert into account_change_history (user_id, event_type, actor_id, reason)
  values (p_user_id, 'personal_data_erased', p_actor, 'Deletion request ' || p_request_id);
  perform audit_event(p_actor, 'privacy.personal_data_erased', 'profile', p_user_id::text, 'success',
    jsonb_build_object('request_id', p_request_id));
  return jsonb_build_object('erased', array['preferred_name','occupation','employment_status','business_name','avatar','public_location','preferences'],
                            'avatar_path', p.avatar_path);
end $$;

-- ---------------------------------------------------------------------
-- 7. RLS & grants (browser roles read their own rows only)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['user_preferences','security_challenges','data_deletion_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;
grant select on public.user_preferences, public.data_deletion_requests to authenticated;
-- Challenge rows hold code hashes: not readable by browser roles at all.
revoke all on public.security_challenges from authenticated;

create policy user_preferences_own_read on public.user_preferences for select to authenticated using (user_id = auth.uid());
create policy data_deletion_requests_read on public.data_deletion_requests for select to authenticated
  using (user_id = auth.uid() or public.has_permission('privacy.requests.manage'));

revoke execute on function public.erase_optional_personal_data(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.erase_optional_personal_data(uuid, uuid, uuid) to service_role;
