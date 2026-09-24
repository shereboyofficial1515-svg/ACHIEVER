-- =====================================================================
-- Identity, KYC, traceability and compliance rules (pgTAP)
-- =====================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'kyc.user@test.ng'),
  ('00000000-0000-0000-0000-0000000000c2', 'finance.one@test.ng'),
  ('00000000-0000-0000-0000-0000000000c3', 'finance.two@test.ng'),
  ('00000000-0000-0000-0000-0000000000c4', 'support.one@test.ng'),
  ('00000000-0000-0000-0000-0000000000c5', 'collector.x@test.ng');
select create_profile_with_roles('00000000-0000-0000-0000-0000000000c1', 'Kemi Adeyemi', 'kyc.user@test.ng', '+2348050000001', 'osusu', array['OSUSU_ADMIN','OSUSU_MEMBER']);
select create_profile_with_roles('00000000-0000-0000-0000-0000000000c2', 'Finance One', 'finance.one@test.ng', '+2348050000002', 'personal', array['SAVER']);
select create_profile_with_roles('00000000-0000-0000-0000-0000000000c3', 'Finance Two', 'finance.two@test.ng', '+2348050000003', 'personal', array['SAVER']);
select create_profile_with_roles('00000000-0000-0000-0000-0000000000c4', 'Support One', 'support.one@test.ng', '+2348050000004', 'personal', array['SAVER']);
select create_profile_with_roles('00000000-0000-0000-0000-0000000000c5', 'Collector X', 'collector.x@test.ng', '+2348050000005', 'collector', array['COLLECTOR']);
insert into user_roles (user_id, role_code) values
  ('00000000-0000-0000-0000-0000000000c2', 'FINANCE_ADMIN'),
  ('00000000-0000-0000-0000-0000000000c3', 'FINANCE_ADMIN'),
  ('00000000-0000-0000-0000-0000000000c4', 'SUPPORT_ADMIN');

-- ---------------------------------------------------------------- location
select throws_like($$ update profiles set state_code = 'LA', lga_id = (select id from ng_lgas where state_code = 'DE' limit 1)
                      where id = '00000000-0000-0000-0000-0000000000c1' $$,
                   '%INVALID_LGA%', 'an LGA from another state is rejected');
select is((select count(*)::int from ng_lgas), 774, 'all 774 LGAs are seeded');
select is(age_years((lagos_today() - interval '30 years')::date), 30, 'age is derived from date of birth');

-- --------------------------------------------------------------------- KYC
update profiles set email_verified_at = now(), phone_verified_at = now(), first_name = 'Kemi', last_name = 'Adeyemi',
       date_of_birth = '1990-05-01', state_code = 'DE', lga_id = (select id from ng_lgas where state_code = 'DE' and name = 'Warri South'),
       city = 'Warri'
 where id = '00000000-0000-0000-0000-0000000000c1';
select is((recompute_kyc('00000000-0000-0000-0000-0000000000c1')) ->> 'level', '1', 'verified contact + basic profile = KYC level 1');
select is((select status from kyc_profiles where user_id = '00000000-0000-0000-0000-0000000000c1'), 'not_started', 'no ID submitted yet');
insert into verification_records (user_id, id_type, id_number_hash, id_last4, provider, status, document_path)
values ('00000000-0000-0000-0000-0000000000c1', 'passport', 'hash-passport-1', 'A123', 'manual', 'manual_review', 'x/doc.png');
select is((recompute_kyc('00000000-0000-0000-0000-0000000000c1')) ->> 'status', 'in_review', 'uploaded passport is in review');
update verification_records set status = 'verified', verified_at = now(), expiry_date = lagos_today() + 365
 where user_id = '00000000-0000-0000-0000-0000000000c1';
select is((recompute_kyc('00000000-0000-0000-0000-0000000000c1')) ->> 'level', '2', 'verified government ID = level 2');
select is((select status from kyc_profiles where user_id = '00000000-0000-0000-0000-0000000000c1'), 'verified', 'KYC verified');
update verification_records set expiry_date = lagos_today() - 1 where user_id = '00000000-0000-0000-0000-0000000000c1';
select is((recompute_kyc('00000000-0000-0000-0000-0000000000c1')) ->> 'status', 'expired', 'expired document -> KYC expired');
select is((select level from kyc_profiles where user_id = '00000000-0000-0000-0000-0000000000c1'), 1, 'expired ID drops back to level 1');
select ok((select count(*) from kyc_events where user_id = '00000000-0000-0000-0000-0000000000c1') >= 4, 'every KYC change is recorded in kyc_events');
select throws_like($$ delete from kyc_events $$, '%APPEND_ONLY%', 'KYC history is append-only');
update verification_records set expiry_date = lagos_today() + 365 where user_id = '00000000-0000-0000-0000-0000000000c1';
select recompute_kyc('00000000-0000-0000-0000-0000000000c1');

