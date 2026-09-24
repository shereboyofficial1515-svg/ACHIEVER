-- =====================================================================
-- Settings, verification challenges, deletion requests, OAuth sessions
-- =====================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d001', 'priv.user@test.ng'),
  ('00000000-0000-0000-0000-00000000d002', 'priv.other@test.ng'),
  ('00000000-0000-0000-0000-00000000d003', 'priv.staff@test.ng');
select create_profile_with_roles('00000000-0000-0000-0000-00000000d001', 'Priv User', 'priv.user@test.ng', '+2348099000001', 'personal', array['OSUSU_MEMBER']);
select create_profile_with_roles('00000000-0000-0000-0000-00000000d002', 'Priv Other', 'priv.other@test.ng', '+2348099000002', 'personal', array['OSUSU_MEMBER']);
select create_profile_with_roles('00000000-0000-0000-0000-00000000d003', 'Priv Staff', 'priv.staff@test.ng', '+2348099000003', 'personal', array['OSUSU_MEMBER']);
insert into user_roles (user_id, role_code) values ('00000000-0000-0000-0000-00000000d003', 'COMPLIANCE_ADMIN');

-- OAuth sessions are now a valid sign-in method
select lives_ok($$ insert into user_sessions (user_id, auth_method) values ('00000000-0000-0000-0000-00000000d001', 'oauth_google') $$,
  'Google sign-in sessions can be recorded');
select throws_like($$ insert into user_sessions (user_id, auth_method) values ('00000000-0000-0000-0000-00000000d001', 'magic') $$,
  '%user_sessions_auth_method_check%', 'unknown sign-in methods are rejected');

-- Challenges: consumed only after verification
select throws_like($$ insert into security_challenges (user_id, action, channel, destination_masked, code_hash, expires_at, consumed_at)
  values ('00000000-0000-0000-0000-00000000d001', 'email_change', 'email', 'p***@test.ng', 'x', now() + interval '10 minutes', now()) $$,
  '%security_challenges_check%', 'a challenge cannot be consumed before it is verified');
select throws_like($$ insert into security_challenges (user_id, action, channel, destination_masked, code_hash, expires_at)
  values ('00000000-0000-0000-0000-00000000d001', 'delete_everything', 'email', 'x', 'x', now()) $$,
  '%security_challenges_action_check%', 'challenges exist only for known sensitive actions');

-- Deletion requests: one open request per type, never deleted, no self-decision
insert into data_deletion_requests (id, user_id, request_type, reason)
values ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d001', 'account', 'Leaving');
select throws_like($$ insert into data_deletion_requests (user_id, request_type) values ('00000000-0000-0000-0000-00000000d001', 'account') $$,
  '%data_deletion_one_open%', 'only one open request per type');
select lives_ok($$ insert into data_deletion_requests (user_id, request_type) values ('00000000-0000-0000-0000-00000000d001', 'personal_data') $$,
  'a personal-data request can coexist with an account request');
select throws_like($$ delete from data_deletion_requests where id = 'd0000000-0000-0000-0000-000000000001' $$,
  '%APPEND_ONLY%', 'deletion requests are never deleted');
select throws_like($$ update data_deletion_requests set decided_by = user_id where id = 'd0000000-0000-0000-0000-000000000001' $$,
  '%data_deletion_requests_check%', 'nobody decides their own deletion request');
select is((select cancellable_until > now() + interval '6 days' from data_deletion_requests where id = 'd0000000-0000-0000-0000-000000000001'),
  true, 'requests have a 7-day cancellation window');

-- Erasure removes optional data but keeps identity and history
update profiles set preferred_name = 'PU', occupation = 'Trader', business_name = 'PU Stores', first_name = 'Priv', last_name = 'User'
 where id = '00000000-0000-0000-0000-00000000d001';
insert into user_preferences (user_id, accessibility) values ('00000000-0000-0000-0000-00000000d001', '{"fontScale":1.25}');
select lives_ok($$ select erase_optional_personal_data('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d003', 'd0000000-0000-0000-0000-000000000001') $$,
  'optional personal data can be erased');
select is((select preferred_name is null and occupation is null and business_name is null and not show_public_location
            from profiles where id = '00000000-0000-0000-0000-00000000d001'), true, 'optional fields are cleared');
select is((select first_name from profiles where id = '00000000-0000-0000-0000-00000000d001'), 'Priv', 'legal identity is retained');
select is((select count(*)::int from account_change_history where user_id = '00000000-0000-0000-0000-00000000d001' and event_type = 'personal_data_erased'),
  1, 'erasure is recorded in the account history');

-- Notification categories
select is((select default_notification_categories() -> 'marketing' ->> 'email'), 'false', 'marketing email is off by default');
select lives_ok($$ select enqueue_notification('00000000-0000-0000-0000-00000000d002', 'support_reply', 'support', 'Reply', 'Support replied') $$,
  'support notifications use their own category');

-- RLS: users see only their own deletion requests; challenges are invisible to browser roles
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d002","role":"authenticated"}';
select is((select count(*)::int from data_deletion_requests), 0, 'users cannot see other users'' deletion requests');
reset role;

select * from finish();
rollback;
