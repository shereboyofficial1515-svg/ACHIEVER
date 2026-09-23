/**
 * Bootstrap platform staff. There is deliberately no API for creating the
 * first SUPER_ADMIN; run this once from a trusted machine:
 *
 *   npm run grant-role -- someone@example.com SUPER_ADMIN
 */
import { supabaseAdmin } from '../src/integrations/supabase/client.js';

const [email, role] = process.argv.slice(2);
const allowed = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN'];

if (!email || !allowed.includes(role)) {
  console.error(`Usage: npm run grant-role -- <email> <${allowed.join('|')}>`);
  process.exit(1);
}

const { data: profile, error } = await supabaseAdmin.from('profiles').select('id, full_name').eq('email', email.toLowerCase()).maybeSingle();
if (error || !profile) {
  console.error('No ACHIEVER profile found for that email. The user must register first.');
  process.exit(1);
}

const { error: insertError } = await supabaseAdmin.from('user_roles').upsert({ user_id: profile.id, role_code: role }, { onConflict: 'user_id,role_code' });
if (insertError) {
  console.error('Failed to grant role:', insertError.message);
  process.exit(1);
}
await supabaseAdmin.from('audit_logs').insert({
  actor_id: null,
  action: 'admin.role.bootstrap',
  resource_type: 'profile',
  resource_id: profile.id,
  metadata: { role, via: 'scripts/grantRole.js' },
});
console.log(`Granted ${role} to ${profile.full_name}.`);