-- ------------------------------------------------ append-only security data
insert into account_change_history (user_id, event_type, previous_ref, new_ref) values
  ('00000000-0000-0000-0000-0000000000c1', 'phone_changed', '+234803****001', '+234805****001');
select throws_like($$ update account_change_history set new_ref = 'tampered' $$, '%APPEND_ONLY%', 'account change history cannot be edited');
insert into security_events (user_id, event_type, severity, description)
values ('00000000-0000-0000-0000-0000000000c1', 'new_device', 'medium', 'Sign-in from a new device');
select lives_ok($$ update security_events set status = 'resolved', resolution = 'User confirmed' where event_type = 'new_device' $$,
                'investigation status of a security event can be updated');
select throws_like($$ update security_events set description = 'rewritten' $$, '%APPEND_ONLY%', 'the observation itself cannot be rewritten');
select throws_like($$ delete from security_events $$, '%APPEND_ONLY%', 'security events cannot be deleted');
insert into data_access_logs (actor_id, subject_user_id, resource_type, reason)
values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1', 'profile.address', 'Dispute investigation');
select throws_like($$ delete from data_access_logs $$, '%APPEND_ONLY%', 'data access log is append-only');

-- ------------------------------------------ payment trace & reversal (2-person)
insert into osusu_groups (id, name, admin_id, contribution_amount, frequency, max_members, start_date, join_code)
values ('60000000-0000-0000-0000-000000000001', 'Trace Group', '00000000-0000-0000-0000-0000000000c1', 100000, 'weekly', 2, current_date, 'TRACE001');
insert into osusu_members (group_id, user_id, status, joined_at) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'active', now() - interval '2 minutes'),
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', 'active', now() - interval '1 minute');
select start_osusu_group('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1');
insert into user_sessions (id, user_id, auth_method, ip_address) values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', 'password', '10.0.0.7');
insert into payment_attempts (reference, user_id, purpose, target_id, amount, session_id)
select 'TRACE-REF-1', '00000000-0000-0000-0000-0000000000c2', 'osusu_contribution', c.id, 100000, '70000000-0000-0000-0000-000000000001'
  from osusu_contributions c where c.group_id = '60000000-0000-0000-0000-000000000001' and c.user_id = '00000000-0000-0000-0000-0000000000c2';
select confirm_payment('TRACE-REF-1', 100000, 'NGN', 'bank_transfer', 'Approved', now(), 'webhook');
create temp table tx1 as select * from transactions where provider_reference = 'TRACE-REF-1';
select is((select session_id from tx1), '70000000-0000-0000-0000-000000000001'::uuid, 'ledger entry records the authenticated session that paid');
select is((select channel from tx1), 'bank_transfer', 'ledger entry records the payment channel');

insert into sensitive_action_requests (id, action, target_type, target_id, reason, requested_by, payload)
select '80000000-0000-0000-0000-000000000001', 'transaction_reversal', 'transaction', id,
       'Duplicate contribution confirmed by bank statement', '00000000-0000-0000-0000-0000000000c2', '{"refund": true}' from tx1;
select throws_like($$ select reverse_transaction((select id from tx1), '80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2') $$,
                   '%APPROVAL_REQUIRED%', 'a reversal cannot run without a second person''s approval');
select throws_like($$ update sensitive_action_requests set status = 'approved', decided_by = requested_by where id = '80000000-0000-0000-0000-000000000001' $$,
                   '%check constraint%', 'the requester cannot approve their own request');
update sensitive_action_requests set status = 'approved', decided_by = '00000000-0000-0000-0000-0000000000c3', decided_at = now()
 where id = '80000000-0000-0000-0000-000000000001';
select lives_ok($$ select reverse_transaction((select id from tx1), '80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c3') $$,
                'approved reversal executes');
select is((select status from transactions where id = (select id from tx1)), 'reversed', 'original entry is marked reversed, not deleted');
select is((select count(*)::int from transactions where related_transaction_id = (select id from tx1) and type = 'reversal'), 1,
          'a linked REVERSAL entry is created');
select is((select direction from transactions where related_transaction_id = (select id from tx1) and type = 'reversal'), 'credit',
          'reversal moves in the opposite direction');
select is((select amount from transactions where id = (select id from tx1)), 100000::bigint, 'original amount is preserved');
select is((select c.status from osusu_contributions c join tx1 on true where c.user_id = tx1.user_id and c.group_id = tx1.group_id and c.cycle_number = 1),
          'pending', 'contribution returns to pending after reversal');
select is((select collected_amount from osusu_cycles where group_id = '60000000-0000-0000-0000-000000000001' and cycle_number = 1),
          0::bigint, 'cycle total is reduced');
select is((select count(*)::int from transactions where type = 'refund' and metadata ->> 'reason' = 'reversal'), 1, 'refund queued when requested');
select throws_like($$ select reverse_transaction((select id from tx1), '80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c3') $$,
                   '%APPROVAL_REQUIRED%', 'an approval cannot be reused');
