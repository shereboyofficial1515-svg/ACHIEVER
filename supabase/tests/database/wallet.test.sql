-- =====================================================================
-- ACHIEVER database tests: internal wallet (double-entry ledger).
-- Run with:  supabase test db   (everything is rolled back)
-- =====================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

-- ---------------------------------------------------------------------
-- Fixtures: W1 (sender), W2 (recipient), W3 (no money), staff S1/S2
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('40000000-0000-0000-0000-0000000000a1', 'wallet.one@test.ng'),
  ('40000000-0000-0000-0000-0000000000a2', 'wallet.two@test.ng'),
  ('40000000-0000-0000-0000-0000000000a3', 'wallet.three@test.ng'),
  ('40000000-0000-0000-0000-0000000000f1', 'wallet.staff1@test.ng'),
  ('40000000-0000-0000-0000-0000000000f2', 'wallet.staff2@test.ng');
select create_profile_with_roles('40000000-0000-0000-0000-0000000000a1', 'Wale One',   'wallet.one@test.ng',    '+2348060000001', 'osusu', array['OSUSU_ADMIN','OSUSU_MEMBER']);
select create_profile_with_roles('40000000-0000-0000-0000-0000000000a2', 'Wunmi Two',  'wallet.two@test.ng',    '+2348060000002', 'osusu', array['OSUSU_MEMBER']);
select create_profile_with_roles('40000000-0000-0000-0000-0000000000a3', 'Wole Three', 'wallet.three@test.ng',  '+2348060000003', 'osusu', array['OSUSU_MEMBER']);
select create_profile_with_roles('40000000-0000-0000-0000-0000000000f1', 'Staff W1',   'wallet.staff1@test.ng', '+2348060000004', 'personal', array['OSUSU_MEMBER']);
select create_profile_with_roles('40000000-0000-0000-0000-0000000000f2', 'Staff W2',   'wallet.staff2@test.ng', '+2348060000005', 'personal', array['OSUSU_MEMBER']);
update profiles set account_status = 'active', email_verified_at = now() where id::text like '40000000-%';

create temp table wl as select
  ensure_wallet('40000000-0000-0000-0000-0000000000a1') as w1,
  ensure_wallet('40000000-0000-0000-0000-0000000000a2') as w2,
  ensure_wallet('40000000-0000-0000-0000-0000000000a3') as w3;
grant select on wl to authenticated;

-- ---------------------------------------------------------------------
-- Wallet accounts
-- ---------------------------------------------------------------------
select ok((select wallet_code from wallet_accounts where id = (select w1 from wl)) ~ '^ACH[23456789A-HJ-NP-Z]{16}$', 'wallet account number is ACH + 16 characters');
select is(ensure_wallet('40000000-0000-0000-0000-0000000000a1'), (select w1 from wl), 'one wallet per user (ensure_wallet is idempotent)');
select is((select count(*)::int from wallet_accounts where kind <> 'user'), 8, 'system accounts exist');
select is((select balance from wallet_accounts where id = (select w1 from wl)), 0::bigint, 'a new wallet starts at zero');

-- ---------------------------------------------------------------------
-- Top-up: credited only after confirmation, exactly once
-- ---------------------------------------------------------------------
insert into wallet_topups (id, user_id, wallet_id, amount, status)
values ('41000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', (select w1 from wl), 10000000, 'PENDING');
insert into payment_attempts (reference, user_id, purpose, target_id, amount)
values ('PSK-WTOP-1', '40000000-0000-0000-0000-0000000000a1', 'wallet_topup', '41000000-0000-0000-0000-000000000001', 10000000);
select is((select balance from wallet_accounts where id = (select w1 from wl)), 0::bigint, 'an initialised top-up does not credit the wallet');
select is(confirm_payment('PSK-WTOP-1', 10000000, 'NGN', 'card', 'Approved', now(), 'webhook') ->> 'outcome', 'applied', 'verified top-up is applied');
select is((select balance from wallet_accounts where id = (select w1 from wl)), 10000000::bigint, 'wallet credited with the top-up');
select is((select status from wallet_topups where id = '41000000-0000-0000-0000-000000000001'), 'SUCCESS', 'top-up marked SUCCESS');
select is(confirm_payment('PSK-WTOP-1', 10000000, 'NGN', 'card', 'Approved', now(), 'verify') ->> 'outcome', 'already_processed', 'webhook + verify replay is idempotent');
select is((select balance from wallet_accounts where id = (select w1 from wl)), 10000000::bigint, 'replay does not credit twice');
select is((select count(*)::int from wallet_transactions where payment_reference = 'PSK-WTOP-1'), 1, 'one wallet transaction per top-up');

