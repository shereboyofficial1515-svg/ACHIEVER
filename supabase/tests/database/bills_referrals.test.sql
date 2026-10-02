-- =====================================================================
-- ACHIEVER database tests: bill transaction engine, referral programme.
-- Run with:  supabase test db   (everything is rolled back)
-- =====================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(72);

-- ---------------------------------------------------------------------
-- Fixtures: referrer R, admins A1/A2, seven referred users
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-0000000000a0', 'referrer@test.ng'),
  ('20000000-0000-0000-0000-0000000000f1', 'staff.one@test.ng'),
  ('20000000-0000-0000-0000-0000000000f2', 'staff.two@test.ng'),
  ('20000000-0000-0000-0000-0000000000b1', 'ref.one@test.ng'),
  ('20000000-0000-0000-0000-0000000000b2', 'ref.two@test.ng'),
  ('20000000-0000-0000-0000-0000000000b3', 'ref.three@test.ng'),
  ('20000000-0000-0000-0000-0000000000b4', 'ref.four@test.ng'),
  ('20000000-0000-0000-0000-0000000000b5', 'ref.five@test.ng'),
  ('20000000-0000-0000-0000-0000000000b6', 'ref.six@test.ng'),
  ('20000000-0000-0000-0000-0000000000b7', 'ref.seven@test.ng'),
  ('20000000-0000-0000-0000-0000000000c1', 'r.e.f.e.r.r.e.r+alt@gmail.com'),
  ('20000000-0000-0000-0000-0000000000c2', 'referrer@gmail.com');

select create_profile_with_roles('20000000-0000-0000-0000-0000000000a0', 'Rita Referrer', 'referrer@test.ng', '+2348050000100', 'osusu', array['OSUSU_MEMBER']);
select create_profile_with_roles('20000000-0000-0000-0000-0000000000f1', 'Staff One', 'staff.one@test.ng', '+2348050000101', 'personal', array['OSUSU_MEMBER']);
select create_profile_with_roles('20000000-0000-0000-0000-0000000000f2', 'Staff Two', 'staff.two@test.ng', '+2348050000102', 'personal', array['OSUSU_MEMBER']);
select create_profile_with_roles(('20000000-0000-0000-0000-0000000000b' || n)::uuid, 'Referred ' || n, 'ref.' || n || '@x.ng',
                                 '+23480500002' || lpad(n::text, 2, '0'), 'osusu', array['OSUSU_MEMBER'])
  from generate_series(1, 7) n;
select create_profile_with_roles('20000000-0000-0000-0000-0000000000c2', 'Gmail Owner', 'referrer@gmail.com', '+2348050000301', 'osusu', array['OSUSU_MEMBER']);
select create_profile_with_roles('20000000-0000-0000-0000-0000000000c1', 'Gmail Alias', 'r.e.f.e.r.r.e.r+alt@gmail.com', '+2348050000302', 'osusu', array['OSUSU_MEMBER']);
update profiles set account_status = 'active', email_verified_at = now();

-- ---------------------------------------------------------------------
-- Referral codes and relationships
-- ---------------------------------------------------------------------
select ok(ensure_referral_code('20000000-0000-0000-0000-0000000000a0') ~ '^ACH-[23456789A-HJ-NP-Z]{6}$', 'referral code has the ACH-XXXXXX format');
select is(ensure_referral_code('20000000-0000-0000-0000-0000000000a0'),
          (select code from referral_codes where user_id = '20000000-0000-0000-0000-0000000000a0'), 'one stable code per user');
create temp table t_code as select code from referral_codes where user_id = '20000000-0000-0000-0000-0000000000a0';

select is(create_referral('20000000-0000-0000-0000-0000000000b1', 'ACH-ZZZZZZ') ->> 'outcome', 'invalid_code', 'an unknown code is refused');
select is(create_referral('20000000-0000-0000-0000-0000000000a0', (select code from t_code)) ->> 'outcome', 'self_referral', 'a user cannot refer themselves');
select is(create_referral(('20000000-0000-0000-0000-0000000000b' || n)::uuid, lower((select code from t_code))) ->> 'outcome', 'created',
          'valid referral ' || n || ' is created (code is case-insensitive)')
  from generate_series(1, 7) n;
