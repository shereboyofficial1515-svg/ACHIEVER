-- =====================================================================
-- ACHIEVER — explicit privileges for the Supabase API roles
--
-- Newer Supabase projects do not automatically grant table privileges on
-- the public schema to service_role / authenticated / anon. Without these
-- grants every PostgREST query from the API fails with
-- "42501 permission denied for table …" (this broke registration).
--
-- This migration grants exactly what the architecture needs:
--   * service_role  — full DML (the backend; bypasses RLS by design)
--   * authenticated — SELECT only, still filtered by the RLS policies in
--                     20260923000003, with the same revocations re-applied
--   * anon          — nothing (no anonymous data access)
-- It is idempotent and safe to re-run.
-- =====================================================================

grant usage on schema public to service_role, authenticated, anon;

-- Backend (server-only key)
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;

-- Signed-in browser role: read-only, row-filtered by RLS
grant select on all tables in schema public to authenticated;
revoke all on public.otp_codes, public.payment_webhooks, public.job_locks from authenticated, anon;
grant update (full_name, address, date_of_birth) on public.profiles to authenticated;

-- Anonymous role: no table access at all
revoke all on all tables in schema public from anon;