-- Amount mismatch: nothing credited
insert into wallet_topups (id, user_id, wallet_id, amount, status)
values ('41000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-0000000000a1', (select w1 from wl), 500000, 'PENDING');
insert into payment_attempts (reference, user_id, purpose, target_id, amount)
values ('PSK-WTOP-2', '40000000-0000-0000-0000-0000000000a1', 'wallet_topup', '41000000-0000-0000-0000-000000000002', 500000);
select is(confirm_payment('PSK-WTOP-2', 100, 'NGN', 'card', 'Approved', now(), 'webhook') ->> 'outcome', 'amount_mismatch', 'mismatched amount is not credited');
select is((select balance from wallet_accounts where id = (select w1 from wl)), 10000000::bigint, 'balance unchanged after a mismatch');

-- Failed / abandoned
insert into wallet_topups (id, user_id, wallet_id, amount, status)
values ('41000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-0000000000a1', (select w1 from wl), 500000, 'PENDING');
insert into payment_attempts (reference, user_id, purpose, target_id, amount)
values ('PSK-WTOP-3', '40000000-0000-0000-0000-0000000000a1', 'wallet_topup', '41000000-0000-0000-0000-000000000003', 500000);
select ok(mark_payment_failed('PSK-WTOP-3', 'abandoned', 'Customer closed checkout'), 'abandoned checkout recorded');
select is((select status from wallet_topups where id = '41000000-0000-0000-0000-000000000003'), 'ABANDONED', 'top-up follows the payment status');

-- ---------------------------------------------------------------------
-- Ledger integrity and immutability
-- ---------------------------------------------------------------------
select throws_like($$ update wallet_ledger_entries set amount = 1 $$, '%', 'ledger entries cannot be edited');
select throws_like($$ delete from wallet_ledger_entries $$, '%', 'ledger entries cannot be deleted');
select throws_like($$ update wallet_transactions set amount = 1 where payment_reference = 'PSK-WTOP-1' $$, '%WALLET_IMMUTABLE%', 'wallet transactions cannot be altered');
select throws_like($$ delete from wallet_transactions where payment_reference = 'PSK-WTOP-1' $$, '%WALLET_IMMUTABLE%', 'wallet transactions cannot be deleted');
select throws_like($$ select _wallet_post(gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('account', (select w1 from wl), 'direction', 'debit', 'amount', 100),
    jsonb_build_object('account', (select w2 from wl), 'direction', 'credit', 'amount', 99))) $$,
  '%LEDGER_UNBALANCED%', 'unbalanced postings are refused');

-- ---------------------------------------------------------------------
-- Browser roles: read own, write nothing
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-0000000000a2"}';
select is((select count(*)::int from wallet_accounts), 1, 'a member sees only their own wallet');
select is((select count(*)::int from wallet_topups), 0, 'a member cannot see another member''s top-ups');
select throws_like($$ update wallet_accounts set balance = 99999999 $$, '%permission denied%', 'the browser cannot write a balance');
select throws_like($$ insert into wallet_ledger_entries (transaction_id, account_id, direction, amount, balance_after) values (gen_random_uuid(), gen_random_uuid(), 'credit', 1, 1) $$,
  '%permission denied%', 'the browser cannot write ledger entries');
select throws_like($$ select wallet_execute_transfer(gen_random_uuid()) $$, '%permission denied%', 'the browser cannot call money functions');
reset role;

