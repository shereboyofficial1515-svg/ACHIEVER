-- =====================================================================
-- ACHIEVER — fix referral-code generation on Supabase.
--
-- ensure_referral_code (migration 011) called pgcrypto's gen_random_bytes().
-- On Supabase pgcrypto lives in the "extensions" schema, which is not on the
-- function's search_path (public), so the call failed. This version uses the
-- built-in gen_random_uuid() (PostgreSQL core, always available) as its
-- randomness source. Codes keep the same format: ACH- + 6 characters from a
-- 32-letter alphabet without look-alike characters.
-- =====================================================================
create or replace function public.ensure_referral_code(p_user_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code  text;
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  bytes bytea;
  i int;
begin
  select code into v_code from referral_codes where user_id = p_user_id;
  if found then return v_code; end if;
  for attempt in 1..10 loop
    -- 16 random bytes from a version-4 UUID; the first 6 are fully random.
    bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := 'ACH-';
    for i in 0..5 loop
      v_code := v_code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    begin
      insert into referral_codes (code, user_id) values (v_code, p_user_id);
      return v_code;
    exception when unique_violation then
      select code into v_code from referral_codes where user_id = p_user_id;
      if found then return v_code; end if;   -- another request created it
    end;
  end loop;
  perform app_error(500, 'REFERRAL_CODE_FAILED', 'Could not create a referral code');
end $$;

revoke execute on function public.ensure_referral_code(uuid) from public, anon, authenticated;
grant execute on function public.ensure_referral_code(uuid) to service_role;