select throws_like($$ delete from transactions where id = (select id from tx1) $$, '%DELETE_FORBIDDEN%', 'ledger entries still cannot be deleted');

insert into sensitive_action_requests (id, action, target_type, target_id, reason, requested_by, status, decided_by, decided_at, payload)
select '80000000-0000-0000-0000-000000000002', 'transaction_adjustment', 'transaction', id, 'Bank fee absorbed by platform',
       '00000000-0000-0000-0000-0000000000c2', 'approved', '00000000-0000-0000-0000-0000000000c3', now(),
       jsonb_build_object('user_id', user_id, 'amount', 5000, 'direction', 'credit', 'related_transaction_id', id)
  from tx1;
select is((record_adjustment('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c3')) ? 'adjustment_transaction_id',
          true, 'approved adjustment creates a linked ADJUSTMENT entry');

-- -------------------------------------------- payout destination snapshot
insert into payout_accounts (user_id, bank_code, bank_name, account_name, account_last4)
values ('00000000-0000-0000-0000-0000000000c1', '058', 'Test Bank', 'KEMI ADEYEMI', '4321');
update osusu_payouts set status = 'approved', payout_reference = 'ACH-PO-TEST', execution_mode = 'manual'
 where group_id = '60000000-0000-0000-0000-000000000001' and cycle_number = 1;
select is((select destination_last4 from osusu_payouts where group_id = '60000000-0000-0000-0000-000000000001' and cycle_number = 1),
          '4321', 'approved payout snapshots the verified destination account');

-- -------------------------------------------------------- collector status
insert into collector_accounts (id, collector_id, business_name) values
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c5', 'Collector X Savings');
select is((select status from collector_accounts where id = '90000000-0000-0000-0000-000000000001'), 'pending_review',
          'new collector accounts start pending review');
select lives_ok($$ select set_collector_status('90000000-0000-0000-0000-000000000001', 'active', '00000000-0000-0000-0000-0000000000c2', 'All onboarding checks passed') $$,
                'compliance approves collector');
select ok((select approved_by is not null and approved_at is not null from collector_accounts where id = '90000000-0000-0000-0000-000000000001'),
          'approving administrator and time are recorded');
select throws_like($$ select set_collector_status('90000000-0000-0000-0000-000000000001', 'revoked', '00000000-0000-0000-0000-0000000000c2', 'Serious concerns', null) $$,
                   '%APPROVAL_NOT_FOUND%', 'revocation requires a two-person approval');
select lives_ok($$ select set_collector_status('90000000-0000-0000-0000-000000000001', 'suspended', '00000000-0000-0000-0000-0000000000c2', 'Pending investigation') $$,
                'collector can be suspended with a reason');
select is((select count(*)::int from collector_status_history where collector_account_id = '90000000-0000-0000-0000-000000000001'), 2,
          'every collector status change is in the history');

-- ------------------------------------------------------- disputes/evidence
insert into support_tickets (reference, user_id, category, subject, description)
values ('TKT-T1', '00000000-0000-0000-0000-0000000000c2', 'collector_settlement', 'Savings not returned', 'Collector has not returned matured savings.');
select ok((select case_number ~ '^CASE-[0-9]{4}-[0-9]{6}$' from support_tickets where reference = 'TKT-T1'), 'case receives a CASE-YYYY-NNNNNN number');
insert into dispute_evidence (case_id, evidence_type, source, linked_record_type, linked_record_id, uploaded_by)
select id, 'transaction_record', 'investigator', 'transaction', (select id::text from tx1), '00000000-0000-0000-0000-0000000000c2'
  from support_tickets where reference = 'TKT-T1';
select throws_like($$ delete from dispute_evidence $$, '%APPEND_ONLY%', 'evidence cannot be silently erased');
select throws_like($$ update dispute_evidence set description = 'replaced' $$, '%APPEND_ONLY%', 'evidence cannot be silently replaced');

-- ----------------------------------------------------------------- RLS
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}';
select is((select count(*)::int from transactions where user_id <> '00000000-0000-0000-0000-0000000000c4'), 0,
          'support admin cannot read other users'' ledger entries');
select is((select count(*)::int from security_events), 0, 'support admin cannot read security events');
select is((select count(*)::int from kyc_profiles where user_id <> '00000000-0000-0000-0000-0000000000c4'), 0,
          'support admin cannot read other users'' KYC');
select throws_ok($$ update kyc_profiles set status = 'verified' $$, '42501', null, 'users cannot change KYC status');
select throws_ok($$ update profiles set address = 'x', date_of_birth = '2000-01-01' where id = auth.uid() $$, '42501', null,
                 'users cannot directly change verification-relevant profile fields');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select ok((select count(*) from transactions where user_id <> '00000000-0000-0000-0000-0000000000c2') > 0,
          'finance admin can read the ledger');
select is((select count(*)::int from dispute_evidence), 0, 'finance admin cannot open dispute evidence');
reset role;

select * from finish();
rollback;
