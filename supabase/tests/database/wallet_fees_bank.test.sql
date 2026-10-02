-- =====================================================================
-- ACHIEVER database tests: wallet account numbers, fee engine, bank transfers.
-- Run with:  supabase test db   (everything is rolled back)
-- =====================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(66);

insert into auth.users (id, email) values
  ('50000000-0000-0000-0000-0000000000a1', 'fee.one@test.ng'),
  ('50000000-0000-0000-0000-0000000000a2', 'fee.two@test.ng'),
  ('50000000-0000-0000-0000-0000000000f1', 'fee.admin1@test.ng'),
  ('50000000-0000-0000-0000-0000000000f2', 'fee.admin2@test.ng');
select create_profile_with_roles('50000000-0000-0000-0000-0000000000a1', 'Femi One', 'fee.one@test.ng', '+2348070000001', 'osusu', array['OSUSU_MEMBER']);
select create_profile_with_roles('50000000-0000-0000-0000-0000000000a2', 'Funmi Two', 'fee.two@test.ng', '+2348070000002', 'osusu', array['OSUSU_MEMBER']);
select create_profile_with_roles('50000000-0000-0000-0000-0000000000f1', 'Finance One', 'fee.admin1@test.ng', '+2348070000003', 'personal', array['OSUSU_MEMBER']);
select create_profile_with_roles('50000000-0000-0000-0000-0000000000f2', 'Finance Two', 'fee.admin2@test.ng', '+2348070000004', 'personal', array['OSUSU_MEMBER']);
update profiles set account_status = 'active', email_verified_at = now() where id::text like '50000000-%';

create temp table fw as select
  ensure_wallet('50000000-0000-0000-0000-0000000000a1') as w1,
  ensure_wallet('50000000-0000-0000-0000-0000000000a2') as w2;

-- ---------------------------------------------------------------------
-- Wallet account numbers
-- ---------------------------------------------------------------------
select ok((select wallet_code from wallet_accounts where id = (select w1 from fw)) ~ '^ACH[23456789A-HJ-NP-Z]{16}$', 'account number: ACH + 16 characters, no 0/O/1/I');
select ok((select bool_and(substr(c, 4) ~ '[2-9]' and substr(c, 4) ~ '[A-Z]') from (select _wallet_code() c from generate_series(1, 200)) g), 'every number has both digits and letters');
select is((select count(distinct c)::int from (select _wallet_code() c from generate_series(1, 500)) g), 500, 'numbers are random and do not repeat');
select throws_like($$ update wallet_accounts set wallet_code = 'ACH23456789ABCDEFGH' where id = (select w1 from fw) $$, '%WALLET_NUMBER_PERMANENT%', 'an account number is permanent');
select throws_like($$ insert into wallet_accounts (kind, user_id, wallet_code) values ('user', '50000000-0000-0000-0000-0000000000f1', 'ACHW-ABCD2345') $$, '%check%', 'the old short format is no longer issued');
insert into wallet_account_aliases (code, wallet_id) values ('ACHW-LEGACY23', (select w2 from fw));
select is(resolve_wallet_code('achw-legacy23'), (select w2 from fw), 'an old wallet ID still finds the same wallet');
select is(resolve_wallet_code((select wallet_code from wallet_accounts where id = (select w1 from fw))), (select w1 from fw), 'the new number finds the wallet');
select is(resolve_wallet_code('ACH23456789ABCDEFGH'), null::uuid, 'unknown numbers find nothing');

