-- =====================================================================
-- ACHIEVER database tests (pgTAP). Run with:  supabase test db
-- Everything runs in one transaction and is rolled back.
-- =====================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'organiser@test.ng'),
  ('00000000-0000-0000-0000-00000000000b', 'member.b@test.ng'),
  ('00000000-0000-0000-0000-00000000000c', 'member.c@test.ng'),
  ('00000000-0000-0000-0000-00000000000d', 'collector@test.ng'),
  ('00000000-0000-0000-0000-00000000000e', 'saver@test.ng');

select create_profile_with_roles('00000000-0000-0000-0000-00000000000a', 'Ada Organiser', 'organiser@test.ng', '+2348030000001', 'osusu', array['OSUSU_ADMIN','OSUSU_MEMBER']);
select create_profile_with_roles('00000000-0000-0000-0000-00000000000b', 'Bola Member',  'member.b@test.ng', '+2348030000002', 'osusu', array['OSUSU_MEMBER']);
select create_profile_with_roles('00000000-0000-0000-0000-00000000000c', 'Chidi Member', 'member.c@test.ng', '+2348030000003', 'osusu', array['OSUSU_MEMBER']);
select create_profile_with_roles('00000000-0000-0000-0000-00000000000d', 'Dayo Collector','collector@test.ng','+2348030000004', 'collector', array['COLLECTOR']);
select create_profile_with_roles('00000000-0000-0000-0000-00000000000e', 'Efe Saver',    'saver@test.ng',    '+2348030000005', 'collector', array['SAVER']);

select throws_like(
  $$ select create_profile_with_roles(gen_random_uuid(), 'X', 'x@test.ng', '+2348030000009', 'osusu', array['SUPER_ADMIN']) $$,
  '%INVALID_ROLE%', 'users cannot self-assign staff roles');

insert into osusu_groups (id, name, admin_id, contribution_amount, frequency, max_members, start_date, join_code, grace_period_days)
values ('10000000-0000-0000-0000-000000000001', 'Balogun Traders', '00000000-0000-0000-0000-00000000000a',
        2000000, 'weekly', 3, current_date, 'TESTCODE', 1);
insert into osusu_members (group_id, user_id, status, is_admin, joined_at) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'active', true,  now() - interval '3 minutes'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'active', false, now() - interval '2 minutes'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'active', false, now() - interval '1 minute');

-- ---------------------------------------------------------------------
-- Osusu: start
-- ---------------------------------------------------------------------
select throws_like(
  $$ select start_osusu_group('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b') $$,
  '%FORBIDDEN%', 'only the organiser can start a group');

select lives_ok(
  $$ select start_osusu_group('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a') $$,
  'organiser starts the group');

select is((select count(*)::int from osusu_cycles where group_id = '10000000-0000-0000-0000-000000000001'), 3, 'one cycle per member');
select is((select expected_amount from osusu_cycles where group_id = '10000000-0000-0000-0000-000000000001' and cycle_number = 1),
          6000000::bigint, 'cycle pool = contribution x members');
select is((select status from osusu_cycles where group_id = '10000000-0000-0000-0000-000000000001' and cycle_number = 1), 'open', 'cycle 1 opens on start');
select is((select count(*)::int from osusu_contributions where group_id = '10000000-0000-0000-0000-000000000001'), 3, 'contribution rows created for cycle 1 only');
select is((select payout_position from osusu_members where user_id = '00000000-0000-0000-0000-00000000000a' and group_id = '10000000-0000-0000-0000-000000000001'),
          1, 'join order assigns the earliest member position 1');

-- helper: contribution id for a member in cycle n
create temp table c1 as
  select c.user_id, c.id from osusu_contributions c where c.group_id = '10000000-0000-0000-0000-000000000001' and c.cycle_number = 1;

-- ---------------------------------------------------------------------
-- Payments: confirmation, idempotency, mismatch, duplicates
-- ---------------------------------------------------------------------
insert into payment_attempts (reference, user_id, purpose, target_id, amount)
select 'T-REF-B1', user_id, 'osusu_contribution', id, 2000000 from c1 where user_id = '00000000-0000-0000-0000-00000000000b';

select is((confirm_payment('T-REF-B1', 2000000, 'NGN', 'card', 'Approved', now(), 'webhook')) ->> 'outcome', 'applied', 'verified payment is applied');
select is((confirm_payment('T-REF-B1', 2000000, 'NGN', 'card', 'Approved', now(), 'webhook')) ->> 'outcome', 'already_processed',
          'the same webhook arriving twice is a no-op');
select is((select count(*)::int from transactions where provider_reference = 'T-REF-B1'), 1, 'exactly one ledger entry for the payment');
select is((select collected_amount from osusu_cycles where group_id = '10000000-0000-0000-0000-000000000001' and cycle_number = 1),
          2000000::bigint, 'cycle total counted once');