-- ---------------------------------------------------------------------
-- Internal transfers
-- ---------------------------------------------------------------------
insert into wallet_transfers (id, reference, sender_user_id, sender_wallet_id, recipient_wallet_id, amount, note, idempotency_key)
values ('42000000-0000-0000-0000-000000000001', 'ACH-TRF-1', '40000000-0000-0000-0000-0000000000a1', (select w1 from wl), (select w2 from wl), 2500000, 'Lunch', 'trf-idem-0001');
select throws_like($$ select wallet_execute_transfer('42000000-0000-0000-0000-000000000001') $$, '%TRANSFER_NOT_AUTHORISED%', 'a transfer needs approval first');
update wallet_transfers set authorized_at = now(), auth_method = 'pin' where id = '42000000-0000-0000-0000-000000000001';
select is(wallet_execute_transfer('42000000-0000-0000-0000-000000000001') ->> 'outcome', 'success', 'authorised transfer succeeds');
select is((select balance from wallet_accounts where id = (select w1 from wl)), 7500000::bigint, 'sender debited');
select is((select balance from wallet_accounts where id = (select w2 from wl)), 2500000::bigint, 'recipient credited');
select is(wallet_execute_transfer('42000000-0000-0000-0000-000000000001') ->> 'outcome', 'already_done', 'retrying a completed transfer does nothing');
select is((select balance from wallet_accounts where id = (select w1 from wl)), 7500000::bigint, 'no double debit on retry');
select throws_like($$ insert into wallet_transfers (reference, sender_user_id, sender_wallet_id, recipient_wallet_id, amount, idempotency_key)
  values ('ACH-TRF-1B', '40000000-0000-0000-0000-0000000000a1', (select w1 from wl), (select w2 from wl), 100, 'trf-idem-0001') $$,
  '%duplicate key%', 'an idempotency key is used once only');
select throws_like($$ insert into wallet_transfers (reference, sender_user_id, sender_wallet_id, recipient_wallet_id, amount)
  values ('ACH-TRF-SELF', '40000000-0000-0000-0000-0000000000a1', (select w1 from wl), (select w1 from wl), 100) $$,
  '%check%', 'cannot transfer to your own wallet');

insert into wallet_transfers (id, reference, sender_user_id, sender_wallet_id, recipient_wallet_id, amount, authorized_at)
values ('42000000-0000-0000-0000-000000000002', 'ACH-TRF-2', '40000000-0000-0000-0000-0000000000a3', (select w3 from wl), (select w1 from wl), 100000, now());
select throws_like($$ select wallet_execute_transfer('42000000-0000-0000-0000-000000000002') $$, '%INSUFFICIENT_FUNDS%', 'cannot send more than the balance');
select is((select balance from wallet_accounts where id = (select w3 from wl)), 0::bigint, 'no negative balance after a refused transfer');

-- Large transfer: held, then reviewed by someone else
update app_settings set value = '5000000' where key = 'wallet.transfer_review_threshold_kobo';
insert into wallet_transfers (id, reference, sender_user_id, sender_wallet_id, recipient_wallet_id, amount, authorized_at)
values ('42000000-0000-0000-0000-000000000003', 'ACH-TRF-3', '40000000-0000-0000-0000-0000000000a1', (select w1 from wl), (select w2 from wl), 5000000, now());
select is(wallet_execute_transfer('42000000-0000-0000-0000-000000000003') ->> 'outcome', 'pending_review', 'a large transfer is held for review');
select is((select held from wallet_accounts where id = (select w1 from wl)), 5000000::bigint, 'the amount is held');
select throws_like($$ select _wallet_post(gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('account', (select w1 from wl), 'direction', 'debit', 'amount', 3000000),
    jsonb_build_object('account', (select w2 from wl), 'direction', 'credit', 'amount', 3000000))) $$,
  '%INSUFFICIENT_FUNDS%', 'held money cannot be spent twice');
select throws_like($$ select wallet_review_transfer('42000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-0000000000a1', true, 'approve myself') $$,
  '%SELF_REVIEW_FORBIDDEN%', 'the sender cannot approve their own transfer');
select is(wallet_review_transfer('42000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-0000000000f1', true, 'Verified with the member by phone') ->> 'outcome',
  'success', 'reviewer approves the transfer');
select is((select balance - held from wallet_accounts where id = (select w1 from wl)), 2500000::bigint, 'hold captured and released correctly');
update app_settings set value = '50000000' where key = 'wallet.transfer_review_threshold_kobo';

