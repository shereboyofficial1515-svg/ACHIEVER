-- =====================================================================
-- ACHIEVER — server-side business functions
--
-- Every function that moves money or changes financial state runs inside a
-- single Postgres transaction (a plpgsql function call is atomic), takes row
-- locks on the records it changes, and is idempotent where it can be retried
-- (webhooks, reconciliation). EXECUTE is granted to service_role only
-- (see 20260923000003_rls.sql); the browser can never call these.
--
-- Errors are raised as 'ACH:<http status>:<CODE>:<message>' and translated
-- into API errors by backend/src/integrations/supabase/rpc.js.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------
create or replace function public.app_error(p_status int, p_code text, p_message text) returns void
language plpgsql as $$
begin
  raise exception using message = 'ACH:' || p_status || ':' || p_code || ':' || p_message, errcode = 'P0001';
end $$;

create or replace function public.new_reference(p_prefix text) returns text
language sql volatile as $$
  select p_prefix || '-' || to_char(now() at time zone 'Africa/Lagos', 'YYMMDD') || '-' ||
         upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
$$;

create or replace function public.fmt_naira(p_kobo bigint) returns text
language sql immutable as $$
  select '₦' || to_char(p_kobo / 100.0, 'FM999,999,999,990.00')
$$;

create or replace function public.setting_bigint(p_key text, p_default bigint) returns bigint
language sql stable as $$
  select coalesce((select (value #>> '{}')::bigint from public.app_settings where key = p_key), p_default)
$$;

create or replace function public.audit_event(
  p_actor uuid, p_action text, p_resource_type text, p_resource_id text,
  p_result text default 'success', p_metadata jsonb default '{}'::jsonb,
  p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (actor_id, action, resource_type, resource_id, result, metadata, ip_address, user_agent)
  values (p_actor, p_action, p_resource_type, p_resource_id, p_result, coalesce(p_metadata, '{}'::jsonb), p_ip, p_user_agent);
end $$;

create or replace function public.default_notification_categories() returns jsonb
language sql immutable as $$
  select '{
    "payments":  {"email": true,  "sms": true},
    "reminders": {"email": true,  "sms": true},
    "payouts":   {"email": true,  "sms": true},
    "meetings":  {"email": true,  "sms": false},
    "messages":  {"email": false, "sms": false},
    "account":   {"email": true,  "sms": false},
    "system":    {"email": false, "sms": false}
  }'::jsonb
$$;

-- Transactional outbox: the row is written in the same transaction as the
-- business change; the backend dispatcher delivers pending email/SMS.
create or replace function public.enqueue_notification(
  p_user_id uuid, p_type text, p_category text, p_title text, p_body text,
  p_data jsonb default '{}'::jsonb, p_dedupe_key text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_prefs   notification_preferences%rowtype;
  v_cat     jsonb;
  v_email   text := 'skipped';
  v_sms     text := 'skipped';
  v_id      uuid;
begin
  select * into v_profile from profiles where id = p_user_id;
  if not found then return null; end if;
  select * into v_prefs from notification_preferences where user_id = p_user_id;

  if p_category = 'security' then
    v_email := 'pending';
    if v_profile.phone_verified_at is not null then v_sms := 'pending'; end if;
  else
    v_cat := coalesce(v_prefs.category_settings -> p_category, default_notification_categories() -> p_category, '{}'::jsonb);
    if coalesce(v_prefs.email_enabled, true) and coalesce((v_cat ->> 'email')::boolean, false)
       and v_profile.email_verified_at is not null then
      v_email := 'pending';
    end if;
    if coalesce(v_prefs.sms_enabled, true) and coalesce((v_cat ->> 'sms')::boolean, false)
       and v_profile.phone_verified_at is not null then
      v_sms := 'pending';
    end if;
  end if;

  insert into notifications (user_id, type, category, title, body, data, dedupe_key, email_status, sms_status)
  values (p_user_id, p_type, p_category, p_title, p_body, coalesce(p_data, '{}'::jsonb), p_dedupe_key, v_email, v_sms)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------
create or replace function public.create_profile_with_roles(
  p_user_id uuid, p_full_name text, p_email text, p_phone text, p_account_type text,
  p_roles text[], p_address text default null, p_dob date default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from unnest(p_roles) r where r not in ('OSUSU_ADMIN','OSUSU_MEMBER','COLLECTOR','SAVER')) then
    perform app_error(422, 'INVALID_ROLE', 'Requested role cannot be self-assigned');
  end if;
  insert into profiles (id, full_name, email, phone, address, date_of_birth, primary_account_type)
  values (p_user_id, p_full_name, p_email, p_phone, p_address, p_dob, p_account_type);
  insert into user_roles (user_id, role_code) select p_user_id, r from unnest(p_roles) r on conflict do nothing;
  insert into notification_preferences (user_id) values (p_user_id);
  perform audit_event(p_user_id, 'auth.register', 'profile', p_user_id::text, 'success',
    jsonb_build_object('account_type', p_account_type, 'roles', p_roles));
end $$;

create or replace function public.register_login_failure(p_user_id uuid, p_max int, p_lock_minutes int)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_locked timestamptz;
begin
  update profiles
     set failed_login_count = case when failed_login_count + 1 >= p_max then 0 else failed_login_count + 1 end,
         locked_until = case when failed_login_count + 1 >= p_max
                             then now() + make_interval(mins => p_lock_minutes) else locked_until end
   where id = p_user_id
  returning locked_until into v_locked;
  return v_locked;
end $$;

create or replace function public.register_login_success(p_user_id uuid) returns void
language sql security definer set search_path = public as $$
  update profiles set failed_login_count = 0, locked_until = null, last_login_at = now() where id = p_user_id;
$$;

-- ---------------------------------------------------------------------
-- Helpers used by RLS policies (evaluated with auth.uid())
-- ---------------------------------------------------------------------
create or replace function public.has_role(p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role_code = p_role)
$$;

create or replace function public.is_platform_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid()
                 and role_code in ('SUPER_ADMIN','ADMIN','SUPPORT_ADMIN'))
$$;

create or replace function public.is_group_member(p_group_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from osusu_members where group_id = p_group_id and user_id = auth.uid() and status = 'active')
$$;

create or replace function public.is_group_admin(p_group_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from osusu_groups where id = p_group_id and admin_id = auth.uid())
$$;

create or replace function public.is_conversation_member(p_conversation_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversation_members
                 where conversation_id = p_conversation_id and user_id = auth.uid() and left_at is null)
$$;

create or replace function public.is_plan_party(p_plan_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from collector_savers
                 where id = p_plan_id and (saver_id = auth.uid() or collector_id = auth.uid()))
$$;

create or replace function public.shares_context_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from osusu_members a join osusu_members b on a.group_id = b.group_id
     where a.user_id = auth.uid() and b.user_id = p_user_id and a.status = 'active' and b.status = 'active')
  or exists (
    select 1 from collector_savers s
     where (s.saver_id = auth.uid() and s.collector_id = p_user_id)
        or (s.collector_id = auth.uid() and s.saver_id = p_user_id))
$$;

-- ---------------------------------------------------------------------
-- OSUSU
-- ---------------------------------------------------------------------
create or replace function public.frequency_step(p_frequency text) returns interval
language sql immutable as $$
  select case p_frequency
    when 'daily' then interval '1 day'
    when 'weekly' then interval '7 days'
    when 'biweekly' then interval '14 days'
    else interval '1 month' end
$$;

create or replace function public.set_osusu_payout_order(p_group_id uuid, p_actor uuid, p_member_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  g osusu_groups%rowtype;
  v_active int;
begin
  select * into g from osusu_groups where id = p_group_id for update;
  if not found then perform app_error(404, 'GROUP_NOT_FOUND', 'Group not found'); end if;
  if g.admin_id <> p_actor then perform app_error(403, 'FORBIDDEN', 'Only the organiser can set the payout order'); end if;
  if g.status <> 'recruiting' then perform app_error(409, 'ORDER_LOCKED', 'Payout order is locked once the group starts'); end if;

  select count(*) into v_active from osusu_members where group_id = p_group_id and status = 'active';
  if coalesce(array_length(p_member_ids, 1), 0) <> v_active
     or (select count(distinct x) from unnest(p_member_ids) x) <> v_active
     or exists (select 1 from unnest(p_member_ids) x
                where not exists (select 1 from osusu_members m where m.id = x and m.group_id = p_group_id and m.status = 'active')) then
    perform app_error(422, 'INVALID_ORDER', 'The order must list every active member exactly once');
  end if;

  set constraints osusu_members_position_unique deferred;
  update osusu_members set payout_position = null where group_id = p_group_id;
  update osusu_members m set payout_position = o.pos
    from unnest(p_member_ids) with ordinality as o(member_id, pos)
   where m.id = o.member_id;
  update osusu_groups set payout_order_method = 'manual' where id = p_group_id;
  perform audit_event(p_actor, 'osusu.payout_order.set', 'osusu_group', p_group_id::text, 'success',
    jsonb_build_object('order', to_jsonb(p_member_ids)));
end $$;

create or replace function public._open_osusu_cycle(p_cycle_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c osusu_cycles%rowtype;
  g osusu_groups%rowtype;
  m record;
begin
  select * into c from osusu_cycles where id = p_cycle_id for update;
  if not found or c.status <> 'upcoming' then return; end if;
  select * into g from osusu_groups where id = c.group_id;

  update osusu_cycles set status = 'open', opened_at = now() where id = c.id;
  insert into osusu_contributions (group_id, cycle_id, cycle_number, member_id, user_id, amount, due_date)
  select c.group_id, c.id, c.cycle_number, om.id, om.user_id, g.contribution_amount, c.due_date
    from osusu_members om
   where om.group_id = c.group_id and om.status = 'active'
  on conflict (cycle_id, member_id) do nothing;
  update osusu_groups set current_cycle = greatest(current_cycle, c.cycle_number) where id = g.id;

  for m in select user_id from osusu_members where group_id = c.group_id and status = 'active' loop
    perform enqueue_notification(m.user_id, 'osusu_cycle_open', 'reminders', 'Contribution window open',
      format('Your %s contribution of %s for %s (cycle %s) is due on %s.',
             g.frequency, fmt_naira(g.contribution_amount), g.name, c.cycle_number, to_char(c.due_date, 'DD Mon YYYY')),
      jsonb_build_object('group_id', g.id, 'cycle_id', c.id),
      'cycle_open:' || c.id || ':' || m.user_id);
  end loop;
end $$;

create or replace function public.start_osusu_group(p_group_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g        osusu_groups%rowtype;
  v_count  int;
  v_start  date;
  v_due    date;
  v_cycle  uuid;
  m        record;
begin
  select * into g from osusu_groups where id = p_group_id for update;
  if not found then perform app_error(404, 'GROUP_NOT_FOUND', 'Group not found'); end if;
  if g.admin_id <> p_actor then perform app_error(403, 'FORBIDDEN', 'Only the group organiser can start this group'); end if;
  if g.status <> 'recruiting' then perform app_error(409, 'GROUP_NOT_RECRUITING', 'This group has already started or is closed'); end if;

  update osusu_members set status = 'rejected', removed_at = now(), removal_reason = 'Group started before approval'
   where group_id = p_group_id and status = 'pending_approval';

  select count(*) into v_count from osusu_members where group_id = p_group_id and status = 'active';
  if v_count < 2 then perform app_error(422, 'NOT_ENOUGH_MEMBERS', 'At least two active members are required to start'); end if;
  if v_count > g.max_members then perform app_error(422, 'TOO_MANY_MEMBERS', 'Active members exceed the group limit'); end if;

  set constraints osusu_members_position_unique deferred;
  update osusu_members set payout_position = null where group_id = p_group_id and status <> 'active';
  if g.payout_order_method = 'manual' then
    if exists (select 1 from osusu_members where group_id = p_group_id and status = 'active' and payout_position is null)
       or (select max(payout_position) from osusu_members where group_id = p_group_id and status = 'active') <> v_count then
      perform app_error(422, 'PAYOUT_ORDER_INCOMPLETE', 'Set a complete payout order before starting');
    end if;
  else
    with ordered as (
      select id, row_number() over (
               order by case when g.payout_order_method = 'random' then random() end, joined_at, id) as pos
        from osusu_members where group_id = p_group_id and status = 'active')
    update osusu_members om set payout_position = o.pos from ordered o where om.id = o.id;
  end if;

  v_start := greatest(g.start_date, lagos_today());
  for m in select id, user_id, payout_position from osusu_members
            where group_id = p_group_id and status = 'active' order by payout_position loop
    v_due := (v_start + (m.payout_position - 1) * frequency_step(g.frequency))::date;
    insert into osusu_cycles (group_id, cycle_number, due_date, recipient_member_id, member_count, expected_amount)
    values (p_group_id, m.payout_position, v_due, m.id, v_count, g.contribution_amount * v_count)
    returning id into v_cycle;
    insert into osusu_payouts (group_id, cycle_id, cycle_number, recipient_member_id, recipient_user_id, amount)
    values (p_group_id, v_cycle, m.payout_position, m.id, m.user_id, g.contribution_amount * v_count);
    perform enqueue_notification(m.user_id, 'osusu_group_started', 'payouts', 'Your Osusu group has started',
      format('%s has started. Your payout position is %s of %s (cycle due %s). You will contribute every cycle until all members have been paid.',
             g.name, m.payout_position, v_count, to_char(v_due, 'DD Mon YYYY')),
      jsonb_build_object('group_id', p_group_id), 'group_started:' || p_group_id || ':' || m.user_id);
  end loop;

  update osusu_groups set status = 'active', started_at = now(), start_date = v_start, total_cycles = v_count
   where id = p_group_id;
  perform _open_osusu_cycle((select id from osusu_cycles where group_id = p_group_id and cycle_number = 1));
  perform audit_event(p_actor, 'osusu.group.start', 'osusu_group', p_group_id::text, 'success',
    jsonb_build_object('members', v_count, 'start_date', v_start));
  return jsonb_build_object('group_id', p_group_id, 'total_cycles', v_count, 'start_date', v_start);
end $$;

create or replace function public.open_due_osusu_cycles() returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  for r in
    select c.id from osusu_cycles c join osusu_groups g on g.id = c.group_id
     where g.status = 'active' and c.status = 'upcoming'
       and exists (select 1 from osusu_cycles p
                    where p.group_id = c.group_id and p.cycle_number = c.cycle_number - 1
                      and (p.status = 'paid_out' or p.due_date < lagos_today()))
     order by c.group_id, c.cycle_number
  loop
    perform _open_osusu_cycle(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Default tracking: overdue contributions, with special handling for members
-- who already received their payout. Statuses are neutral ("review required").
create or replace function public.mark_overdue_contributions() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  m osusu_members%rowtype;
  v_n int := 0;
begin
  for r in
    update osusu_contributions c set status = 'overdue'
      from osusu_groups g
     where g.id = c.group_id and c.status = 'pending'
       and c.due_date + g.grace_period_days < lagos_today()
    returning c.id, c.member_id, c.user_id, c.group_id, c.amount, c.cycle_number, g.name as group_name, g.admin_id
  loop
    v_n := v_n + 1;
    select * into m from osusu_members where id = r.member_id for update;
    if m.has_received_payout then
      update osusu_members set risk_status = 'review_required' where id = m.id;
      insert into risk_flags (subject_user_id, context, reason_code, severity, status, group_id, details)
      values (r.user_id, 'osusu', 'post_payout_default', 'high', 'review_required', r.group_id,
              jsonb_build_object('contribution_id', r.id, 'cycle_number', r.cycle_number,
                                 'payout_received_cycle', m.payout_received_cycle))
      on conflict do nothing;
    elsif m.risk_status = 'good' then
      update osusu_members set risk_status = 'payment_overdue' where id = m.id;
    end if;

    perform enqueue_notification(r.user_id, 'osusu_contribution_overdue', 'reminders', 'Contribution overdue',
      format('Your ACHIEVER contribution of %s for %s (cycle %s) is overdue. Please pay as soon as possible.',
             fmt_naira(r.amount), r.group_name, r.cycle_number),
      jsonb_build_object('group_id', r.group_id, 'contribution_id', r.id), 'overdue:' || r.id);
    perform enqueue_notification(r.admin_id, 'osusu_group_overdue', 'reminders', 'Overdue contributions',
      format('One or more contributions in %s are now overdue. Review the cycle in your dashboard.', r.group_name),
      jsonb_build_object('group_id', r.group_id), 'overdue_admin:' || r.group_id || ':' || lagos_today());
  end loop;
  return v_n;
end $$;

create or replace function public.enqueue_contribution_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  for r in
    select c.id, c.user_id, c.amount, c.due_date, c.group_id, g.name
      from osusu_contributions c join osusu_groups g on g.id = c.group_id
     where c.status = 'pending' and c.due_date in (lagos_today(), lagos_today() + 1)
  loop
    if r.due_date = lagos_today() then
      perform enqueue_notification(r.user_id, 'osusu_contribution_due', 'reminders', 'Contribution due today',
        format('Your ACHIEVER contribution of %s for %s is due today.', fmt_naira(r.amount), r.name),
        jsonb_build_object('group_id', r.group_id, 'contribution_id', r.id), 'due_today:' || r.id);
    else
      perform enqueue_notification(r.user_id, 'osusu_contribution_due', 'reminders', 'Contribution due tomorrow',
        format('Your ACHIEVER contribution of %s for %s is due tomorrow.', fmt_naira(r.amount), r.name),
        jsonb_build_object('group_id', r.group_id, 'contribution_id', r.id), 'due_tomorrow:' || r.id);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.approve_osusu_payout(p_cycle_id uuid, p_actor uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c      osusu_cycles%rowtype;
  g      osusu_groups%rowtype;
  p      osusu_payouts%rowtype;
  m      osusu_members%rowtype;
  v_paid int;
  v_sum  bigint;
  v_ref  text;
begin
  if p_mode not in ('manual','paystack_transfer') then perform app_error(500, 'INVALID_MODE', 'Invalid payout mode'); end if;
  select * into c from osusu_cycles where id = p_cycle_id for update;
  if not found then perform app_error(404, 'CYCLE_NOT_FOUND', 'Cycle not found'); end if;
  select * into g from osusu_groups where id = c.group_id;
  if g.admin_id <> p_actor then perform app_error(403, 'FORBIDDEN', 'Only the group organiser can approve payouts'); end if;
  if g.status <> 'active' then perform app_error(409, 'GROUP_NOT_ACTIVE', 'Group is not active'); end if;

  select * into p from osusu_payouts where cycle_id = c.id for update;
  if p.status <> 'scheduled' then
    perform app_error(409, 'PAYOUT_ALREADY_PROCESSED', 'This payout has already been ' || p.status);
  end if;
  if c.status <> 'funded' then
    perform app_error(422, 'CYCLE_NOT_FUNDED', 'All members must pay this cycle before the payout can be approved');
  end if;

  -- Re-derive totals from source rows instead of trusting counters.
  select count(*), coalesce(sum(amount), 0) into v_paid, v_sum
    from osusu_contributions where cycle_id = c.id and status = 'paid';
  if v_paid <> c.member_count or v_sum <> c.expected_amount then
    perform audit_event(p_actor, 'osusu.payout.approve', 'osusu_cycle', c.id::text, 'failure',
      jsonb_build_object('reason', 'totals_mismatch', 'paid', v_paid, 'sum', v_sum));
    perform app_error(409, 'CYCLE_TOTALS_MISMATCH', 'Cycle totals do not reconcile; payout blocked for review');
  end if;

  if exists (select 1 from osusu_payouts where group_id = c.group_id and cycle_number < c.cycle_number and status <> 'paid') then
    perform app_error(422, 'PREVIOUS_PAYOUT_PENDING', 'Earlier cycle payouts must be completed first');
  end if;

  select * into m from osusu_members where id = p.recipient_member_id for update;
  if m.status <> 'active' or m.has_received_payout then
    perform app_error(422, 'RECIPIENT_INELIGIBLE', 'The scheduled recipient is not eligible for this payout');
  end if;

  v_ref := new_reference('ACH-PO');
  update osusu_payouts
     set status = 'approved', amount = v_sum, payout_reference = v_ref, execution_mode = p_mode,
         approved_by = p_actor, approved_at = now(), failure_reason = null
   where id = p.id;
  update osusu_cycles set status = 'payout_pending' where id = c.id;

  perform enqueue_notification(p.recipient_user_id, 'osusu_payout_approved', 'payouts', 'Payout approved',
    format('Your Osusu payout of %s from %s (cycle %s) has been approved and is being processed.',
           fmt_naira(v_sum), g.name, c.cycle_number),
    jsonb_build_object('group_id', g.id, 'payout_id', p.id), 'payout_approved:' || p.id || ':' || v_ref);
  perform audit_event(p_actor, 'osusu.payout.approve', 'osusu_payout', p.id::text, 'success',
    jsonb_build_object('amount', v_sum, 'reference', v_ref, 'mode', p_mode, 'cycle', c.cycle_number));

  return jsonb_build_object('payout_id', p.id, 'reference', v_ref, 'amount', v_sum,
                            'recipient_user_id', p.recipient_user_id, 'mode', p_mode);
end $$;

create or replace function public.complete_osusu_payout(p_payout_id uuid, p_provider_reference text, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p      osusu_payouts%rowtype;
  g      osusu_groups%rowtype;
  v_tx   uuid;
  v_next uuid;
  v_done boolean;
  r      record;
begin
  select * into p from osusu_payouts where id = p_payout_id for update;
  if not found then perform app_error(404, 'PAYOUT_NOT_FOUND', 'Payout not found'); end if;
  if p.status = 'paid' then return jsonb_build_object('outcome', 'already_paid', 'payout_id', p.id); end if;
  if p.status not in ('approved','processing') then
    perform app_error(409, 'PAYOUT_NOT_APPROVED', 'Payout must be approved before it can be completed');
  end if;
  select * into g from osusu_groups where id = p.group_id for update;

  insert into transactions (reference, user_id, group_id, type, direction, amount, provider, provider_reference,
                            status, description, metadata, completed_at)
  values (new_reference('ACH-TX'), p.recipient_user_id, p.group_id, 'osusu_payout', 'credit', p.amount,
          case when p.execution_mode = 'paystack_transfer' then 'paystack_transfer' else 'manual' end,
          p_provider_reference, 'success', format('Osusu payout — %s cycle %s', g.name, p.cycle_number),
          jsonb_build_object('payout_id', p.id, 'payout_reference', p.payout_reference, 'cycle_number', p.cycle_number),
          now())
  returning id into v_tx;

  update osusu_payouts set status = 'paid', paid_at = now(), provider_reference = p_provider_reference,
         processed_by = p_actor, transaction_id = v_tx
   where id = p.id;
  update osusu_members set has_received_payout = true, payout_received_cycle = p.cycle_number
   where id = p.recipient_member_id;
  update osusu_cycles set status = 'paid_out', closed_at = now() where id = p.cycle_id;

  select not exists (select 1 from osusu_cycles where group_id = p.group_id and status <> 'paid_out') into v_done;
  if v_done then
    update osusu_groups set status = 'completed', completed_at = now() where id = g.id;
    for r in select user_id from osusu_members where group_id = g.id and status = 'active' loop
      perform enqueue_notification(r.user_id, 'osusu_group_completed', 'payouts', 'Osusu group completed',
        format('%s has completed all %s cycles. Every member has received their payout.', g.name, g.total_cycles),
        jsonb_build_object('group_id', g.id), 'group_completed:' || g.id || ':' || r.user_id);
    end loop;
  else
    select id into v_next from osusu_cycles
     where group_id = p.group_id and cycle_number = p.cycle_number + 1 and status = 'upcoming';
    if v_next is not null then perform _open_osusu_cycle(v_next); end if;
  end if;

  perform enqueue_notification(p.recipient_user_id, 'osusu_payout_paid', 'payouts', 'Payout sent',
    format('Your Osusu payout of %s from %s has been paid.%s', fmt_naira(p.amount), g.name,
           case when v_done then '' else ' Please keep contributing each cycle until every member has been paid.' end),
    jsonb_build_object('group_id', g.id, 'payout_id', p.id, 'transaction_id', v_tx), 'payout_paid:' || p.id);
  for r in select om.user_id from osusu_members om
            where om.group_id = g.id and om.status = 'active' and om.user_id <> p.recipient_user_id loop
    perform enqueue_notification(r.user_id, 'osusu_cycle_paid_out', 'system', 'Cycle payout completed',
      format('Cycle %s payout for %s has been completed.', p.cycle_number, g.name),
      jsonb_build_object('group_id', g.id), 'cycle_paid:' || p.id || ':' || r.user_id);
  end loop;
  perform audit_event(p_actor, 'osusu.payout.complete', 'osusu_payout', p.id::text, 'success',
    jsonb_build_object('transaction_id', v_tx, 'provider_reference', p_provider_reference, 'amount', p.amount));

  return jsonb_build_object('outcome', 'paid', 'payout_id', p.id, 'transaction_id', v_tx, 'group_completed', v_done);
end $$;

create or replace function public.osusu_group_summary(p_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  g        osusu_groups%rowtype;
  cur      osusu_cycles%rowtype;
  nxt      osusu_cycles%rowtype;
  v_result jsonb;
begin
  select * into g from osusu_groups where id = p_group_id;
  if not found then return null; end if;
  select * into cur from osusu_cycles
   where group_id = p_group_id and status in ('open','funded','payout_pending') order by cycle_number limit 1;
  if cur.id is not null then
    select * into nxt from osusu_cycles where group_id = p_group_id and cycle_number = cur.cycle_number + 1;
  else
    select * into nxt from osusu_cycles where group_id = p_group_id and status = 'upcoming' order by cycle_number limit 1;
  end if;

  select jsonb_build_object(
    'active_members', (select count(*) from osusu_members where group_id = p_group_id and status = 'active'),
    'pending_members', (select count(*) from osusu_members where group_id = p_group_id and status = 'pending_approval'),
    'pool_per_cycle', g.contribution_amount * coalesce(g.total_cycles,
                        (select count(*) from osusu_members where group_id = p_group_id and status = 'active')),
    'total_cycles', g.total_cycles,
    'completed_cycles', (select count(*) from osusu_cycles where group_id = p_group_id and status = 'paid_out'),
    'remaining_cycles', (select count(*) from osusu_cycles where group_id = p_group_id and status <> 'paid_out'),
    'total_collected', (select coalesce(sum(amount), 0) from osusu_contributions where group_id = p_group_id and status = 'paid'),
    'total_outstanding', (select coalesce(sum(amount), 0) from osusu_contributions where group_id = p_group_id and status in ('pending','overdue')),
    'total_paid_out', (select coalesce(sum(amount), 0) from osusu_payouts where group_id = p_group_id and status = 'paid'),
    'overdue_contributions', (select count(*) from osusu_contributions where group_id = p_group_id and status = 'overdue'),
    'members_under_review', (select count(*) from osusu_members where group_id = p_group_id and risk_status in ('review_required','risk_review')),
    'current_cycle', case when cur.id is null then null else jsonb_build_object(
        'id', cur.id, 'cycle_number', cur.cycle_number, 'due_date', cur.due_date, 'status', cur.status,
        'expected_amount', cur.expected_amount, 'collected_amount', cur.collected_amount,
        'outstanding_amount', cur.expected_amount - cur.collected_amount,
        'paid_count', cur.paid_count, 'unpaid_count', cur.member_count - cur.paid_count,
        'recipient_member_id', cur.recipient_member_id,
        'recipient_name', (select p.full_name from osusu_members om join profiles p on p.id = om.user_id where om.id = cur.recipient_member_id),
        'payout_status', (select status from osusu_payouts where cycle_id = cur.id)) end,
    'next_cycle', case when nxt.id is null then null else jsonb_build_object(
        'id', nxt.id, 'cycle_number', nxt.cycle_number, 'due_date', nxt.due_date,
        'recipient_member_id', nxt.recipient_member_id,
        'recipient_name', (select p.full_name from osusu_members om join profiles p on p.id = om.user_id where om.id = nxt.recipient_member_id)) end
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------
-- COLLECTOR
-- ---------------------------------------------------------------------
create or replace function public.calc_collector_commission(p_type text, p_value bigint, p_total bigint, p_balance bigint)
returns bigint
language sql immutable as $$
  select least(greatest(p_balance, 0), greatest(0,
    case when p_type = 'percentage' then floor(p_total::numeric * p_value / 10000)::bigint else p_value end))
$$;

create or replace function public.request_collector_return(p_plan_id uuid, p_actor uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s        collector_savers%rowtype;
  v_early  boolean;
  v_comm   bigint;
  v_id     uuid;
  v_other  uuid;
begin
  select * into s from collector_savers where id = p_plan_id for update;
  if not found then perform app_error(404, 'PLAN_NOT_FOUND', 'Savings plan not found'); end if;
  if p_actor not in (s.saver_id, s.collector_id) then perform app_error(403, 'FORBIDDEN', 'You are not part of this plan'); end if;
  if s.status not in ('active','matured') then
    perform app_error(409, 'RETURN_NOT_ALLOWED', 'A return cannot be requested while the plan is ' || s.status);
  end if;
  if s.balance <= 0 then perform app_error(422, 'NOTHING_TO_RETURN', 'There is no balance to return'); end if;

  v_early := s.end_date > lagos_today();
  v_comm  := calc_collector_commission(s.commission_type, s.commission_value, s.total_contributed, s.balance);
  insert into collector_returns (collector_saver_id, saver_id, collector_id, gross_amount, commission_amount, net_amount,
                                 is_early, reason, requested_by)
  values (s.id, s.saver_id, s.collector_id, s.balance, v_comm, s.balance - v_comm, v_early, p_reason, p_actor)
  returning id into v_id;
  update collector_savers set status = 'return_requested' where id = s.id;

  if v_early and p_actor = s.collector_id then
    insert into risk_flags (subject_user_id, context, reason_code, severity, collector_saver_id, details)
    values (s.collector_id, 'collector', 'early_return_request', 'low', s.id,
            jsonb_build_object('return_id', v_id, 'balance', s.balance));
  end if;

  v_other := case when p_actor = s.saver_id then s.collector_id else s.saver_id end;
  perform enqueue_notification(v_other, 'collector_return_requested', 'payouts', 'Savings return requested',
    format('A %sreturn of %s has been requested for the plan "%s".',
           case when v_early then 'early ' else '' end, fmt_naira(s.balance), s.plan_name),
    jsonb_build_object('plan_id', s.id, 'return_id', v_id), 'return_requested:' || v_id);
  perform audit_event(p_actor, 'collector.return.request', 'collector_return', v_id::text, 'success',
    jsonb_build_object('plan_id', s.id, 'gross', s.balance, 'commission', v_comm, 'early', v_early));
  return jsonb_build_object('return_id', v_id, 'gross_amount', s.balance, 'commission_amount', v_comm,
                            'net_amount', s.balance - v_comm, 'is_early', v_early);
end $$;

create or replace function public.approve_collector_return(p_return_id uuid, p_actor uuid, p_mode text, p_as_platform_admin boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r      collector_returns%rowtype;
  s      collector_savers%rowtype;
  v_comm bigint;
  v_ref  text;
  v_cm   uuid;
begin
  if p_mode not in ('manual','paystack_transfer') then perform app_error(500, 'INVALID_MODE', 'Invalid payout mode'); end if;
  select * into r from collector_returns where id = p_return_id for update;
  if not found then perform app_error(404, 'RETURN_NOT_FOUND', 'Return request not found'); end if;
  if r.collector_id <> p_actor and not p_as_platform_admin then
    perform app_error(403, 'FORBIDDEN', 'Only the collector can approve this return');
  end if;
  if r.status <> 'requested' then perform app_error(409, 'RETURN_ALREADY_PROCESSED', 'This return has already been ' || r.status); end if;

  select * into s from collector_savers where id = r.collector_saver_id for update;
  if s.balance <= 0 then perform app_error(422, 'NOTHING_TO_RETURN', 'There is no balance to return'); end if;
  -- Recalculate at approval: contributions may have arrived since the request.
  v_comm := calc_collector_commission(s.commission_type, s.commission_value, s.total_contributed, s.balance);
  v_ref  := new_reference('ACH-RT');
  update collector_returns
     set status = 'approved', gross_amount = s.balance, commission_amount = v_comm, net_amount = s.balance - v_comm,
         return_reference = v_ref, execution_mode = p_mode, approved_by = p_actor, approved_at = now()
   where id = r.id;
  if v_comm > 0 then
    insert into collector_commissions (collector_saver_id, collector_account_id, collector_id, return_id, amount,
                                       commission_reference, execution_mode)
    values (s.id, s.collector_account_id, s.collector_id, r.id, v_comm, new_reference('ACH-CM'), p_mode)
    returning id into v_cm;
  end if;
  update collector_savers set status = 'return_processing' where id = s.id;

  perform enqueue_notification(s.saver_id, 'collector_return_approved', 'payouts', 'Savings return approved',
    format('Your savings return of %s (after %s commission) has been approved and is being processed.',
           fmt_naira(s.balance - v_comm), fmt_naira(v_comm)),
    jsonb_build_object('plan_id', s.id, 'return_id', r.id), 'return_approved:' || r.id);
  perform audit_event(p_actor, 'collector.return.approve', 'collector_return', r.id::text, 'success',
    jsonb_build_object('gross', s.balance, 'commission', v_comm, 'reference', v_ref, 'as_platform_admin', p_as_platform_admin));
  return jsonb_build_object('return_id', r.id, 'reference', v_ref, 'net_amount', s.balance - v_comm,
                            'commission_id', v_cm, 'commission_amount', v_comm, 'saver_id', s.saver_id,
                            'collector_id', s.collector_id, 'mode', p_mode);
end $$;

create or replace function public.reject_collector_return(p_return_id uuid, p_actor uuid, p_reason text, p_as_platform_admin boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r collector_returns%rowtype;
  s collector_savers%rowtype;
begin
  select * into r from collector_returns where id = p_return_id for update;
  if not found then perform app_error(404, 'RETURN_NOT_FOUND', 'Return request not found'); end if;
  if r.collector_id <> p_actor and not p_as_platform_admin and r.requested_by <> p_actor then
    perform app_error(403, 'FORBIDDEN', 'You cannot change this return request');
  end if;
  if r.status <> 'requested' then perform app_error(409, 'RETURN_ALREADY_PROCESSED', 'This return has already been ' || r.status); end if;
  select * into s from collector_savers where id = r.collector_saver_id for update;
  if r.is_early = false and p_actor = r.collector_id and not p_as_platform_admin then
    perform app_error(422, 'MATURED_RETURN_REQUIRED', 'Matured savings must be returned; a collector cannot decline a matured return');
  end if;
  update collector_returns set status = 'rejected', rejection_reason = p_reason where id = r.id;
  update collector_savers set status = case when end_date <= lagos_today() then 'matured' else 'active' end where id = s.id;
  perform enqueue_notification(case when p_actor = s.saver_id then s.collector_id else s.saver_id end,
    'collector_return_declined', 'payouts', 'Return request closed',
    format('The return request for "%s" was closed. Reason: %s', s.plan_name, coalesce(p_reason, 'not provided')),
    jsonb_build_object('plan_id', s.id, 'return_id', r.id), 'return_rejected:' || r.id);
  perform audit_event(p_actor, 'collector.return.reject', 'collector_return', r.id::text, 'success',
    jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.complete_collector_return(p_return_id uuid, p_provider_reference text, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r    collector_returns%rowtype;
  s    collector_savers%rowtype;
  v_tx uuid;
begin
  select * into r from collector_returns where id = p_return_id for update;
  if not found then perform app_error(404, 'RETURN_NOT_FOUND', 'Return not found'); end if;
  if r.status = 'paid' then return jsonb_build_object('outcome', 'already_paid'); end if;
  if r.status not in ('approved','processing') then perform app_error(409, 'RETURN_NOT_APPROVED', 'Return must be approved first'); end if;
  select * into s from collector_savers where id = r.collector_saver_id for update;
  if s.balance < r.gross_amount then
    perform app_error(409, 'BALANCE_MISMATCH', 'Plan balance does not cover this return; blocked for review');
  end if;

  if r.net_amount > 0 then
    insert into transactions (reference, user_id, collector_saver_id, type, direction, amount, provider,
                              provider_reference, status, description, metadata, completed_at)
    values (new_reference('ACH-TX'), r.saver_id, s.id, 'saver_return', 'credit', r.net_amount,
            case when r.execution_mode = 'paystack_transfer' then 'paystack_transfer' else 'manual' end,
            p_provider_reference, 'success', format('Savings return — %s', s.plan_name),
            jsonb_build_object('return_id', r.id, 'return_reference', r.return_reference,
                               'gross', r.gross_amount, 'commission', r.commission_amount),
            now())
    returning id into v_tx;
  end if;

  update collector_returns set status = 'paid', paid_at = now(), provider_reference = p_provider_reference,
         processed_by = p_actor, transaction_id = v_tx
   where id = r.id;
  update collector_savers set balance = balance - r.gross_amount, total_returned = total_returned + r.net_amount,
         status = 'returned', closed_at = now()
   where id = s.id;

  perform enqueue_notification(r.saver_id, 'collector_return_paid', 'payouts', 'Savings returned',
    format('%s from your plan "%s" has been paid out to you.', fmt_naira(r.net_amount), s.plan_name),
    jsonb_build_object('plan_id', s.id, 'return_id', r.id), 'return_paid:' || r.id);
  perform enqueue_notification(r.collector_id, 'collector_return_paid', 'payouts', 'Saver return completed',
    format('The return for plan "%s" has been completed.', s.plan_name),
    jsonb_build_object('plan_id', s.id, 'return_id', r.id), 'return_paid_c:' || r.id);
  perform audit_event(p_actor, 'collector.return.complete', 'collector_return', r.id::text, 'success',
    jsonb_build_object('transaction_id', v_tx, 'provider_reference', p_provider_reference));
  return jsonb_build_object('outcome', 'paid', 'transaction_id', v_tx);
end $$;

create or replace function public.complete_collector_commission(p_commission_id uuid, p_provider_reference text, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cm   collector_commissions%rowtype;
  v_tx uuid;
begin
  select * into cm from collector_commissions where id = p_commission_id for update;
  if not found then perform app_error(404, 'COMMISSION_NOT_FOUND', 'Commission not found'); end if;
  if cm.status = 'settled' then return jsonb_build_object('outcome', 'already_paid'); end if;
  if cm.status not in ('accrued','processing') then perform app_error(409, 'COMMISSION_NOT_PAYABLE', 'Commission is ' || cm.status); end if;

  insert into transactions (reference, user_id, collector_saver_id, type, direction, amount, provider,
                            provider_reference, status, description, metadata, completed_at)
  values (new_reference('ACH-TX'), cm.collector_id, cm.collector_saver_id, 'commission', 'credit', cm.amount,
          case when cm.execution_mode = 'paystack_transfer' then 'paystack_transfer' else 'manual' end,
          p_provider_reference, 'success', 'Collector commission',
          jsonb_build_object('commission_id', cm.id, 'return_id', cm.return_id), now())
  returning id into v_tx;
  update collector_commissions set status = 'settled', settled_at = now(), provider_reference = p_provider_reference,
         transaction_id = v_tx
   where id = cm.id;
  perform enqueue_notification(cm.collector_id, 'collector_commission_paid', 'payouts', 'Commission paid',
    format('Your commission of %s has been paid.', fmt_naira(cm.amount)),
    jsonb_build_object('commission_id', cm.id), 'commission_paid:' || cm.id);
  perform audit_event(p_actor, 'collector.commission.complete', 'collector_commission', cm.id::text, 'success',
    jsonb_build_object('transaction_id', v_tx));
  return jsonb_build_object('outcome', 'paid', 'transaction_id', v_tx);
end $$;

create or replace function public.mature_collector_plans() returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  for r in
    update collector_savers set status = 'matured', matured_at = now()
     where status = 'active' and end_date <= lagos_today()
    returning id, saver_id, collector_id, plan_name, balance
  loop
    v_n := v_n + 1;
    perform enqueue_notification(r.saver_id, 'collector_plan_matured', 'payouts', 'Savings plan matured',
      format('Your plan "%s" has matured with a balance of %s. You can now request your return.', r.plan_name, fmt_naira(r.balance)),
      jsonb_build_object('plan_id', r.id), 'matured:' || r.id);
    perform enqueue_notification(r.collector_id, 'collector_plan_matured', 'payouts', 'Saver plan matured',
      format('The plan "%s" has matured. Funds of %s are now due back to the saver.', r.plan_name, fmt_naira(r.balance)),
      jsonb_build_object('plan_id', r.id), 'matured_c:' || r.id);
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Disbursement state machine shared by Osusu payouts, saver returns
-- and collector commissions (payout instruction ≠ fund movement).
-- ---------------------------------------------------------------------
create or replace function public.mark_disbursement_processing(p_kind text, p_id uuid, p_transfer_code text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if p_kind = 'osusu_payout' then
    update osusu_payouts set status = 'processing', transfer_code = p_transfer_code where id = p_id and status = 'approved';
  elsif p_kind = 'saver_return' then
    update collector_returns set status = 'processing', transfer_code = p_transfer_code where id = p_id and status = 'approved';
  elsif p_kind = 'commission' then
    update collector_commissions set status = 'processing', transfer_code = p_transfer_code where id = p_id and status = 'accrued';
  else
    perform app_error(400, 'INVALID_KIND', 'Unknown disbursement kind');
  end if;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;

create or replace function public.complete_disbursement(p_kind text, p_id uuid, p_provider_reference text, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'osusu_payout' then return complete_osusu_payout(p_id, p_provider_reference, p_actor);
  elsif p_kind = 'saver_return' then return complete_collector_return(p_id, p_provider_reference, p_actor);
  elsif p_kind = 'commission' then return complete_collector_commission(p_id, p_provider_reference, p_actor);
  end if;
  perform app_error(400, 'INVALID_KIND', 'Unknown disbursement kind');
  return null;
end $$;

create or replace function public.fail_disbursement(p_kind text, p_id uuid, p_reason text, p_actor uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_rows int; v_notify uuid;
begin
  if p_kind = 'osusu_payout' then
    update osusu_payouts set status = 'failed', failure_reason = p_reason
     where id = p_id and status in ('approved','processing')
    returning (select admin_id from osusu_groups g where g.id = osusu_payouts.group_id) into v_notify;
  elsif p_kind = 'saver_return' then
    update collector_returns set status = 'failed', failure_reason = p_reason
     where id = p_id and status in ('approved','processing') returning collector_id into v_notify;
  elsif p_kind = 'commission' then
    update collector_commissions set status = 'failed', failure_reason = p_reason
     where id = p_id and status in ('accrued','processing') returning collector_id into v_notify;
  else
    perform app_error(400, 'INVALID_KIND', 'Unknown disbursement kind');
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if;
  if v_notify is not null then
    perform enqueue_notification(v_notify, 'disbursement_failed', 'payouts', 'Payout could not be completed',
      'A payout could not be completed and has been queued for review. No funds were recorded as paid.',
      jsonb_build_object('kind', p_kind, 'id', p_id), 'disb_failed:' || p_id || ':' || extract(epoch from now())::bigint);
  end if;
  perform audit_event(p_actor, 'disbursement.fail', p_kind, p_id::text, 'failure', jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.retry_disbursement(p_kind text, p_id uuid, p_actor uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_ref text; v_rows int;
begin
  if p_kind = 'osusu_payout' then
    v_ref := new_reference('ACH-PO');
    update osusu_payouts set status = 'approved', payout_reference = v_ref, transfer_code = null, failure_reason = null
     where id = p_id and status = 'failed';
  elsif p_kind = 'saver_return' then
    v_ref := new_reference('ACH-RT');
    update collector_returns set status = 'approved', return_reference = v_ref, transfer_code = null, failure_reason = null
     where id = p_id and status = 'failed';
  elsif p_kind = 'commission' then
    v_ref := new_reference('ACH-CM');
    update collector_commissions set status = 'accrued', commission_reference = v_ref, transfer_code = null, failure_reason = null
     where id = p_id and status = 'failed';
  else
    perform app_error(400, 'INVALID_KIND', 'Unknown disbursement kind');
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then perform app_error(409, 'NOT_RETRYABLE', 'Only failed disbursements can be retried'); end if;
  perform audit_event(p_actor, 'disbursement.retry', p_kind, p_id::text, 'success', jsonb_build_object('reference', v_ref));
  return v_ref;
end $$;

-- ---------------------------------------------------------------------
-- PAYMENTS: confirmation (called only after server-side Paystack verify)
-- ---------------------------------------------------------------------
create or replace function public._create_refund_tx(
  p_user uuid, p_amount bigint, p_payment_reference text, p_reason text,
  p_group uuid default null, p_plan uuid default null, p_bill uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into transactions (reference, user_id, group_id, collector_saver_id, bill_payment_id, type, direction, amount,
                            provider, status, description, metadata)
  values (new_reference('ACH-RF'), p_user, p_group, p_plan, p_bill, 'refund', 'credit', p_amount, 'paystack', 'pending',
          'Refund of payment ' || p_payment_reference,
          jsonb_build_object('payment_reference', p_payment_reference, 'reason', p_reason))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public._apply_osusu_contribution(a payment_attempts, p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c      osusu_contributions%rowtype;
  g      osusu_groups%rowtype;
  cy     osusu_cycles%rowtype;
  v_tx   uuid;
  v_late boolean;
  v_ref  uuid;
begin
  select * into c from osusu_contributions where id = a.target_id for update;
  if not found then
    v_ref := _create_refund_tx(a.user_id, a.amount, a.reference, 'target_missing');
    return jsonb_build_object('outcome', 'duplicate', 'refund_transaction_id', v_ref);
  end if;
  select * into g from osusu_groups where id = c.group_id;
  if c.status = 'paid' or c.user_id <> a.user_id or c.amount <> a.amount then
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
  values (new_reference('ACH-TX'), a.user_id, c.group_id, 'osusu_contribution', 'debit', a.amount, 'paystack',
          a.reference, 'success', format('%s — cycle %s contribution', g.name, c.cycle_number),
          jsonb_build_object('contribution_id', c.id, 'cycle_number', c.cycle_number, 'late', v_late), now())
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
    jsonb_build_object('reference', a.reference, 'transaction_id', v_tx, 'late', v_late));
  return jsonb_build_object('outcome', 'applied', 'transaction_id', v_tx, 'group_id', g.id, 'contribution_id', c.id);
end $$;

create or replace function public._apply_collector_savings(a payment_attempts, p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s      collector_savers%rowtype;
  v_tx   uuid;
  v_ref  uuid;
  v_big  bigint := setting_bigint('risk.large_collector_contribution_kobo', 50000000);
begin
  select * into s from collector_savers where id = a.target_id for update;
  if not found or s.saver_id <> a.user_id or s.status not in ('active','matured','return_requested') then
    v_ref := _create_refund_tx(a.user_id, a.amount, a.reference, 'plan_not_accepting', null, a.target_id);
    perform enqueue_notification(a.user_id, 'payment_refund', 'payments', 'Payment will be refunded',
      format('Your payment of %s could not be applied because the plan is no longer accepting contributions. A refund has been initiated.',
             fmt_naira(a.amount)),
      jsonb_build_object('reference', a.reference), 'plan_closed:' || a.reference);
    return jsonb_build_object('outcome', 'duplicate', 'refund_transaction_id', v_ref);
  end if;

  insert into transactions (reference, user_id, collector_saver_id, type, direction, amount, provider, provider_reference,
                            status, description, metadata, completed_at)
  values (new_reference('ACH-TX'), a.user_id, s.id, 'collector_savings', 'debit', a.amount, 'paystack', a.reference,
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

create or replace function public._apply_bill_payment(a payment_attempts, p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b    bill_payments%rowtype;
  v_tx uuid;
  v_ref uuid;
begin
  select * into b from bill_payments where id = a.target_id for update;
  if not found or b.status <> 'awaiting_payment' or b.user_id <> a.user_id or b.amount <> a.amount then
    v_ref := _create_refund_tx(a.user_id, a.amount, a.reference, 'bill_not_payable', null, null, a.target_id);
    return jsonb_build_object('outcome', 'duplicate', 'refund_transaction_id', v_ref);
  end if;
  insert into transactions (reference, user_id, bill_payment_id, type, direction, amount, provider, provider_reference,
                            status, description, metadata)
  values (new_reference('ACH-TX'), a.user_id, b.id, 'bill_payment', 'debit', b.amount, 'paystack', a.reference,
          'processing', format('%s — %s', initcap(b.category), b.customer_identifier),
          jsonb_build_object('bill_payment_id', b.id, 'service_id', b.service_id))
  returning id into v_tx;
  update bill_payments set status = 'paid', payment_reference = a.reference, transaction_id = v_tx where id = b.id;
  perform audit_event(a.user_id, 'bill.paid', 'bill_payment', b.id::text, 'success', jsonb_build_object('reference', a.reference));
  return jsonb_build_object('outcome', 'applied', 'transaction_id', v_tx, 'bill_payment_id', b.id);
end $$;

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
  else
    v_result := _apply_bill_payment(a, p_paid_at);
  end if;

  update payment_attempts
     set status = case when v_result ->> 'outcome' = 'duplicate' then 'duplicate' else 'success' end,
         channel = p_channel, gateway_response = p_gateway_response, paid_at = p_paid_at, verified_at = now(),
         transaction_id = (v_result ->> 'transaction_id')::uuid,
         refund_transaction_id = (v_result ->> 'refund_transaction_id')::uuid
   where id = a.id;
  perform audit_event(null, 'payment.confirmed', 'payment_attempt', a.id::text, 'success',
    jsonb_build_object('reference', p_reference, 'source', p_source, 'outcome', v_result ->> 'outcome'));

  return v_result || jsonb_build_object('purpose', a.purpose, 'reference', p_reference, 'user_id', a.user_id,
                                        'target_id', a.target_id);
end $$;

create or replace function public.mark_payment_failed(p_reference text, p_status text, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  a       payment_attempts%rowtype;
  v_fails int;
begin
  if p_status not in ('failed','abandoned') then perform app_error(400, 'INVALID_STATUS', 'Invalid failure status'); end if;
  update payment_attempts set status = p_status, gateway_response = p_reason, verified_at = now()
   where reference = p_reference and status = 'initialized'
  returning * into a;
  if not found then return false; end if;

  select count(*) into v_fails from payment_attempts
   where user_id = a.user_id and status = 'failed' and created_at > now() - interval '24 hours';
  if v_fails >= setting_bigint('risk.failed_payments_threshold', 5) then
    insert into risk_flags (subject_user_id, context, reason_code, severity, details)
    values (a.user_id, 'payments', 'repeated_failed_payments', 'low', jsonb_build_object('count_24h', v_fails))
    on conflict do nothing;
  end if;
  if p_status = 'failed' then
    perform enqueue_notification(a.user_id, 'payment_failed', 'payments', 'Payment failed',
      format('Your payment of %s was not successful. No money was recorded. Please try again.', fmt_naira(a.amount)),
      jsonb_build_object('reference', a.reference), 'failed:' || a.reference);
  end if;
  return true;
end $$;

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
      update bill_payments set status = 'refunded' where id = t.bill_payment_id and status = 'refund_pending';
    end if;
    perform enqueue_notification(t.user_id, 'refund_completed', 'payments', 'Refund processed',
      format('Your refund of %s has been processed.', fmt_naira(t.amount)),
      jsonb_build_object('transaction_id', t.id), 'refund_done:' || t.id);
  end if;
  perform audit_event(null, 'refund.status', 'transaction', t.id::text,
    case when p_status = 'failed' then 'failure' else 'success' end, jsonb_build_object('status', p_status));
end $$;

-- ---------------------------------------------------------------------
-- BILLS
-- ---------------------------------------------------------------------
create or replace function public.record_bill_result(
  p_bill_id uuid, p_outcome text, p_provider_reference text, p_token text, p_units text,
  p_error text, p_retry_in_seconds int default 300
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b     bill_payments%rowtype;
  v_ref uuid;
begin
  select * into b from bill_payments where id = p_bill_id for update;
  if not found then perform app_error(404, 'BILL_NOT_FOUND', 'Bill payment not found'); end if;
  if b.status in ('delivered','refund_pending','refunded','failed') then
    return jsonb_build_object('outcome', 'already_final', 'status', b.status);
  end if;
  if b.status not in ('paid','processing') then perform app_error(409, 'BILL_NOT_PAID', 'Bill has not been paid'); end if;

  if p_outcome = 'delivered' then
    update bill_payments set status = 'delivered', provider_reference = p_provider_reference, token = p_token,
           units = p_units, completed_at = now(), last_error = null, next_retry_at = null, attempts = attempts + 1
     where id = b.id;
    update transactions set status = 'success', completed_at = now(),
           metadata = metadata || jsonb_build_object('provider_reference', p_provider_reference)
     where id = b.transaction_id;
    perform enqueue_notification(b.user_id, 'bill_delivered', 'payments', 'Bill payment successful',
      format('Your %s purchase of %s for %s was successful.%s', b.category, fmt_naira(b.amount), b.customer_identifier,
             case when p_token is not null then ' Token: ' || p_token else '' end),
      jsonb_build_object('bill_payment_id', b.id), 'bill_done:' || b.id);
    perform audit_event(b.user_id, 'bill.delivered', 'bill_payment', b.id::text, 'success',
      jsonb_build_object('provider_reference', p_provider_reference));
    return jsonb_build_object('outcome', 'delivered');
  elsif p_outcome = 'failed' then
    update transactions set status = 'failed', completed_at = now() where id = b.transaction_id;
    v_ref := _create_refund_tx(b.user_id, b.amount, b.payment_reference, 'bill_failed', null, null, b.id);
    update bill_payments set status = 'refund_pending', last_error = p_error, completed_at = now(),
           attempts = attempts + 1, next_retry_at = null
     where id = b.id;
    perform enqueue_notification(b.user_id, 'bill_failed', 'payments', 'Bill payment failed',
      format('Your %s purchase of %s could not be completed. A refund has been initiated.', b.category, fmt_naira(b.amount)),
      jsonb_build_object('bill_payment_id', b.id), 'bill_failed:' || b.id);
    perform audit_event(b.user_id, 'bill.failed', 'bill_payment', b.id::text, 'failure', jsonb_build_object('error', p_error));
    return jsonb_build_object('outcome', 'failed', 'refund_transaction_id', v_ref, 'payment_reference', b.payment_reference);
  else
    update bill_payments set status = 'processing', last_error = p_error, attempts = attempts + 1,
           provider_reference = coalesce(p_provider_reference, provider_reference),
           next_retry_at = now() + make_interval(secs => p_retry_in_seconds)
     where id = b.id;
    return jsonb_build_object('outcome', 'processing');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- MESSAGING
-- ---------------------------------------------------------------------
create or replace function public.post_message(
  p_conversation_id uuid, p_sender_id uuid, p_kind text, p_body text,
  p_metadata jsonb default '{}'::jsonb, p_attachments jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_sender_id is not null and not exists (
      select 1 from conversation_members where conversation_id = p_conversation_id and user_id = p_sender_id and left_at is null) then
    perform app_error(403, 'NOT_A_MEMBER', 'You are not a member of this conversation');
  end if;
  insert into messages (conversation_id, sender_id, kind, body, metadata)
  values (p_conversation_id, p_sender_id, p_kind, p_body, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  insert into message_attachments (message_id, conversation_id, storage_path, file_name, mime_type, size_bytes)
  select v_id, p_conversation_id, x ->> 'storage_path', x ->> 'file_name', x ->> 'mime_type', (x ->> 'size_bytes')::int
    from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) x;
  update conversations set last_message_at = now() where id = p_conversation_id;
  if p_sender_id is not null then
    update conversation_members set last_read_at = now() where conversation_id = p_conversation_id and user_id = p_sender_id;
  end if;
  return v_id;
end $$;

create or replace function public.conversation_summaries(p_user_id uuid)
returns table (
  conversation_id uuid, type text, title text, osusu_group_id uuid, collector_saver_id uuid,
  last_message_at timestamptz, last_message_body text, last_message_kind text, last_sender_id uuid,
  unread_count bigint, member_count bigint, other_user_id uuid, other_user_name text,
  other_user_avatar text, other_user_last_seen timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id, c.type, coalesce(c.title, g.name, other.full_name), c.osusu_group_id, c.collector_saver_id,
         coalesce(c.last_message_at, c.created_at), lm.body, lm.kind, lm.sender_id,
         coalesce(u.unread, 0), coalesce(mc.n, 0), other.id, other.full_name, other.avatar_path, other.last_seen_at
    from conversation_members cm
    join conversations c on c.id = cm.conversation_id
    left join osusu_groups g on g.id = c.osusu_group_id
    left join lateral (
      select m.body, m.kind, m.sender_id from messages m
       where m.conversation_id = c.id and m.deleted_at is null order by m.created_at desc limit 1) lm on true
    left join lateral (
      select p.id, p.full_name, p.avatar_path, p.last_seen_at from conversation_members o
        join profiles p on p.id = o.user_id
       where o.conversation_id = c.id and o.user_id <> p_user_id and c.type <> 'group' limit 1) other on true
    left join lateral (
      select count(*) as unread from messages m
       where m.conversation_id = c.id and m.deleted_at is null
         and m.created_at > coalesce(cm.last_read_at, 'epoch'::timestamptz)
         and m.sender_id is distinct from p_user_id) u on true
    left join lateral (
      select count(*) as n from conversation_members x where x.conversation_id = c.id and x.left_at is null) mc on true
   where cm.user_id = p_user_id and cm.left_at is null
   order by coalesce(c.last_message_at, c.created_at) desc
$$;

-- ---------------------------------------------------------------------
-- MEETINGS & CALLS housekeeping
-- ---------------------------------------------------------------------
create or replace function public.enqueue_meeting_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  for r in
    select mt.id, mt.title, mt.starts_at, om.user_id, g.name,
           case when mt.starts_at <= now() + interval '1 hour' then '1h' else '24h' end as window_key
      from meetings mt
      join osusu_groups g on g.id = mt.group_id
      join osusu_members om on om.group_id = mt.group_id and om.status = 'active'
     where mt.status = 'scheduled' and mt.starts_at > now() and mt.starts_at <= now() + interval '24 hours'
  loop
    if enqueue_notification(r.user_id, 'meeting_reminder', 'meetings', 'Meeting reminder',
         format('%s (%s) starts %s.', r.title, r.name,
                to_char(r.starts_at at time zone 'Africa/Lagos', 'DD Mon YYYY "at" HH12:MI AM')),
         jsonb_build_object('meeting_id', r.id), 'meeting_' || r.window_key || ':' || r.id || ':' || r.user_id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

create or replace function public.mark_missed_calls() returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  for r in
    update calls set status = 'missed', ended_at = now()
     where status = 'ringing' and started_at < now() - interval '45 seconds'
    returning id, initiated_by, call_type, conversation_id
  loop
    v_n := v_n + 1;
    update call_participants set status = 'missed' where call_id = r.id and status = 'invited';
    perform enqueue_notification(cp.user_id, 'call_missed', 'messages', 'Missed call',
      format('You missed a %s call from %s.', r.call_type, (select full_name from profiles where id = r.initiated_by)),
      jsonb_build_object('call_id', r.id, 'conversation_id', r.conversation_id), 'missed:' || r.id || ':' || cp.user_id)
      from call_participants cp where cp.call_id = r.id and cp.status = 'missed';
  end loop;
  -- close abandoned calls
  update calls set status = 'ended', ended_at = now(),
         duration_seconds = extract(epoch from now() - coalesce(answered_at, started_at))::int
   where status = 'active' and started_at < now() - interval '6 hours';
  update meetings set status = 'completed'
   where status = 'in_progress' and starts_at + make_interval(mins => duration_minutes) < now() - interval '2 hours';
  return v_n;
end $$;

create or replace function public.acquire_job_lock(p_name text, p_owner text, p_ttl_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  insert into job_locks (name, owner, expires_at) values (p_name, p_owner, now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update set owner = excluded.owner, expires_at = excluded.expires_at
   where job_locks.expires_at < now() or job_locks.owner = excluded.owner
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- ---------------------------------------------------------------------
-- PLATFORM ADMIN overview
-- ---------------------------------------------------------------------
create or replace function public.platform_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total_users', (select count(*) from profiles),
    'active_users_30d', (select count(*) from profiles where last_seen_at > now() - interval '30 days'),
    'suspended_users', (select count(*) from profiles where account_status = 'suspended'),
    'osusu_groups_total', (select count(*) from osusu_groups),
    'osusu_groups_active', (select count(*) from osusu_groups where status = 'active'),
    'collector_accounts_active', (select count(*) from collector_accounts where status = 'active'),
    'savings_plans_active', (select count(*) from collector_savers where status in ('active','matured','return_requested','return_processing')),
    'contributions_total', (select coalesce(sum(amount), 0) from transactions
                             where type in ('osusu_contribution','collector_savings') and status = 'success'),
    'payouts_total', (select coalesce(sum(amount), 0) from transactions
                       where type in ('osusu_payout','saver_return') and status = 'success'),
    'payouts_pending', (select count(*) from osusu_payouts where status in ('approved','processing'))
                     + (select count(*) from collector_returns where status in ('approved','processing'))
                     + (select count(*) from collector_commissions where status in ('accrued','processing')),
    'bill_payments_total', (select coalesce(sum(amount), 0) from bill_payments where status = 'delivered'),
    'bill_payments_count', (select count(*) from bill_payments where status = 'delivered'),
    'failed_payments_7d', (select count(*) from payment_attempts where status in ('failed','amount_mismatch')
                            and created_at > now() - interval '7 days'),
    'failed_bills_7d', (select count(*) from bill_payments where status in ('refund_pending','refunded','failed')
                         and created_at > now() - interval '7 days'),
    'pending_refunds', (select count(*) from transactions where type = 'refund' and status in ('pending','processing')),
    'pending_verifications', (select count(*) from verification_records where status in ('pending','manual_review')),
    'open_tickets', (select count(*) from support_tickets where status in ('open','in_progress','awaiting_user')),
    'open_risk_flags', (select count(*) from risk_flags where status in ('review_required','risk_review')),
    'commission_total', (select coalesce(sum(amount), 0) from transactions where type = 'commission' and status = 'success')
  )
$$;