-- ---------------------------------------------------------------------
-- Fee calculator
-- ---------------------------------------------------------------------
insert into fee_configurations (service, version, fee_type, percentage, minimum_fee, maximum_fee, status, effective_from, reason, approved_at)
values ('referral_payout', 2, 'PERCENTAGE', 0.5, 5000, 50000, 'APPROVED', now(), 'test: 0.5% min 50 max 500', now());
select is((fee_quote('referral_payout', 500000) ->> 'fee')::bigint, 5000::bigint, 'percentage below the minimum fee: minimum applies (₦5,000 → ₦50)');
select is((fee_quote('referral_payout', 10000000) ->> 'fee')::bigint, 50000::bigint, 'percentage above the cap: capped (₦100,000 → ₦500)');
select is((fee_quote('referral_payout', 2000000) ->> 'fee')::bigint, 10000::bigint, 'percentage in range (₦20,000 × 0.5% = ₦100)');

insert into fee_configurations (service, version, fee_type, tiers, status, effective_from, reason, approved_at)
values ('osusu_payout', 2, 'TIERED', '[{"min":0,"max":1000000,"fixed":5000},{"min":1000001,"max":5000000,"fixed":10000},{"min":5000001,"max":null,"fixed":15000}]',
        'APPROVED', now(), 'test tiers', now());
select is((fee_quote('osusu_payout', 1000000) ->> 'fee')::bigint, 5000::bigint, 'tier 1 (up to ₦10,000) → ₦50');
select is((fee_quote('osusu_payout', 1000001) ->> 'fee')::bigint, 10000::bigint, 'tier 2 (₦10,000.01–₦50,000) → ₦100');
select is((fee_quote('osusu_payout', 9000000) ->> 'fee')::bigint, 15000::bigint, 'tier 3 (above ₦50,000) → ₦150');

insert into fee_configurations (service, version, fee_type, fixed_amount, percentage, fee_bearing_mode, minimum_transaction_amount, maximum_transaction_amount,
                                status, effective_from, reason, approved_at)
values ('wallet_topup', 2, 'FIXED_PLUS_PERCENTAGE', 5000, 1, 'FEE_INCLUDED', 10000, 100000000, 'APPROVED', now(), 'test: ₦50 + 1% included', now());
select is(fee_quote('wallet_topup', 1000000) - 'fee_configuration_id' - 'fee_code' - 'rule' - 'service' - 'enabled' - 'fee_version',
  '{"amount": 1000000, "fee": 15000, "fee_type": "FIXED_PLUS_PERCENTAGE", "fee_bearing_mode": "FEE_INCLUDED", "total_debit": 1000000, "recipient_amount": 985000}'::jsonb,
  'fixed + percentage, fee included: ₦10,000 → fee ₦150, ₦9,850 credited');
select throws_like($$ select fee_quote('wallet_topup', 5000) $$, '%AMOUNT_TOO_LOW%', 'minimum transaction amount enforced');
select throws_like($$ select fee_quote('wallet_topup', 200000000) $$, '%AMOUNT_TOO_HIGH%', 'maximum transaction amount enforced');
select throws_like($$ select fee_quote('bank_transfer', -100) $$, '%INVALID_AMOUNT%', 'negative amounts are refused');
select throws_like($$ insert into fee_configurations (service, version, fee_type, fee_bearing_mode, status, reason) values ('bill_data', 9, 'FIXED', 'FEE_INCLUDED', 'APPROVED', 'not allowed') $$,
  '%check%', 'fee-included is not allowed where the provider must receive the full amount (bills)');
select is((fee_quote('bank_transfer', 5000000) ->> 'total_debit')::bigint, 5010000::bigint, 'bank transfer starts at ₦100 added on top');

-- ---------------------------------------------------------------------
-- Versioning and two-person approval
-- ---------------------------------------------------------------------
create temp table prop as select * from propose_fee_configuration('50000000-0000-0000-0000-0000000000f1',
  '{"service":"bank_transfer","fee_type":"FIXED","fixed_amount":20000,"fee_bearing_mode":"FEE_ADDED","reason":"Updated operating cost"}');
