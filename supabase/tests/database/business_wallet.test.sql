-- =====================================================================
-- ACHIEVER database tests: business wallet (platform revenue only), company payout
-- account, business withdrawals, finance overview.
-- Run with:  supabase test db   (everything is rolled back)
-- =====================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email) values
  ('60000000-0000-0000-0000-0000000000c1', 'biz.customer@test.ng'),
  ('60000000-0000-0000-0000-0000000000f1', 'biz.fin1@test.ng'),
  ('60000000-0000-0000-0000-0000000000f2', 'biz.fin2@test.ng');
select create_profile_with_roles('60000000-0000-0000-0000-0000000000c1', 'Cee Customer', 'biz.customer@test.ng', '+2348090000001', 'osusu', array['OSUSU_MEMBER']);
select create_profile_with_roles('60000000-0000-0000-0000-0000000000f1', 'Fin One', 'biz.fin1@test.ng', '+2348090000002', 'personal', array['OSUSU_MEMBER']);
select create_profile_with_roles('60000000-0000-0000-0000-0000000000f2', 'Fin Two', 'biz.fin2@test.ng', '+2348090000003', 'personal', array['OSUSU_MEMBER']);
create temp table bw as select ensure_wallet('60000000-0000-0000-0000-0000000000c1') as cw;

-- Start from known balances: a customer holds ₦50,000; ACHIEVER earned ₦1,000 in fees.
create temp table base as select
  (select balance from wallet_accounts where kind = 'fees') as fees0,
  (select balance from wallet_accounts where kind = 'payout_clearing') as clear0,
  (select balance from wallet_accounts where kind = 'paystack_clearing') as ps0;
select _wallet_post(_wallet_tx('topup', 5000000, '60000000-0000-0000-0000-0000000000c1', 'test top-up'), jsonb_build_array(
  jsonb_build_object('account', _system_account('paystack_clearing'), 'direction', 'debit', 'amount', 5000000),
  jsonb_build_object('account', (select cw from bw), 'direction', 'credit', 'amount', 5000000)));
select _wallet_post(_wallet_tx('fee', 100000, null, 'test fee revenue'), jsonb_build_array(
  jsonb_build_object('account', _system_account('paystack_clearing'), 'direction', 'debit', 'amount', 100000),
  jsonb_build_object('account', _system_account('fees'), 'direction', 'credit', 'amount', 100000)));
create function pg_temp.fees_now() returns bigint language sql as $$ select balance - (select fees0 from base) from wallet_accounts where kind = 'fees' $$;

