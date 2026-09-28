-- =====================================================================
-- Admin platform: staff powers never via browser JWTs, admin identity
-- tables, account states, typed settings, phone-verification fallback
-- =====================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a901', 'adm.super@test.ng'),
  ('00000000-0000-0000-0000-00000000a902', 'adm.user@test.ng'),
  ('00000000-0000-0000-0000-00000000a903', 'adm.other@test.ng');
select create_profile_with_roles('00000000-0000-0000-0000-00000000a901', 'Adm Super', 'adm.super@test.ng', '+2348099000901', 'personal', array['OSUSU_MEMBER']);
select create_profile_with_roles('00000000-0000-0000-0000-00000000a902', 'Adm User', 'adm.user@test.ng', '+2348099000902', 'personal', array['OSUSU_MEMBER']);
select create_profile_with_roles('00000000-0000-0000-0000-00000000a903', 'Adm Other', 'adm.other@test.ng', '+2348099000903', 'personal', array['OSUSU_MEMBER']);
insert into user_roles (user_id, role_code) values ('00000000-0000-0000-0000-00000000a901', 'SUPER_ADMIN');

-- Role/permission model
select is((select count(*)::int from role_permissions where role_code = 'SUPPORT_ADMIN'
            and permission_code in ('kyc.review','kyc.documents.view','finance.ledger.read','admins.manage','settings.manage')),
          0, 'support admins have no KYC, finance, admin-management or settings powers');
select is((select count(*)::int from role_permissions where role_code in ('AUDITOR','READ_ONLY_ADMIN')
            and permission_code in ('users.manage_status','settings.manage','sms.configure','finance.payouts.execute',
                                    'finance.reversal.approve','kyc.review','admins.manage','security.events.manage')),
          0, 'auditors and read-only admins cannot change anything');
select is((select count(*)::int from role_permissions where role_code = 'SECURITY_ADMIN'
            and permission_code in ('finance.payouts.execute','finance.reversal.request','finance.reversal.approve')),
          0, 'security admins cannot move money');
select is((select count(*)::int from role_permissions where role_code = 'FINANCE_ADMIN'
            and permission_code in ('kyc.documents.view','kyc.biometrics.view','security.events.manage')),
          0, 'finance admins cannot open identity documents or manage security');
select is((select count(*)::int from permissions p where not exists
            (select 1 from role_permissions rp where rp.role_code = 'SUPER_ADMIN' and rp.permission_code = p.code)),
          0, 'super admin holds every permission');

-- Admin identity tables
insert into admin_accounts (user_id, created_by) values ('00000000-0000-0000-0000-00000000a901', null);
select throws_like($$ update admin_accounts set status = 'disabled' where user_id = '00000000-0000-0000-0000-00000000a901' $$,
  '%admin_accounts_check%', 'disabling an admin requires a time and reason');
insert into admin_mfa_factors (user_id, secret_ciphertext, confirmed_at) values ('00000000-0000-0000-0000-00000000a901', 'x', now());
select throws_like($$ insert into admin_mfa_factors (user_id, secret_ciphertext, confirmed_at) values ('00000000-0000-0000-0000-00000000a901', 'y', now()) $$,
  '%admin_mfa_one_active_idx%', 'only one active authenticator per admin');
select throws_like($$ insert into admin_login_challenges (user_id, token_hash, purpose, expires_at) values ('00000000-0000-0000-0000-00000000a901', 'h1', 'enroll', now()) $$,
  '%admin_login_challenges_check%', 'an enrolment challenge must carry the pending secret');
select throws_like($$ insert into admin_sessions (user_id, token_hash, mfa_method, expires_at, idle_minutes) values ('00000000-0000-0000-0000-00000000a901', 's1', 'password', now(), 30) $$,
  '%admin_sessions_mfa_method_check%', 'admin sessions always record a second factor');
select throws_like($$ insert into admin_accounts (user_id) values ('00000000-0000-0000-0000-000000000bad') $$,
  '%foreign key%', 'admin accounts belong to real profiles');