select is((select status from prop), 'PENDING_APPROVAL', 'a fee change starts as a proposal');
select is((fee_quote('bank_transfer', 5000000) ->> 'fee')::bigint, 10000::bigint, 'a proposal does not change the fee in force');
select throws_like($$ select propose_fee_configuration('50000000-0000-0000-0000-0000000000f2', '{"service":"bank_transfer","fee_type":"FIXED","fixed_amount":1,"reason":"second proposal"}') $$,
  '%FEE_PENDING%', 'one pending change per service');
select throws_like($$ select decide_fee_configuration((select id from prop), '50000000-0000-0000-0000-0000000000f1', true, 'approving my own') $$,
  '%SECOND_APPROVER_REQUIRED%', 'the proposer cannot approve their own fee change');
select throws_like($$ update fee_configurations set fixed_amount = 1 where id = (select id from prop) $$, '%FEE_IMMUTABLE%', 'a proposal cannot be edited in place');
select lives_ok($$ select decide_fee_configuration((select id from prop), '50000000-0000-0000-0000-0000000000f2', true, 'Checked against provider costs') $$, 'a second administrator approves');
select is((fee_quote('bank_transfer', 5000000) ->> 'fee')::bigint, 20000::bigint, 'the approved version is in force');
select is((fee_quote('bank_transfer', 5000000) ->> 'fee_version')::int, 2, 'quotes carry the fee version');
select throws_like($$ update fee_configurations set fixed_amount = 1 where service = 'bank_transfer' and version = 1 $$, '%FEE_IMMUTABLE%', 'approved versions are history and cannot change');
select throws_like($$ delete from fee_configurations where service = 'bank_transfer' $$, '%FEE_IMMUTABLE%', 'fee history cannot be deleted');

-- Scheduled change: approved now, effective tomorrow
create temp table sched as select * from propose_fee_configuration('50000000-0000-0000-0000-0000000000f1',
  jsonb_build_object('service','wallet_transfer','fee_type','FIXED','fixed_amount',5000,'reason','Scheduled internal fee','effective_from', now() + interval '1 day'));
select decide_fee_configuration((select id from sched), '50000000-0000-0000-0000-0000000000f2', true, 'Approved for tomorrow');
select is((fee_quote('wallet_transfer', 100000) ->> 'fee')::bigint, 0::bigint, 'a scheduled fee does not apply before its start');
select is((fee_quote('wallet_transfer', 100000, now() + interval '2 days') ->> 'fee')::bigint, 5000::bigint, 'and applies from its start date');

-- ---------------------------------------------------------------------
-- Fund wallet 1 (Paystack top-up, fee included: ₦50 + 1%)
-- ---------------------------------------------------------------------
insert into wallet_topups (id, user_id, wallet_id, amount, fee, credit_amount, status)
values ('51000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', (select w1 from fw), 10000000, 0, 10000000, 'PENDING');
select is((select credit_amount from wallet_topups where id = '51000000-0000-0000-0000-000000000001'), 9895000::bigint, 'top-up fee is decided by the database, not the inserted row');
insert into payment_attempts (reference, user_id, purpose, target_id, amount)
values ('PSK-FEE-TOP-1', '50000000-0000-0000-0000-0000000000a1', 'wallet_topup', '51000000-0000-0000-0000-000000000001', 10000000);
select is(confirm_payment('PSK-FEE-TOP-1', 10000000, 'NGN', 'card', 'Approved', now(), 'webhook') ->> 'outcome', 'applied', 'top-up applied');
select is((select balance from wallet_accounts where id = (select w1 from fw)), 9895000::bigint, 'wallet credited after the fee (₦98,950)');

-- ---------------------------------------------------------------------
-- Bank transfers (fee ₦200 added, version 2)
-- ---------------------------------------------------------------------
insert into wallet_bank_transfers (id, reference, user_id, wallet_id, bank_code, bank_name, account_number, account_name, amount, fee, total_debit, recipient_amount, fee_snapshot, status)
values ('52000000-0000-0000-0000-000000000001', 'ACH-WBT-T1', '50000000-0000-0000-0000-0000000000a1', (select w1 from fw), '058', 'GTBank', '0123456789', 'FEMI ONE',
        5000000, 0, 5000000, 5000000, '{}', 'SUCCESS');