-- ---------------------------------------------------------------------
-- Bills paid from the wallet (refunds return to the wallet)
-- ---------------------------------------------------------------------
insert into fee_configurations (service, version, fee_type, fixed_amount, status, effective_from, reason, approved_at)
select 'bill_' || c, 100, 'FIXED', 0, 'APPROVED', now(), 'Wallet test: no bill fee', now() from unnest(array['airtime','data']) c;
insert into bill_payments (id, reference, user_id, category, service_id, service_name, customer_identifier, phone, amount, fee, status, provider,
                           provider_request_id, funding_source)
values ('43000000-0000-0000-0000-000000000001', 'ACH-BILL-W1', '40000000-0000-0000-0000-0000000000a2', 'airtime', 'mtn', 'MTN Airtime',
        '08011111111', '+2348011111111', 100000, 0, 'awaiting_authorization', 'vtpass', '202610011200wal1', 'wallet');
select throws_like($$ select wallet_pay_bill('43000000-0000-0000-0000-000000000001') $$, '%BILL_NOT_PAYABLE%', 'an unauthorised bill cannot be paid from the wallet');
update bill_payments set status = 'awaiting_payment', authorized_at = now(), auth_method = 'pin' where id = '43000000-0000-0000-0000-000000000001';
select is(wallet_pay_bill('43000000-0000-0000-0000-000000000001') ->> 'outcome', 'applied', 'bill paid from the wallet');
select is((select balance from wallet_accounts where id = (select w2 from wl)), 7400000::bigint, 'wallet debited for the bill');
select is((select provider from transactions where bill_payment_id = '43000000-0000-0000-0000-000000000001' and type = 'bill_payment'), 'internal', 'bill ledger row says ACHIEVER Wallet');
select is(wallet_pay_bill('43000000-0000-0000-0000-000000000001') ->> 'outcome', 'already_paid', 'paying a bill twice does nothing');
select is(record_bill_result('43000000-0000-0000-0000-000000000001', 'failed', null, null, null, 'Provider error', 300, 'api', null, '016') ->> 'outcome', 'failed', 'provider failure recorded');
select is((select status from bill_payments where id = '43000000-0000-0000-0000-000000000001'), 'refunded', 'wallet bill refunded immediately');
select is((select balance from wallet_accounts where id = (select w2 from wl)), 7500000::bigint, 'refund credited back to the wallet');

insert into bill_payments (id, reference, user_id, category, service_id, customer_identifier, phone, amount, fee, status, provider,
                           provider_request_id, funding_source, authorized_at)
values ('43000000-0000-0000-0000-000000000002', 'ACH-BILL-W2', '40000000-0000-0000-0000-0000000000a2', 'data', 'glo-data', '08051234567', '+2348051234567',
        50000, 0, 'awaiting_authorization', 'vtpass', '202610011200wal2', 'wallet', now());
update bill_payments set status = 'awaiting_payment' where id = '43000000-0000-0000-0000-000000000002';
select wallet_pay_bill('43000000-0000-0000-0000-000000000002');
select record_bill_result('43000000-0000-0000-0000-000000000002', 'delivered', 'VT-REF-W2', null, null, null, 300, 'api', 'VT-TX-W2', '000');
select is(record_bill_reversal('43000000-0000-0000-0000-000000000002', 'Reversed by provider') ->> 'outcome', 'reversed', 'provider reversal after delivery');
select is((select balance from wallet_accounts where id = (select w2 from wl)), 7500000::bigint, 'reversal credited back to the wallet');

-- ---------------------------------------------------------------------
-- OSUSU from the wallet, and automatic contributions (mandates)
-- ---------------------------------------------------------------------
insert into osusu_groups (id, name, admin_id, contribution_amount, frequency, max_members, start_date, join_code, grace_period_days)
values ('44000000-0000-0000-0000-000000000001', 'Wallet Circle', '40000000-0000-0000-0000-0000000000a1', 1000000, 'weekly', 3, current_date, 'WALLETGR', 1);
insert into osusu_members (group_id, user_id, status, is_admin, joined_at) values
  ('44000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', 'active', true,  now() - interval '3 minutes'),
  ('44000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a2', 'active', false, now() - interval '2 minutes'),
  ('44000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a3', 'active', false, now() - interval '1 minute');
select start_osusu_group('44000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1');