insert into payment_attempts (reference, user_id, purpose, target_id, amount)
select 'T-REF-C-WRONG', user_id, 'osusu_contribution', id, 2000000 from c1 where user_id = '00000000-0000-0000-0000-00000000000c';
select is((confirm_payment('T-REF-C-WRONG', 1000000, 'NGN', 'card', 'Approved', now(), 'webhook')) ->> 'outcome', 'amount_mismatch',
          'a verified amount that differs from the expected amount is not applied');
select is((select status from osusu_contributions c join c1 on c1.id = c.id where c1.user_id = '00000000-0000-0000-0000-00000000000c'),
          'pending', 'contribution stays unpaid after a mismatch');
select is((select count(*)::int from transactions where type = 'refund' and metadata ->> 'payment_reference' = 'T-REF-C-WRONG'), 1,
          'a refund is queued for the mismatched payment');

insert into payment_attempts (reference, user_id, purpose, target_id, amount)
select 'T-REF-B2', user_id, 'osusu_contribution', id, 2000000 from c1 where user_id = '00000000-0000-0000-0000-00000000000b';
select is((confirm_payment('T-REF-B2', 2000000, 'NGN', 'card', 'Approved', now(), 'webhook')) ->> 'outcome', 'duplicate',
          'a second successful payment for a paid contribution is flagged as duplicate');
select is((select collected_amount from osusu_cycles where group_id = '10000000-0000-0000-0000-000000000001' and cycle_number = 1),
          2000000::bigint, 'duplicate payment does not inflate the cycle total');

select ok(mark_payment_failed('T-REF-FAIL-NONE', 'failed', 'x') = false, 'failing an unknown reference changes nothing');

-- fund the rest of cycle 1
insert into payment_attempts (reference, user_id, purpose, target_id, amount)
select 'T-REF-' || substr(user_id::text, 36), user_id, 'osusu_contribution', id, 2000000 from c1
 where user_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c');
select confirm_payment('T-REF-a', 2000000, 'NGN', 'card', 'Approved', now(), 'webhook');
select confirm_payment('T-REF-c', 2000000, 'NGN', 'card', 'Approved', now(), 'webhook');
select is((select status from osusu_cycles where group_id = '10000000-0000-0000-0000-000000000001' and cycle_number = 1), 'funded',
          'cycle becomes funded when every member has paid');

-- ---------------------------------------------------------------------
-- Payout safety
-- ---------------------------------------------------------------------
create temp table cyc as select id, cycle_number from osusu_cycles where group_id = '10000000-0000-0000-0000-000000000001';

select throws_like($$ select approve_osusu_payout((select id from cyc where cycle_number = 1), '00000000-0000-0000-0000-00000000000b', 'manual') $$,
                   '%FORBIDDEN%', 'members cannot approve payouts');
select throws_like($$ select approve_osusu_payout((select id from cyc where cycle_number = 2), '00000000-0000-0000-0000-00000000000a', 'manual') $$,
                   '%CYCLE_NOT_FUNDED%', 'unfunded cycles cannot be paid out');
select lives_ok($$ select approve_osusu_payout((select id from cyc where cycle_number = 1), '00000000-0000-0000-0000-00000000000a', 'manual') $$,
                'organiser approves a funded cycle');
select throws_like($$ select approve_osusu_payout((select id from cyc where cycle_number = 1), '00000000-0000-0000-0000-00000000000a', 'manual') $$,
                   '%PAYOUT_ALREADY_PROCESSED%', 'a second approval of the same payout is rejected');
select is((select amount from osusu_payouts where cycle_number = 1 and group_id = '10000000-0000-0000-0000-000000000001'),
          6000000::bigint, 'payout amount equals the collected pool');

select is((complete_osusu_payout((select id from osusu_payouts where cycle_number = 1 and group_id = '10000000-0000-0000-0000-000000000001'),
                                 'BANK-REF-1', null)) ->> 'outcome', 'paid', 'payout completes');
select is((complete_osusu_payout((select id from osusu_payouts where cycle_number = 1 and group_id = '10000000-0000-0000-0000-000000000001'),
                                 'BANK-REF-1', null)) ->> 'outcome', 'already_paid', 'completing twice cannot pay twice');
select is((select count(*)::int from transactions where type = 'osusu_payout'), 1, 'exactly one payout ledger entry');
select ok((select has_received_payout from osusu_members where user_id = '00000000-0000-0000-0000-00000000000a'
           and group_id = '10000000-0000-0000-0000-000000000001'), 'recipient is marked as paid out');
select is((select status from osusu_cycles where id = (select id from cyc where cycle_number = 2)), 'open', 'next cycle opens after payout');

-- ---------------------------------------------------------------------
-- Default tracking: paid-out member stops contributing
-- ---------------------------------------------------------------------
update osusu_contributions set due_date = current_date - 10
 where group_id = '10000000-0000-0000-0000-000000000001' and cycle_number = 2;