-- Account states
select lives_ok($$ update profiles set account_status = 'restricted' where id = '00000000-0000-0000-0000-00000000a902' $$,
  'restricted is a valid account state');
select lives_ok($$ update profiles set account_status = 'verification_required' where id = '00000000-0000-0000-0000-00000000a902' $$,
  'verification_required is a valid account state');
select throws_like($$ update profiles set account_status = 'banned' where id = '00000000-0000-0000-0000-00000000a902' $$,
  '%profiles_account_status_check%', 'unknown account states are rejected');
insert into account_status_history (user_id, previous_status, new_status, reason, actor_id)
values ('00000000-0000-0000-0000-00000000a902', 'active', 'restricted', 'Chargeback investigation', '00000000-0000-0000-0000-00000000a901');
select throws_like($$ delete from account_status_history $$, '%APPEND_ONLY%', 'status history cannot be deleted');
select throws_like($$ insert into account_status_history (user_id, previous_status, new_status, reason) values ('00000000-0000-0000-0000-00000000a902', 'active', 'suspended', 'no') $$,
  '%account_status_history_reason_check%', 'every status change needs a real reason');

-- Typed settings
select is((select value from app_settings where key = 'sms.verification_enabled'), 'false'::jsonb, 'SMS verification starts off');
select throws_like($$ update app_settings set value = '1' where key = 'sms.verification_enabled' $$,
  '%must be true or false%', 'boolean settings reject numbers');
select throws_like($$ update app_settings set value = '6' where key = 'auth.password_min_length' $$,
  '%must be between%', 'the password minimum cannot be weakened below 10');
select throws_like($$ update app_settings set value = '"automatic"' where key = 'payouts.execution_mode' $$,
  '%must be one of%', 'enum settings reject unknown values');
select throws_like($$ update app_settings set value = '12.5' where key = 'admin.session_max_hours' $$,
  '%whole number%', 'integer settings reject fractions');
select lives_ok($$ update app_settings set value = 'true' where key = 'sms.verification_enabled' $$, 'valid values are accepted');
insert into app_setting_changes (setting_key, previous_value, new_value, reason, actor_id)
values ('sms.verification_enabled', 'false', 'true', 'Termii restored', '00000000-0000-0000-0000-00000000a901');
select throws_like($$ update app_setting_changes set reason = 'edited' $$, '%APPEND_ONLY%', 'setting history is append-only');

-- Phone-verification fallback in KYC
update profiles set first_name = 'Adm', last_name = 'User', date_of_birth = '1990-01-01', state_code = 'LA',
       lga_id = (select id from ng_lgas where state_code = 'LA' limit 1), city = 'Ikeja',
       email_verified_at = now(), phone_verified_at = null
 where id = '00000000-0000-0000-0000-00000000a902';
select is((recompute_kyc('00000000-0000-0000-0000-00000000a902') ->> 'level')::int, 0, 'without phone verification or waiver: level 0');
update profiles set phone_verification_waived_at = now(), phone_verification_waiver = 'sms_disabled'
 where id = '00000000-0000-0000-0000-00000000a902';
select is((recompute_kyc('00000000-0000-0000-0000-00000000a902') ->> 'level')::int, 1, 'with the recorded SMS waiver: level 1');

-- Dashboard aggregates
select ok(admin_dashboard_metrics() ? 'users' and admin_dashboard_metrics() ? 'approvals_pending', 'dashboard metrics are aggregated in SQL');
select is((select status from provider_health where provider = 'termii'), 'not_configured', 'provider health starts unconfigured');

-- Browser tokens: staff powers and admin tables are out of reach
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a901","role":"authenticated"}';
select is(has_permission('users.read'), false, 'a super admin''s ordinary sign-in token carries no permissions');
select is((select count(*)::int from profiles where id <> '00000000-0000-0000-0000-00000000a901'), 0,
  'a super admin''s ordinary sign-in token cannot read other profiles');
select throws_ok($$ select count(*) from admin_sessions $$, '42501', null, 'browser roles cannot read admin sessions');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a902","role":"authenticated"}';
select is((select count(*)::int from account_status_history), 1, 'users can read their own status history');
reset role;

select * from finish();
rollback;