select is(wallet_pay_osusu_contribution('40000000-0000-0000-0000-0000000000a1',
  (select id from osusu_contributions where group_id = '44000000-0000-0000-0000-000000000001' and user_id = '40000000-0000-0000-0000-0000000000a1')) ->> 'outcome',
  'applied', 'OSUSU contribution paid from the wallet');
select is((select status from osusu_contributions where group_id = '44000000-0000-0000-0000-000000000001' and user_id = '40000000-0000-0000-0000-0000000000a1'), 'paid', 'contribution marked paid');
select is((select provider from transactions where group_id = '44000000-0000-0000-0000-000000000001' and user_id = '40000000-0000-0000-0000-0000000000a1'), 'internal', 'OSUSU ledger row is traceable to the wallet');
select is((select collected_amount from osusu_cycles where group_id = '44000000-0000-0000-0000-000000000001' and cycle_number = 1), 1000000::bigint, 'cycle collected amount updated');

insert into wallet_payment_mandates (id, user_id, source_wallet_id, destination_type, destination_id, amount, frequency, start_date, status, authorized_at, auth_method)
values ('45000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-0000000000a2', (select w2 from wl), 'osusu_group', '44000000-0000-0000-0000-000000000001', 1000000, 'per_cycle', current_date, 'ACTIVE', now(), 'pin'),
       ('45000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-0000000000a3', (select w3 from wl), 'osusu_group', '44000000-0000-0000-0000-000000000001', 1000000, 'per_cycle', current_date, 'ACTIVE', now(), 'pin');
select is(run_wallet_mandates(), '{"paid": 1, "insufficient": 1}'::jsonb, 'mandates pay when funded and record insufficient funds otherwise');
select is((select status from wallet_mandate_runs where mandate_id = '45000000-0000-0000-0000-000000000003'), 'INSUFFICIENT_FUNDS', 'insufficient funds is logged, never overdrawn');
select is((select balance from wallet_accounts where id = (select w3 from wl)), 0::bigint, 'no negative balance from auto-debit');
select is(run_wallet_mandates(), '{"paid": 0, "insufficient": 0}'::jsonb, 'no immediate retry (retry spacing respected)');
select throws_like($$ insert into wallet_payment_mandates (user_id, source_wallet_id, destination_type, destination_id, amount, frequency, start_date)
  values ('40000000-0000-0000-0000-0000000000a2', (select w2 from wl), 'osusu_group', '44000000-0000-0000-0000-000000000001', 1000000, 'weekly', current_date) $$,
  '%duplicate key%', 'one live mandate per group per member');

-- ---------------------------------------------------------------------
-- Adjustments (two people) and reversed top-ups
-- ---------------------------------------------------------------------
insert into wallet_adjustment_requests (id, wallet_id, direction, amount, reason, requested_by)
values ('46000000-0000-0000-0000-000000000001', (select w3 from wl), 'credit', 200000, 'Compensation for a failed purchase', '40000000-0000-0000-0000-0000000000f1');
select throws_like($$ select wallet_decide_adjustment('46000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000f1', true, 'approve own') $$,
  '%SECOND_APPROVER_REQUIRED%', 'the requester cannot approve their own adjustment');
select is(wallet_decide_adjustment('46000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000f2', true, 'Checked the bill record') ->> 'status', 'APPROVED', 'second administrator approves');
select is((select balance from wallet_accounts where id = (select w3 from wl)), 200000::bigint, 'adjustment posted through the ledger');

select is(wallet_reverse_topup('41000000-0000-0000-0000-000000000001', 'Chargeback') ->> 'outcome', 'reversed', 'a charged-back top-up is reversed');
select is((select status from wallet_accounts where id = (select w1 from wl)), 'frozen', 'a wallet left negative by a reversal is frozen for review');

-- ---------------------------------------------------------------------
-- Global invariants
-- ---------------------------------------------------------------------
select is((select coalesce(sum(case when direction = 'debit' then amount else -amount end), 0) from wallet_ledger_entries)::bigint, 0::bigint, 'ledger debits equal credits');
select is((select count(*)::int from wallet_accounts a
            where a.balance <> coalesce((select sum(case when direction = 'credit' then amount else -amount end) from wallet_ledger_entries e where e.account_id = a.id), 0)),
          0, 'every balance equals its ledger');

select * from finish();
rollback;