select is(mark_overdue_contributions(), 3, 'three cycle-2 contributions become overdue');
select is((select risk_status from osusu_members where user_id = '00000000-0000-0000-0000-00000000000a'
           and group_id = '10000000-0000-0000-0000-000000000001'), 'review_required',
          'a member who already received their payout and then defaults is placed under review');
select is((select risk_status from osusu_members where user_id = '00000000-0000-0000-0000-00000000000b'
           and group_id = '10000000-0000-0000-0000-000000000001'), 'payment_overdue', 'others are simply overdue');
select is((select count(*)::int from risk_flags where reason_code = 'post_payout_default'), 1, 'one neutral review case is opened');

insert into payment_attempts (reference, user_id, purpose, target_id, amount)
select 'T-REF-B-LATE', user_id, 'osusu_contribution', id, 2000000 from osusu_contributions
 where group_id = '10000000-0000-0000-0000-000000000001' and cycle_number = 2 and user_id = '00000000-0000-0000-0000-00000000000b';
select confirm_payment('T-REF-B-LATE', 2000000, 'NGN', 'card', 'Approved', now(), 'webhook');
select ok((select is_late from osusu_contributions where group_id = '10000000-0000-0000-0000-000000000001' and cycle_number = 2
           and user_id = '00000000-0000-0000-0000-00000000000b'), 'late payment is recorded as late');
select is((select risk_status from osusu_members where user_id = '00000000-0000-0000-0000-00000000000b'
           and group_id = '10000000-0000-0000-0000-000000000001'), 'good', 'paying all overdue contributions restores good standing');

-- ---------------------------------------------------------------------
-- Collector savings, return, commission, maturity
-- ---------------------------------------------------------------------
insert into collector_accounts (id, collector_id, business_name, default_commission_type, default_commission_value)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'Dayo Daily Contributions', 'percentage', 300);
insert into collector_savers (id, collector_account_id, collector_id, saver_id, frequency, start_date, end_date, commission_type, commission_value)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d',
        '00000000-0000-0000-0000-00000000000e', 'daily', current_date - 5, current_date + 25, 'percentage', 300);

insert into payment_attempts (reference, user_id, purpose, target_id, amount)
values ('T-SAVE-1', '00000000-0000-0000-0000-00000000000e', 'collector_savings', '30000000-0000-0000-0000-000000000001', 3000000);
select confirm_payment('T-SAVE-1', 3000000, 'NGN', 'bank_transfer', 'Approved', now(), 'webhook');
select is((select balance from collector_savers where id = '30000000-0000-0000-0000-000000000001'), 3000000::bigint, 'flexible saving updates the balance');

select is((request_collector_return('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'School fees')) ->> 'commission_amount',
          '90000', '3% commission computed server-side');
select throws_like($$ select approve_collector_return((select id from collector_returns limit 1), '00000000-0000-0000-0000-00000000000e', 'manual', false) $$,
                   '%FORBIDDEN%', 'a saver cannot approve their own return');
select lives_ok($$ select approve_collector_return((select id from collector_returns limit 1), '00000000-0000-0000-0000-00000000000d', 'manual', false) $$,
                'collector approves the return');

insert into payment_attempts (reference, user_id, purpose, target_id, amount)
values ('T-SAVE-2', '00000000-0000-0000-0000-00000000000e', 'collector_savings', '30000000-0000-0000-0000-000000000001', 500000);
select is((confirm_payment('T-SAVE-2', 500000, 'NGN', 'card', 'Approved', now(), 'webhook')) ->> 'outcome', 'duplicate',
          'savings arriving while a return is processing are refunded, not added');

select complete_collector_return((select id from collector_returns limit 1), 'BANK-RT-1', null);
select is((select balance from collector_savers where id = '30000000-0000-0000-0000-000000000001'), 0::bigint, 'balance is zero after return');
select is((select amount from transactions where type = 'saver_return'), 2910000::bigint, 'saver receives balance minus commission');

insert into collector_savers (id, collector_account_id, collector_id, saver_id, frequency, start_date, end_date, commission_type, commission_value)
values ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d',
        '00000000-0000-0000-0000-00000000000e', 'weekly', current_date - 60, current_date, 'fixed', 100000);
select mature_collector_plans();
select is((select status from collector_savers where id = '30000000-0000-0000-0000-000000000002'), 'matured', 'plans mature on their end date');

-- ---------------------------------------------------------------------
-- Ledger immutability
-- ---------------------------------------------------------------------
select throws_like($$ update transactions set amount = 1 where provider_reference = 'T-REF-B1' $$, '%LEDGER_IMMUTABLE%', 'ledger amounts cannot be edited');
select throws_like($$ delete from transactions where provider_reference = 'T-REF-B1' $$, '%DELETE_FORBIDDEN%', 'ledger rows cannot be deleted');
select throws_like($$ delete from audit_logs $$, '%AUDIT_IMMUTABLE%', 'audit logs are append-only');

select * from finish();
rollback;