select is(create_referral('20000000-0000-0000-0000-0000000000b1', (select code from t_code)) ->> 'outcome', 'already_referred', 'the referrer cannot be changed by using another code');
select is((select count(*)::int from referrals where referrer_id = '20000000-0000-0000-0000-0000000000a0'), 7, 'seven referral relationships recorded');

select ensure_referral_code('20000000-0000-0000-0000-0000000000c2');
select is(create_referral('20000000-0000-0000-0000-0000000000c1', (select code from referral_codes where user_id = '20000000-0000-0000-0000-0000000000c2')) ->> 'outcome',
          'created', 'alias-email account can register with the code…');
select is((select flag_status from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000c1'), 'SUSPICIOUS', '…but is held as SUSPICIOUS (same mailbox)');

select throws_like($$ update referrals set referrer_id = '20000000-0000-0000-0000-0000000000f1' where referred_user_id = '20000000-0000-0000-0000-0000000000b1' $$,
  '%REFERRAL_IMMUTABLE%', 'the referrer of an account cannot be changed');
select throws_like($$ delete from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000b1' $$,
  '%REFERRAL_IMMUTABLE%', 'referrals cannot be deleted');
select throws_like($$ update referral_events set reason = 'x' $$, '%APPEND_ONLY%', 'referral events are append-only');

-- ---------------------------------------------------------------------
-- Qualification engine
-- ---------------------------------------------------------------------
update profiles set email_verified_at = null where id = '20000000-0000-0000-0000-0000000000b1';
select is(evaluate_referral((select id from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000b1')), 'REGISTERED',
          'an unverified referred account does not progress');
update profiles set email_verified_at = now() where id = '20000000-0000-0000-0000-0000000000b1';

-- Verification level 1 for everyone referred.
insert into kyc_profiles (user_id, level, status) select id, 1, 'not_started' from profiles on conflict (user_id) do update set level = 1;
select is(evaluate_referral((select id from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000b1')), 'QUALIFYING',
          'verified but new: QUALIFYING');
select is((select status_reason from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000b1'), 'Waiting for Osusu membership',
          'the pending requirement is explained');

-- Osusu membership + a successful contribution for all seven.
insert into osusu_groups (id, name, admin_id, contribution_amount, frequency, max_members, start_date, join_code, grace_period_days)
values ('21000000-0000-0000-0000-000000000001', 'Referral Test Group', '20000000-0000-0000-0000-0000000000a0', 500000, 'weekly', 10, current_date, 'REFGRP01', 1);
insert into osusu_members (group_id, user_id, status) select '21000000-0000-0000-0000-000000000001', id, 'active'
  from profiles where id::text like '20000000-0000-0000-0000-0000000000b%';
select is(evaluate_referral((select id from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000b1')), 'QUALIFYING',
          'no qualifying activity yet: still QUALIFYING');
select is((select status_reason from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000b1'), 'Waiting for qualifying activity',
          'activity requirement is explained');
insert into transactions (reference, user_id, group_id, type, direction, amount, provider, status)
select 'TEST-REF-TX-' || right(id::text, 2), id, '21000000-0000-0000-0000-000000000001', 'osusu_contribution', 'debit', 500000, 'paystack', 'success'
  from profiles where id::text like '20000000-0000-0000-0000-0000000000b%';
select is(evaluate_referral((select id from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000b1')), 'QUALIFYING',
          'activity done but under 3 weeks: still QUALIFYING');

-- Three weeks pass (test-only: bypass the immutability guard to backdate).
alter table referrals disable trigger referrals_guard;
update referrals set created_at = now() - interval '22 days';
alter table referrals enable trigger referrals_guard;
update transactions set created_at = now() - interval '10 days' where reference like 'TEST-REF-TX-%';

update profiles set account_status = 'suspended' where id = '20000000-0000-0000-0000-0000000000b7';
select is(evaluate_referral((select id from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000b7')), 'QUALIFYING',
          'a suspended (not in good standing) referral does not qualify');

select is(evaluate_referral(id), 'QUALIFIED', 'referral qualifies after 3 weeks with activity')
  from referrals where referred_user_id in ('20000000-0000-0000-0000-0000000000b1','20000000-0000-0000-0000-0000000000b2',
    '20000000-0000-0000-0000-0000000000b3','20000000-0000-0000-0000-0000000000b4','20000000-0000-0000-0000-0000000000b5');
select is(evaluate_referrer_rewards('20000000-0000-0000-0000-0000000000a0'), 0, 'five qualified referrals: no reward');
select is((select count(*)::int from referral_rewards where referrer_id = '20000000-0000-0000-0000-0000000000a0'), 0, 'no reward row for five');

-- Sixth referral shares a device with the referrer: flagged, not counted until reviewed.
insert into user_devices (user_id, device_id_hash, label) values
  ('20000000-0000-0000-0000-0000000000a0', 'shared-hash', 'Phone'),
  ('20000000-0000-0000-0000-0000000000b6', 'shared-hash', 'Phone');
select is(evaluate_referral((select id from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000b6')), 'QUALIFIED',
          'sixth referral meets the requirements…');
select is((select flag_status from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000b6'), 'SUSPICIOUS',
          '…but a shared device holds it for review');
select is(evaluate_referrer_rewards('20000000-0000-0000-0000-0000000000a0'), 0, 'a flagged referral is not counted');

select throws_like($$ select decide_referral_flag((select id from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000b6'),
  '20000000-0000-0000-0000-0000000000f1', 'APPROVED', '') $$, '%REASON_REQUIRED%', 'flag decisions need a reason');
select lives_ok($$ select decide_referral_flag((select id from referrals where referred_user_id = '20000000-0000-0000-0000-0000000000b6'),
  '20000000-0000-0000-0000-0000000000f1', 'APPROVED', 'Family members sharing a phone, identity checked') $$, 'administrator clears the flag');
select is(evaluate_referrer_rewards('20000000-0000-0000-0000-0000000000a0'), 1, 'six qualified, cleared referrals create one reward');
select is((select status || ':' || amount from referral_rewards where referrer_id = '20000000-0000-0000-0000-0000000000a0'), 'ELIGIBLE:1500000',
          'reward is ELIGIBLE for ₦15,000');
select is((select count(*)::int from referrals where reward_id is not null), 6, 'exactly six referrals are attached to the reward');
select throws_like($$ update referrals set reward_id = null where reward_id is not null $$, '%REFERRAL_IMMUTABLE%',
  'a counted referral cannot be detached');

-- Reward lifecycle with two-person rule
create temp table t_rew as select id from referral_rewards where referrer_id = '20000000-0000-0000-0000-0000000000a0';
select throws_like($$ select transition_referral_reward((select id from t_rew), '20000000-0000-0000-0000-0000000000f1', 'mark_paid', 'Paying now', 'TRF-1') $$,
  '%INVALID_REWARD_TRANSITION%', 'a reward cannot be marked paid before approval');
select is(transition_referral_reward((select id from t_rew), '20000000-0000-0000-0000-0000000000f1', 'approve', 'All six referrals verified') ->> 'status',
          'APPROVED', 'administrator approves with a reason');
select throws_like($$ select transition_referral_reward((select id from t_rew), '20000000-0000-0000-0000-0000000000f1', 'mark_paid', 'Paid by transfer', 'TRF-1') $$,
  '%SECOND_APPROVER_REQUIRED%', 'the approver cannot also record the payment');
select throws_like($$ select transition_referral_reward((select id from t_rew), '20000000-0000-0000-0000-0000000000f2', 'mark_paid', 'Paid by transfer', '') $$,
  '%PAYMENT_REFERENCE_REQUIRED%', 'payment needs a reference');
select is(transition_referral_reward((select id from t_rew), '20000000-0000-0000-0000-0000000000f2', 'mark_paid', 'Paid by bank transfer', 'TRF-0001') ->> 'status',
          'PAID', 'a second administrator records the payment');
select is((select count(*)::int from notifications where user_id = '20000000-0000-0000-0000-0000000000a0' and type in ('referral_reward_approved','referral_reward_paid')),
          2, 'referrer is notified of approval and payment');
select ok((select bool_and(body not like '%@%') from notifications where category = 'referrals'), 'referral notifications reveal no personal details');

-- RLS: the referred user cannot see the referrer's reward; nobody can write
set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from referral_rewards), 0, 'a referred user cannot read the referrer''s rewards');
select is((select count(*)::int from referrals), 1, 'a referred user sees only their own referral row');
select throws_like($$ update referrals set status = 'QUALIFIED' $$, '%permission denied%', 'users cannot change qualification');
reset role;

-- ---------------------------------------------------------------------
-- Bill transaction engine
-- ---------------------------------------------------------------------
-- Fees come from the fee engine (admin-approved versions), never from the inserted row.
insert into fee_configurations (service, version, fee_type, fixed_amount, status, effective_from, reason, approved_at)
values ('bill_airtime', 2, 'FIXED', 5000, 'APPROVED', now(), 'Test fee for airtime', now()),
       ('bill_data', 2, 'FIXED', 1000, 'APPROVED', now(), 'Test fee for data', now());
insert into bill_payments (id, reference, user_id, category, service_id, service_name, customer_identifier, phone, amount, fee, status, provider,
                           provider_request_id, idempotency_key)
values ('22000000-0000-0000-0000-000000000001', 'ACH-BILL-T1', '20000000-0000-0000-0000-0000000000a0', 'airtime', 'mtn', 'MTN Airtime',
        '08011111111', '+2348011111111', 100000, 5000, 'awaiting_authorization', 'vtpass', '202609301200abc', 'idem-key-test-1');
select is((select total_amount from bill_payments where id = '22000000-0000-0000-0000-000000000001'), 105000::bigint, 'total = amount + fee');
select throws_like($$ update bill_payments set amount = 1 where id = '22000000-0000-0000-0000-000000000001' $$, '%BILL_IMMUTABLE%', 'bill amount cannot be edited');
select throws_like($$ update bill_payments set status = 'delivered' where id = '22000000-0000-0000-0000-000000000001' $$, '%BILL_STATUS_FINAL%',
  'status cannot jump to delivered');
select throws_like($$ insert into bill_payments (reference, user_id, category, service_id, customer_identifier, phone, amount, status, provider, provider_request_id)
  values ('ACH-BILL-T2', '20000000-0000-0000-0000-0000000000a0', 'airtime', 'mtn', '080', '+2348011111111', 100000, 'awaiting_authorization', 'vtpass', '202609301200abc') $$,
  '%duplicate key%', 'a VTpass request ID can be used once only');

update bill_payments set status = 'awaiting_payment', authorized_at = now(), auth_method = 'email_otp' where id = '22000000-0000-0000-0000-000000000001';
insert into payment_attempts (reference, user_id, purpose, target_id, amount)
values ('PSK-BILL-T1', '20000000-0000-0000-0000-0000000000a0', 'bill_payment', '22000000-0000-0000-0000-000000000001', 105000);
select is(confirm_payment('PSK-BILL-T1', 105000, 'NGN', 'card', 'Approved', now(), 'webhook') ->> 'outcome', 'applied', 'the total is charged and applied');
select is(record_bill_result('22000000-0000-0000-0000-000000000001', 'processing', null, null, null, 'pending', 60, 'api') ->> 'outcome', 'processing',
          'provider pending: PROCESSING, never success');
select is(record_bill_result('22000000-0000-0000-0000-000000000001', 'delivered', 'VT-123', 'enc:payload', null, null, 60, 'requery', 'VT-TX-1', '000') ->> 'outcome',
          'delivered', 'requery confirms delivery');
select is(record_bill_result('22000000-0000-0000-0000-000000000001', 'failed', null, null, null, 'late failure', 60, 'webhook') ->> 'outcome',
          'already_final', 'a completed transaction is never changed by a late message');
select ok((select body not like '%08011111111%' and body not like '%enc:%' from notifications where dedupe_key = 'bill_done:22000000-0000-0000-0000-000000000001'),
          'the success notification shows no phone number or token');
select is(record_bill_reversal('22000000-0000-0000-0000-000000000001', 'Reversed by network', 'webhook', '040') ->> 'outcome', 'reversed',
          'a provider reversal is recorded');
select is((select status from transactions where bill_payment_id = '22000000-0000-0000-0000-000000000001' and type = 'bill_payment'), 'reversed',
          'the ledger entry is reversed, not edited');
select is((select string_agg(to_status, '>' order by id) from bill_transaction_events where bill_id = '22000000-0000-0000-0000-000000000001'),
          'awaiting_authorization>awaiting_payment>paid>processing>delivered>reversed', 'full status history is kept');
select throws_like($$ delete from bill_payments where id = '22000000-0000-0000-0000-000000000001' $$, '%BILL_IMMUTABLE%', 'bills cannot be deleted');
select throws_like($$ delete from bill_transaction_events $$, '%APPEND_ONLY%', 'bill status history is append-only');

-- Provider controls (migration 013)
insert into bill_services (service_id, category, name) values ('mtn', 'airtime', 'MTN Airtime VTU') on conflict do nothing;
update bill_services set maintenance = true, maintenance_message = 'Upgrading' where service_id = 'mtn';
select is((select maintenance_message from bill_services where service_id = 'mtn'), 'Upgrading', 'a provider can be put into maintenance with a message');
select is((select last_success_at is not null from bill_service_stats() where service_id = 'mtn'), true, 'provider stats show the last successful purchase');
select is((select last_response_code from bill_service_stats() where service_id = 'mtn'), null::text, 'no provider response recorded yet for this test bill');
set local role authenticated;
select throws_like($$ select * from bill_service_stats() $$, '%permission denied%', 'members cannot read provider statistics');
reset role;

-- Revenue accounting (migration 014)
insert into bill_payments (id, reference, user_id, category, service_id, customer_identifier, phone, amount, fee, status, provider, provider_request_id)
values ('22000000-0000-0000-0000-000000000009', 'ACH-BILL-REV', '20000000-0000-0000-0000-0000000000a0', 'data', 'glo-sme-data', '08051234567', '+2348051234567',
        32000, 1000, 'awaiting_authorization', 'vtpass', '202610010900rev');
update bill_payments set status = 'awaiting_payment' where id = '22000000-0000-0000-0000-000000000009';
insert into payment_attempts (reference, user_id, purpose, target_id, amount) values ('PSK-REV', '20000000-0000-0000-0000-0000000000a0', 'bill_payment', '22000000-0000-0000-0000-000000000009', 33000);
select confirm_payment('PSK-REV', 33000, 'NGN', 'card', 'Approved', now(), 'webhook');
select record_bill_result('22000000-0000-0000-0000-000000000009', 'delivered', 'VT-REV', null, null, null, 60, 'api', 'VT-REV', '000');
update bill_payments set provider_cost = 31040, commission_amount = 960, commission_rate = 3.0 where id = '22000000-0000-0000-0000-000000000009';
select is((select net_revenue from bill_payments where id = '22000000-0000-0000-0000-000000000009'), 1960::bigint, 'net revenue = ACHIEVER fee + VTpass commission');
select is((bill_revenue_summary() ->> 'vtpass_commission')::bigint, 960::bigint, 'revenue summary totals VTpass commission');
select ok((bill_revenue_summary() ->> 'reversal_count')::int >= 1, 'revenue summary counts reversals separately');

select * from finish();
rollback;