select is((select row(fee, total_debit, recipient_amount, status)::text from wallet_bank_transfers where id = '52000000-0000-0000-0000-000000000001'),
  row(20000::bigint, 5020000::bigint, 5000000::bigint, 'INITIATED')::text, 'fee, totals and status from the server, whatever the client sent');
select is((select fee_snapshot ->> 'fee_version' from wallet_bank_transfers where id = '52000000-0000-0000-0000-000000000001'), '2', 'fee snapshot saved on the transfer');
select throws_like($$ select wallet_bank_transfer_debit('52000000-0000-0000-0000-000000000001') $$, '%TRANSFER_NOT_AUTHORISED%', 'no debit without approval');
update wallet_bank_transfers set authorized_at = now(), auth_method = 'pin' where id = '52000000-0000-0000-0000-000000000001';
select throws_like($$ update wallet_bank_transfers set amount = 1 where id = '52000000-0000-0000-0000-000000000001' $$, '%BANK_TRANSFER_IMMUTABLE%', 'amount cannot change after review');
select throws_like($$ update wallet_bank_transfers set account_number = '9999999999' where id = '52000000-0000-0000-0000-000000000001' $$, '%BANK_TRANSFER_IMMUTABLE%', 'recipient cannot change after review');
select throws_like($$ update wallet_bank_transfers set status = 'SUCCESS' where id = '52000000-0000-0000-0000-000000000001' $$, '%BANK_TRANSFER_STATUS%', 'cannot jump to SUCCESS without being sent');
select is(wallet_bank_transfer_debit('52000000-0000-0000-0000-000000000001') ->> 'outcome', 'debited', 'authorised transfer debits the wallet');
select is((select balance from wallet_accounts where id = (select w1 from fw)), 4875000::bigint, 'amount + fee debited (₦98,950 − ₦50,200)');
select is(wallet_bank_transfer_debit('52000000-0000-0000-0000-000000000001') ->> 'outcome', 'already_debited', 'a retried debit does nothing');
select is((select balance from wallet_accounts where id = (select w1 from fw)), 4875000::bigint, 'no double debit');

-- Double spend: two transfers that together exceed the balance
insert into wallet_bank_transfers (id, reference, user_id, wallet_id, bank_code, bank_name, account_number, account_name, amount, total_debit, recipient_amount, fee_snapshot, authorized_at)
values ('52000000-0000-0000-0000-000000000002', 'ACH-WBT-T2', '50000000-0000-0000-0000-0000000000a1', (select w1 from fw), '058', 'GTBank', '0123456789', 'FEMI ONE', 3000000, 1, 1, '{}', now()),
       ('52000000-0000-0000-0000-000000000003', 'ACH-WBT-T3', '50000000-0000-0000-0000-0000000000a1', (select w1 from fw), '058', 'GTBank', '0123456789', 'FEMI ONE', 3000000, 1, 1, '{}', now());
select is(wallet_bank_transfer_debit('52000000-0000-0000-0000-000000000002') ->> 'outcome', 'debited', 'first of two competing transfers succeeds');
select throws_like($$ select wallet_bank_transfer_debit('52000000-0000-0000-0000-000000000003') $$, '%INSUFFICIENT_FUNDS%', 'the second cannot spend the same money');
select ok((select balance from wallet_accounts where id = (select w1 from fw)) >= 0, 'the wallet never goes negative');

