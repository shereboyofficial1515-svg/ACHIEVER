import { createClient } from '@supabase/supabase-js';
import { env } from '../../config/env.js';

const baseAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/**
 * Service-role client: bypasses RLS. Used ONLY on the server, after the API
 * has authenticated and authorised the caller.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: baseAuth,
  db: { schema: 'public' },
  global: { headers: { 'x-application-name': 'achiever-api' } },
});

/**
 * A fresh anon client per auth operation so session state can never leak
 * between concurrent requests.
 */
export function createAuthClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: baseAuth });
}
