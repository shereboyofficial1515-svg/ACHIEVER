-- =====================================================================
-- Row Level Security tests (pgTAP). Simulates a browser holding a user JWT
-- and the anon key talking to PostgREST directly.
-- =====================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'rls.a@test.ng'),
  ('00000000-0000-0000-0000-0000000000b1', 'rls.b@test.ng');
select create_profile_with_roles('00000000-0000-0000-0000-0000000000a1', 'Rls Alpha', 'rls.a@test.ng', '+2348040000001', 'osusu', array['OSUSU_ADMIN','OSUSU_MEMBER']);
select create_profile_with_roles('00000000-0000-0000-0000-0000000000b1', 'Rls Beta',  'rls.b@test.ng', '+2348040000002', 'osusu', array['OSUSU_MEMBER']);

insert into transactions (reference, user_id, type, direction, amount, provider, status)
values ('RLS-TX-A', '00000000-0000-0000-0000-0000000000a1', 'osusu_contribution', 'debit', 100000, 'paystack', 'success'),
       ('RLS-TX-B', '00000000-0000-0000-0000-0000000000b1', 'osusu_contribution', 'debit', 100000, 'paystack', 'success');

insert into osusu_groups (id, name, admin_id, contribution_amount, frequency, max_members, start_date, join_code)
values ('40000000-0000-0000-0000-000000000001', 'Private Circle', '00000000-0000-0000-0000-0000000000a1', 100000, 'weekly', 5, current_date, 'RLSCODE1');
insert into conversations (id, type, osusu_group_id, title) values ('50000000-0000-0000-0000-000000000001', 'group', '40000000-0000-0000-0000-000000000001', 'Private Circle');
insert into conversation_members (conversation_id, user_id) values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1');
insert into messages (conversation_id, sender_id, body) values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'members only');

-- Act as user B (not in the group) ------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is((select count(*)::int from transactions), 1, 'a user sees only their own ledger rows');
select is((select reference from transactions limit 1), 'RLS-TX-B', '...and it is their own');
select is((select count(*)::int from profiles), 1, "a user cannot read other users' profiles");
select is((select count(*)::int from osusu_groups), 0, 'non-members cannot see private groups');
select is((select count(*)::int from messages), 0, 'non-members cannot read group messages');
select is((select count(*)::int from conversations), 0, 'non-members cannot see conversations');

select throws_ok($$ insert into transactions (reference, user_id, type, direction, amount, provider, status)
                   values ('FORGED', '00000000-0000-0000-0000-0000000000b1', 'osusu_payout', 'credit', 999999, 'manual', 'success') $$,
                 '42501', null, 'users cannot create ledger entries');
select throws_ok($$ update transactions set status = 'success' where reference = 'RLS-TX-B' $$,
                 '42501', null, 'users cannot change their own transaction status');
select throws_ok($$ update osusu_payouts set status = 'paid' $$, '42501', null, 'users cannot change payout status');
select throws_ok($$ insert into user_roles (user_id, role_code) values ('00000000-0000-0000-0000-0000000000b1', 'SUPER_ADMIN') $$,
                 '42501', null, 'users cannot grant themselves roles');
select throws_ok($$ update verification_records set status = 'verified' $$, '42501', null, 'users cannot mark themselves verified');
select throws_ok($$ select * from otp_codes $$, '42501', null, 'OTP hashes are not readable by browser roles');
select throws_ok($$ select confirm_payment('X', 1, 'NGN', 'card', 'x', now(), 'forged') $$, '42501', null,
                 'business functions cannot be called by browser roles');

-- Profile: only whitelisted columns are writable
select throws_ok($$ update profiles set account_status = 'active', email_verified_at = now() where id = auth.uid() $$,
                 '42501', null, 'users cannot change their own account status or verification flags');

reset role;
select * from finish();
rollback;
