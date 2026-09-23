-- =====================================================================
-- ACHIEVER — Row Level Security
--
-- Architecture: the React client NEVER writes to Supabase directly. All
-- writes go through the Express API, which uses the service role and enforces
-- authorisation in code. RLS is the second line of defence: if the anon key
-- plus a user JWT is ever used directly against PostgREST, a user can read
-- only rows they are entitled to and can write nothing financial.
--
-- There are deliberately NO insert/update/delete policies on financial tables.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'roles','profiles','user_roles','otp_codes','payout_accounts',
    'osusu_groups','osusu_members','osusu_cycles','osusu_contributions','osusu_payouts',
    'collector_accounts','collector_savers','collector_contributions','collector_returns','collector_commissions',
    'transactions','payment_attempts','payment_webhooks','bill_payments',
    'notifications','notification_preferences',
    'conversations','conversation_members','messages','message_attachments',
    'calls','call_participants','meetings','invites',
    'verification_records','admin_undertakings','risk_flags',
    'support_tickets','ticket_messages','ticket_assignments',
    'audit_logs','app_settings','job_locks']
  loop
    -- (not FORCE: SECURITY DEFINER business functions run as the table owner)
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Browser roles may never write financial / security-critical tables, even if a
-- future policy is added by mistake.
revoke insert, update, delete, truncate on
  public.transactions, public.payment_attempts, public.payment_webhooks,
  public.osusu_cycles, public.osusu_contributions, public.osusu_payouts,
  public.collector_savers, public.collector_contributions, public.collector_returns, public.collector_commissions,
  public.bill_payments, public.verification_records, public.admin_undertakings, public.audit_logs,
  public.risk_flags, public.user_roles, public.roles, public.otp_codes, public.app_settings, public.job_locks,
  public.payout_accounts
from anon, authenticated;

-- Secrets-bearing tables are not readable by browser roles at all.
revoke all on public.otp_codes, public.payment_webhooks, public.job_locks from anon, authenticated;

-- Only a handful of profile columns may ever be updated by the user.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, address, date_of_birth) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- Function privileges: nothing is callable by browser roles except the
-- read-only helpers the policies below depend on.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
grant execute on function
  public.has_role(text), public.is_platform_staff(), public.is_group_member(uuid), public.is_group_admin(uuid),
  public.is_conversation_member(uuid), public.is_plan_party(uuid), public.shares_context_with(uuid),
  public.lagos_today()
to authenticated;

-- ---------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------
create policy roles_read on public.roles for select to authenticated using (true);

create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_platform_staff());
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy user_roles_self_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_platform_staff());

create policy payout_accounts_self_read on public.payout_accounts for select to authenticated
  using (user_id = auth.uid());

-- Osusu ------------------------------------------------------------------
create policy osusu_groups_member_read on public.osusu_groups for select to authenticated
  using (admin_id = auth.uid() or public.is_group_member(id) or public.is_platform_staff());

create policy osusu_members_read on public.osusu_members for select to authenticated
  using (user_id = auth.uid() or public.is_group_member(group_id) or public.is_group_admin(group_id)
         or public.is_platform_staff());

create policy osusu_cycles_read on public.osusu_cycles for select to authenticated
  using (public.is_group_member(group_id) or public.is_group_admin(group_id) or public.is_platform_staff());

-- Members see their own contributions; organisers see their group's.
create policy osusu_contributions_read on public.osusu_contributions for select to authenticated
  using (user_id = auth.uid() or public.is_group_admin(group_id) or public.is_platform_staff());

create policy osusu_payouts_read on public.osusu_payouts for select to authenticated
  using (public.is_group_member(group_id) or public.is_group_admin(group_id) or public.is_platform_staff());

-- Collector --------------------------------------------------------------
create policy collector_accounts_read on public.collector_accounts for select to authenticated
  using (collector_id = auth.uid()
         or exists (select 1 from public.collector_savers s where s.collector_account_id = id and s.saver_id = auth.uid())
         or public.is_platform_staff());

create policy collector_savers_read on public.collector_savers for select to authenticated
  using (saver_id = auth.uid() or collector_id = auth.uid() or public.is_platform_staff());

create policy collector_contributions_read on public.collector_contributions for select to authenticated
  using (public.is_plan_party(collector_saver_id) or public.is_platform_staff());

create policy collector_returns_read on public.collector_returns for select to authenticated
  using (saver_id = auth.uid() or collector_id = auth.uid() or public.is_platform_staff());

create policy collector_commissions_read on public.collector_commissions for select to authenticated
  using (collector_id = auth.uid() or public.is_platform_staff());

-- Ledger & payments: strictly own rows -----------------------------------
create policy transactions_own_read on public.transactions for select to authenticated
  using (user_id = auth.uid() or public.has_role('SUPER_ADMIN') or public.has_role('ADMIN'));

create policy payment_attempts_own_read on public.payment_attempts for select to authenticated
  using (user_id = auth.uid() or public.has_role('SUPER_ADMIN') or public.has_role('ADMIN'));

create policy bill_payments_own_read on public.bill_payments for select to authenticated
  using (user_id = auth.uid() or public.is_platform_staff());

-- Notifications -------------------------------------------------------------
create policy notifications_own_read on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notification_prefs_own_read on public.notification_preferences for select to authenticated
  using (user_id = auth.uid());

-- Messaging: membership required -------------------------------------------
create policy conversations_member_read on public.conversations for select to authenticated
  using (public.is_conversation_member(id));
create policy conversation_members_read on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy messages_member_read on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id) and deleted_at is null);
create policy message_attachments_member_read on public.message_attachments for select to authenticated
  using (public.is_conversation_member(conversation_id));

create policy calls_member_read on public.calls for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy call_participants_read on public.call_participants for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.calls c where c.id = call_id and public.is_conversation_member(c.conversation_id)));

create policy meetings_member_read on public.meetings for select to authenticated
  using (public.is_group_member(group_id) or public.is_group_admin(group_id));

create policy invites_inviter_read on public.invites for select to authenticated
  using (invited_by = auth.uid() or public.is_platform_staff());

-- Identity & compliance: own records, staff for review ---------------------
create policy verification_own_read on public.verification_records for select to authenticated
  using (user_id = auth.uid() or public.has_role('SUPER_ADMIN') or public.has_role('ADMIN'));
create policy undertakings_own_read on public.admin_undertakings for select to authenticated
  using (user_id = auth.uid() or public.is_platform_staff());
create policy risk_flags_staff_read on public.risk_flags for select to authenticated
  using (public.is_platform_staff());

-- Support ------------------------------------------------------------------------
create policy tickets_own_read on public.support_tickets for select to authenticated
  using (user_id = auth.uid() or public.is_platform_staff());
create policy ticket_messages_read on public.ticket_messages for select to authenticated
  using (public.is_platform_staff()
         or (internal = false and exists (select 1 from public.support_tickets t
                                          where t.id = ticket_id and t.user_id = auth.uid())));
create policy ticket_assignments_staff_read on public.ticket_assignments for select to authenticated
  using (public.is_platform_staff());

create policy audit_logs_staff_read on public.audit_logs for select to authenticated
  using (public.has_role('SUPER_ADMIN') or public.has_role('ADMIN'));
create policy app_settings_staff_read on public.app_settings for select to authenticated
  using (public.is_platform_staff());

-- ---------------------------------------------------------------------
-- Realtime: the backend subscribes (service role) and fans events out to
-- authorised browsers over Server-Sent Events.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.notifications, public.calls, public.call_participants;
  end if;
end $$;