-- Provider outcomes
select wallet_bank_transfer_processing('52000000-0000-0000-0000-000000000001', 'TRF_abc', 'pending');
select is((select status from wallet_bank_transfers where id = '52000000-0000-0000-0000-000000000001'), 'PROCESSING', 'sent to the provider: PROCESSING (not success)');
select is(wallet_bank_transfer_complete('52000000-0000-0000-0000-000000000001', 'TRF_abc', 2500, true) ->> 'outcome', 'success', 'provider confirmation marks SUCCESS');
select is(wallet_bank_transfer_complete('52000000-0000-0000-0000-000000000001', 'TRF_abc', 2500, true) ->> 'outcome', 'already_final', 'duplicate webhooks do nothing');
select is(wallet_bank_transfer_fail('52000000-0000-0000-0000-000000000002', 'FAILED', 'Account closed') ->> 'outcome', 'failed', 'provider failure');
select is((select balance from wallet_accounts where id = (select w1 from fw)), 4875000::bigint, 'failed transfer refunded in full, fee included');
select is(wallet_bank_transfer_fail('52000000-0000-0000-0000-000000000001', 'REVERSED', 'Returned by bank') ->> 'outcome', 'reversed', 'a completed transfer returned by the bank is reversed');
select is((select balance from wallet_accounts where id = (select w1 from fw)), 9895000::bigint, 'reversal returns amount and fee');
select is(wallet_bank_transfer_fail('52000000-0000-0000-0000-000000000001', 'REVERSED', 'again') ->> 'outcome', 'already_final', 'a reversal is applied once');

-- ---------------------------------------------------------------------
-- Internal transfer with a fee; historical fee snapshot survives a fee change
-- ---------------------------------------------------------------------
insert into fee_configurations (service, version, fee_type, fixed_amount, status, effective_from, reason, approved_at)
values ('wallet_transfer', 9, 'FIXED', 2500, 'APPROVED', now(), 'test internal fee ₦25', now());
insert into wallet_transfers (id, reference, sender_user_id, sender_wallet_id, recipient_wallet_id, amount, fee, authorized_at, auth_method)
values ('53000000-0000-0000-0000-000000000001', 'ACH-TRF-F1', '50000000-0000-0000-0000-0000000000a1', (select w1 from fw), (select w2 from fw), 100000, 0, now(), 'pin');
select is((select fee from wallet_transfers where id = '53000000-0000-0000-0000-000000000001'), 2500::bigint, 'internal transfer fee from the engine');
select is(wallet_execute_transfer('53000000-0000-0000-0000-000000000001') ->> 'outcome', 'success', 'internal transfer with fee');
select is((select balance from wallet_accounts where id = (select w2 from fw)), 100000::bigint, 'recipient receives the amount');
select is((select balance from wallet_accounts where id = (select w1 from fw)), 9792500::bigint, 'sender pays amount + fee');
insert into fee_configurations (service, version, fee_type, fixed_amount, status, effective_from, reason, approved_at)
values ('wallet_transfer', 10, 'FIXED', 9900, 'APPROVED', now(), 'later change', now());
select is((select (fee_snapshot ->> 'fee')::bigint from wallet_transfers where id = '53000000-0000-0000-0000-000000000001'), 2500::bigint, 'historical transfers keep their original fee');

-- ---------------------------------------------------------------------
-- Revenue and invariants
-- ---------------------------------------------------------------------
select is((fee_revenue_report() -> 'by_category' -> 'wallet_transfer' ->> 'collected')::bigint, 2500::bigint, 'internal transfer fees reported');
select is((fee_revenue_report() -> 'by_category' -> 'bank_transfer' ->> 'net')::bigint, 0::bigint, 'refunded bank transfer fees are not counted as revenue');
select ok((fee_revenue_report() -> 'by_category' -> 'wallet_topup' ->> 'collected')::bigint >= 105000, 'top-up fees reported');
select is((select coalesce(sum(case when direction = 'debit' then amount else -amount end), 0) from wallet_ledger_entries)::bigint, 0::bigint, 'ledger still balances');
select is((select count(*)::int from wallet_accounts a
            where a.balance <> coalesce((select sum(case when direction = 'credit' then amount else -amount end) from wallet_ledger_entries e where e.account_id = a.id), 0)),
          0, 'every balance equals its ledger');

select * from finish();
rollback;
