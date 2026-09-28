/**
 * Controlled setup of a Site Administration account. There is deliberately no
 * API, default account or seeded password for the first administrator; run
 * this from a trusted machine with the backend .env of the target environment:
 *
 *   npm run admin:create -- someone@yourdomain.com SUPER_ADMIN
 *   npm run admin:create -- ops@yourdomain.com FINANCE_ADMIN,AUDITOR
 *
 * The person must already have registered and verified their email in the
 * member app. They then sign in at the admin platform with that password and
 * must set up an authenticator app before anything else. Further
 * administrators are managed inside the admin platform (Administrators).
 */
import { supabaseAdmin } from '../src/integrations/supabase/client.js';
import { STAFF_ROLES } from '../src/config/constants.js';

const [email, roleArg] = process.argv.slice(2);
const roles = String(roleArg || '').split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);

if (!email || !roles.length || roles.some((r) => !STAFF_ROLES.includes(r))) {
  console.error(`Usage: npm run admin:create -- <email> <ROLE[,ROLE...]>\nRoles: ${STAFF_ROLES.join(', ')}`);
  process.exit(1);
}

const { data: profile, error } = await supabaseAdmin.from('profiles')
  .select('id, full_name, email_verified_at, account_status').eq('email', email.toLowerCase()).maybeSingle();
if (error || !profile) {
  console.error('No ACHIEVER account uses that email. The person must register in the member app first.');
  process.exit(1);
}
if (!profile.email_verified_at) {
  console.error('That account has not verified its email address yet.');
  process.exit(1);
}
if (['suspended', 'closed'].includes(profile.account_status)) {
  console.error('That account is not active.');
  process.exit(1);
}

const { data: existing } = await supabaseAdmin.from('admin_accounts').select('user_id, status').eq('user_id', profile.id).maybeSingle();
const accountResult = existing
  ? await supabaseAdmin.from('admin_accounts').update({ status: 'active', disabled_at: null, disabled_by: null, disabled_reason: null }).eq('user_id', profile.id)
  : await supabaseAdmin.from('admin_accounts').insert({ user_id: profile.id });
if (accountResult.error) {
  console.error('Could not create the administrator account:', accountResult.error.message);
  process.exit(1);
}
for (const role of roles) {
  const { error: roleError } = await supabaseAdmin.from('user_roles').upsert({ user_id: profile.id, role_code: role }, { onConflict: 'user_id,role_code' });
  if (roleError) {
    console.error(`Could not grant ${role}:`, roleError.message);
    process.exit(1);
  }
}
await supabaseAdmin.from('audit_logs').insert({
  actor_id: null,
  action: 'admin.admins.bootstrap',
  resource_type: 'admin_account',
  resource_id: profile.id,
  new_state: { status: 'active', roles },
  reason: 'Created with scripts/createAdmin.js from a trusted machine',
  metadata: { via: 'scripts/createAdmin.js' },
});
console.log(`${profile.full_name} is now an administrator (${roles.join(', ')}).`);
console.log('Next: sign in at the admin platform with the same email and password, then set up an authenticator app.');
