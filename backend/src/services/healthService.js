import { env } from '../config/env.js';
import { supabaseAdmin } from '../integrations/supabase/client.js';

/**
 * Readiness checks. Reports configuration problems by name only — never
 * secret values — so an operator can see why the API cannot serve requests.
 */
export async function checkDatabase() {
  try {
    const { error } = await supabaseAdmin.from('roles').select('code').limit(1);
    if (!error) return { ok: true };
    if (error.code === '42501') {
      return {
        ok: false,
        code: 'DATABASE_PRIVILEGES',
        detail: 'The Supabase service role has no privileges on ACHIEVER tables. Apply supabase/migrations/20260923000005_api_role_grants.sql.',
      };
    }
    if (error.code === '42P01' || /schema cache|does not exist/i.test(error.message)) {
      return { ok: false, code: 'DATABASE_SCHEMA_MISSING', detail: 'ACHIEVER tables were not found. Apply the migrations in supabase/migrations in order.' };
    }
    return { ok: false, code: 'DATABASE_ERROR', detail: `Database query failed (${error.code || 'unknown code'}).` };
  } catch {
    return { ok: false, code: 'DATABASE_UNREACHABLE', detail: 'Could not reach Supabase. Check SUPABASE_URL and network access.' };
  }
}

export async function readiness() {
  const database = await checkDatabase();
  return {
    ready: database.ok,
    checks: {
      database,
      payments: { ok: env.features.payments, detail: env.features.payments ? undefined : 'PAYSTACK_SECRET_KEY is not a Paystack secret key (expected sk_test_… or sk_live_…).' },
      email: { ok: env.features.email, detail: env.features.email ? undefined : 'RESEND_API_KEY is not set; emails are skipped.' },
      sms: { ok: env.features.sms, detail: env.features.sms ? undefined : 'TERMII_API_KEY / TERMII_SENDER_ID are not set; SMS is skipped.' },
      calls: { ok: env.features.calls, detail: env.features.calls ? undefined : 'LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not set; calling is disabled.' },
      bills: { ok: env.features.bills, detail: env.features.bills ? undefined : 'BILL_PROVIDER is disabled.' },
    },
  };
}