-- Finance overview separates customer money from revenue
select ok((finance_overview() #>> '{customer,balance}')::bigint >= 5000000, 'customer wallet balances are reported as customer funds');
select is((finance_overview() #>> '{business,available}')::bigint, (select balance from wallet_accounts where kind = 'fees'), 'business available = fee revenue only');

-- No company payout account yet
select throws_like($$ select business_withdrawal_request('60000000-0000-0000-0000-0000000000f1', 50000, 'Monthly revenue withdrawal') $$, '%NO_PAYOUT_ACCOUNT%', 'no withdrawal without an approved company account');

-- Company payout account: proposed by one admin, approved by another, then a cooling-off period
insert into business_bank_accounts (id, bank_code, bank_name, account_number, account_name, reason, added_by)
values ('61000000-0000-0000-0000-000000000001', '058', 'Guaranty Trust Bank', '0123456789', 'ACHIEVER TECHNOLOGIES LTD', 'Company operating account', '60000000-0000-0000-0000-0000000000f1');
select throws_like($$ select business_bank_account_decide('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-0000000000f1', true) $$, '%SELF_APPROVAL_FORBIDDEN%', 'the proposer cannot approve the payout account');
select is((business_bank_account_decide('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-0000000000f2', true) ->> 'status'), 'active', 'a second admin approves the payout account');
select throws_like($$ select business_withdrawal_request('60000000-0000-0000-0000-0000000000f1', 50000, 'Monthly revenue withdrawal') $$, '%COOLING_OFF%', 'a new payout account cannot be used during cooling-off');
update business_bank_accounts set active_from = now() - interval '1 minute' where id = '61000000-0000-0000-0000-000000000001';
update app_settings set value = '10000' where key = 'business.withdrawal_min_kobo';   -- ₦100 minimum for these tests

-- Customer money is never withdrawable as revenue
select throws_like($$ select business_withdrawal_request('60000000-0000-0000-0000-0000000000f1', (select balance + 100 from wallet_accounts where kind = 'fees'), 'Try to take more than revenue') $$,
  '%INSUFFICIENT_REVENUE%', 'cannot withdraw more than fee revenue, even though customers hold ₦50,000');
select throws_like($$ select business_withdrawal_request('60000000-0000-0000-0000-0000000000f1', 500, 'Tiny withdrawal attempt') $$, '%AMOUNT_TOO_LOW%', 'minimum enforced');

-- Small withdrawal (below the second-approval threshold): booked at once, revenue → payout clearing
create temp table w1 as select (business_withdrawal_request('60000000-0000-0000-0000-0000000000f1', 100000, 'Monthly revenue withdrawal', 'idem-1') ->> 'id')::uuid as id;
select is((select status from business_withdrawals where id = (select id from w1)), 'PENDING', 'below the threshold: sent without a second approval');
select is(pg_temp.fees_now(), 0::bigint, 'fee revenue reduced by the withdrawal');
select is((select balance - (select clear0 from base) from wallet_accounts where kind = 'payout_clearing'), 100000::bigint, 'the amount waits in payout clearing until the bank confirms');
select is((business_withdrawal_request('60000000-0000-0000-0000-0000000000f1', 100000, 'Monthly revenue withdrawal', 'idem-1') ->> 'id')::uuid, (select id from w1), 'the same request again returns the same withdrawal');
select is((select count(*)::int from business_withdrawals), 1, 'no duplicate withdrawal was created');
select throws_like($$ select business_withdrawal_request('60000000-0000-0000-0000-0000000000f1', 100000, 'Second withdrawal attempt') $$, '%INSUFFICIENT_REVENUE%', 'revenue already withdrawn cannot be withdrawn again');

-- The bank fails it: the amount returns to revenue; a second failure changes nothing
select is((business_withdrawal_fail((select id from w1), 'FAILED', 'Account closed') ->> 'outcome'), 'failed', 'failure recorded');
select is(pg_temp.fees_now(), 100000::bigint, 'failed withdrawal returned to fee revenue');
select is((business_withdrawal_fail((select id from w1), 'FAILED', 'Account closed') ->> 'outcome'), 'already_final', 'a duplicate failure event is ignored');
select is(pg_temp.fees_now(), 100000::bigint, '…and does not return the money twice');

-- Large withdrawal: a different admin must approve; the amount is reserved meanwhile
update app_settings set value = '50000' where key = 'business.withdrawal_dual_approval_kobo';
create temp table w2 as select (business_withdrawal_request('60000000-0000-0000-0000-0000000000f1', 80000, 'Quarterly revenue withdrawal') ->> 'id')::uuid as id;
select is((select status from business_withdrawals where id = (select id from w2)), 'PENDING_APPROVAL', 'above the threshold: waits for a second admin');
select is(business_available(), (select balance - 80000 from wallet_accounts where kind = 'fees'), 'the amount is reserved while awaiting approval');
select throws_like($$ select business_withdrawal_decide((select id from w2), '60000000-0000-0000-0000-0000000000f1', true, 'self') $$, '%SELF_APPROVAL_FORBIDDEN%', 'the requester cannot approve their own withdrawal');
select throws_like($$ update business_bank_accounts set status = 'pending_approval' where false; select business_bank_account_decide(
  (select id from business_bank_accounts where status = 'active'), '60000000-0000-0000-0000-0000000000f2', true) $$, '%ALREADY_DECIDED%', 'an approved account cannot be decided again');
select is((business_withdrawal_decide((select id from w2), '60000000-0000-0000-0000-0000000000f2', true, 'Checked against the revenue report') ->> 'status'), 'PENDING', 'a second admin approves; it is booked and sent');
select is(pg_temp.fees_now(), 20000::bigint, 'approved withdrawal deducted from fee revenue');

-- The bank confirms; later the bank reverses it
select is((business_withdrawal_complete((select id from w2)) ->> 'outcome'), 'success', 'provider confirmation completes it');
select is((select balance - (select clear0 from base) from wallet_accounts where kind = 'payout_clearing'), 0::bigint, 'payout clearing is settled');
select is((select balance - (select ps0 from base) from wallet_accounts where kind = 'paystack_clearing'), -5100000 + 80000::bigint, 'the cash left ACHIEVER''s provider balance');
select is((business_withdrawal_fail((select id from w2), 'REVERSED', 'Returned by the bank') ->> 'outcome'), 'reversed', 'a reversal after success is recorded as a new entry');
select is(pg_temp.fees_now(), 100000::bigint, 'reversed withdrawal is back in fee revenue');

-- Every business-withdrawal ledger transaction balances
select is((select count(*)::int from (
  select e.transaction_id from wallet_ledger_entries e join wallet_transactions t on t.id = e.transaction_id
   where t.type = 'business_withdrawal' group by e.transaction_id
  having sum(case when e.direction = 'debit' then e.amount else -e.amount end) <> 0) x), 0, 'every business withdrawal posting balances');

-- Members cannot read business tables
set local role authenticated;
select throws_like($$ select count(*) from business_withdrawals $$, '%permission denied%', 'members cannot read business withdrawals');
reset role;

select * from finish();
rollback;
