-- =====================================================================
-- ACHIEVER database tests: no privileged (SECURITY DEFINER) function can be
-- called directly by the browser roles (anon / authenticated). Money,
-- messaging and admin functions run only through the API (service_role).
-- Run with:  supabase test db   (everything is rolled back)
-- =====================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- (_tap*: a local pgTAP shim used when running these tests outside Supabase.)
-- Read-only helpers that row-level security policies need (they only check auth.uid()).
create temp table rls_helpers(name text);
insert into rls_helpers values ('has_role'), ('has_permission'), ('is_platform_staff'), ('is_group_member'), ('is_group_admin'),
  ('is_conversation_member'), ('is_plan_party'), ('shares_context_with'), ('lagos_today');

select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and left(p.proname, 4) <> '_tap' and has_function_privilege('anon', p.oid, 'execute')),
  null, 'anon (no session) cannot execute any SECURITY DEFINER function');

select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and left(p.proname, 4) <> '_tap' and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname not in (select name from rls_helpers)),
  null, 'signed-in users can execute only the read-only RLS helpers');

select ok(
  (select bool_and(has_function_privilege('service_role', p.oid, 'execute')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef),
  'the API (service_role) can execute every privileged function');

select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and left(p.proname, 4) <> '_tap'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  null, 'every SECURITY DEFINER function pins its search_path');

select * from finish();
rollback;
