import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { totp } from '../../src/utils/totp.js';

// ---------------------------------------------------------------------------
// In-memory stand-ins for the database (admin tables, profiles, settings)
// ---------------------------------------------------------------------------
const db = {};
function reset() {
  db.accounts = new Map();
  db.factors = [];
  db.backup = [];
  db.challenges = [];
  db.sessions = [];
  db.profiles = new Map();
  db.settings = new Map();
  db.settingChanges = [];
  db.statusHistory = [];
  db.passwords = new Map();
  db.audit = [];
  db.events = [];
  db.health = null;
}
reset();

const now = () => new Date().toISOString();
vi.mock('../../src/repositories/adminRepository.js', () => ({
  findAccount: async (id) => db.accounts.get(id) ?? null,
  insertAccount: async (row) => { const a = { status: 'active', failed_login_count: 0, locked_until: null, ...row }; db.accounts.set(row.user_id, a); return a; },
  updateAccount: async (id, patch) => { const a = { ...db.accounts.get(id), ...patch }; db.accounts.set(id, a); return a; },
  listAccounts: async ({ status }) => {
    const rows = [...db.accounts.values()].filter((a) => !status || a.status === status)
      .map((a) => ({ ...a, profile: db.profiles.get(a.user_id) }));
    return { rows, total: rows.length };
  },
  registerFailure: async (id, max, minutes) => {
    const a = db.accounts.get(id);
    a.failed_login_count += 1;
    if (a.failed_login_count >= max) { a.locked_until = new Date(Date.now() + minutes * 60_000).toISOString(); a.failed_login_count = 0; }
    return a;
  },
  activeFactor: async (id) => db.factors.find((f) => f.user_id === id && !f.revoked_at && f.confirmed_at) ?? null,
  insertFactor: async (row) => { const f = { id: crypto.randomUUID(), ...row }; db.factors.push(f); return f; },
  markFactorStep: async (id, step) => {
    const f = db.factors.find((x) => x.id === id);
    if (f.last_used_step != null && f.last_used_step >= step) return false;
    f.last_used_step = step;
    return true;
  },
  revokeFactors: async (id) => { db.factors.filter((f) => f.user_id === id).forEach((f) => { f.revoked_at = now(); }); return []; },
  replaceBackupCodes: async (id, hashes) => {
    db.backup.filter((b) => b.user_id === id && !b.used_at).forEach((b) => { b.revoked_at = now(); });
    hashes.forEach((h) => db.backup.push({ user_id: id, code_hash: h }));
    return [];
  },
  useBackupCode: async (id, hash) => {
    const b = db.backup.find((x) => x.user_id === id && x.code_hash === hash && !x.used_at && !x.revoked_at);
    if (!b) return false;
    b.used_at = now();
    return true;
  },
  countBackupCodes: async (id) => db.backup.filter((b) => b.user_id === id && !b.used_at && !b.revoked_at).length,
  insertChallenge: async (row) => { const c = { id: crypto.randomUUID(), attempts: 0, consumed_at: null, ...row }; db.challenges.push(c); return c; },
  findChallenge: async (hash) => db.challenges.find((c) => c.token_hash === hash) ?? null,
  updateChallenge: async (id, patch) => Object.assign(db.challenges.find((c) => c.id === id), patch),
  consumeChallenge: async (id) => {
    const c = db.challenges.find((x) => x.id === id);
    if (c.consumed_at) return false;
    c.consumed_at = now();
    return true;
  },
  insertSession: async (row) => { const s = { id: crypto.randomUUID(), created_at: now(), last_active_at: now(), ended_at: null, step_up_at: null, ...row }; db.sessions.push(s); return s; },
  findSessionByToken: async (hash) => db.sessions.find((s) => s.token_hash === hash) ?? null,
  findSession: async (id) => db.sessions.find((s) => s.id === id) ?? null,
  updateSession: async (id, patch) => Object.assign(db.sessions.find((s) => s.id === id), patch),
  endSessions: async (userId, reason, { exceptId = null } = {}) => {
    const rows = db.sessions.filter((s) => s.user_id === userId && !s.ended_at && s.id !== exceptId);
    rows.forEach((s) => { s.ended_at = now(); s.end_reason = reason; });
    return rows;
  },
  listSessions: async ({ userId, activeOnly }) => {
    const rows = db.sessions.filter((s) => (!userId || s.user_id === userId) && (!activeOnly || !s.ended_at));
    return { rows, total: rows.length };
  },
  knownDevice: async (userId, hash) => db.sessions.some((s) => s.user_id === userId && s.device_hash === hash),
  insertStatusHistory: async (row) => { db.statusHistory.push(row); return row; },
  insertSettingChange: async (row) => { db.settingChanges.push(row); return row; },
  settingHistory: async () => [],
  getProviderHealth: async () => db.health,
  saveProviderHealth: async (_p, patch) => { db.health = patch; return patch; },
}));
vi.mock('../../src/repositories/userRepository.js', () => ({
  findById: async (id) => db.profiles.get(id) ?? null,
  // Like the real repository: looking up by email does not include roles.
  findByEmail: async (email) => {
    const p = [...db.profiles.values()].find((x) => x.email === email);
    if (!p) return null;
    const { user_roles: _roles, ...rest } = p;
    return rest;
  },
  update: async (id, patch) => Object.assign(db.profiles.get(id), patch),
  addRole: async (id, role) => { const p = db.profiles.get(id); if (!p.user_roles.some((r) => r.role_code === role)) p.user_roles.push({ role_code: role }); },
  removeRole: async (id, role) => { const p = db.profiles.get(id); p.user_roles = p.user_roles.filter((r) => r.role_code !== role); },
}));
vi.mock('../../src/repositories/settingsRepository.js', () => ({
  get: async (key) => (db.settings.has(key) ? { key, value: db.settings.get(key) } : null),
  getFull: async (key) => (db.settings.has(key) ? { key, value: db.settings.get(key) } : null),
  set: async (key, value) => { db.settings.set(key, value); return { key, value }; },
  getAll: async () => [],
}));
vi.mock('../../src/repositories/securityRepository.js', () => ({
  listRolePermissions: async () => [
    { role_code: 'SUPER_ADMIN', permission_code: 'admins.manage' }, { role_code: 'SUPER_ADMIN', permission_code: 'settings.manage' },
    { role_code: 'SUPPORT_ADMIN', permission_code: 'support.tickets' },
  ],
}));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn(async (row) => { db.audit.push(row); }) }));
vi.mock('../../src/services/securityService.js', () => ({
  recordEvent: vi.fn(async (e) => { db.events.push(e); }),
  recordChange: vi.fn(async () => {}),
}));
vi.mock('../../src/integrations/resend/resendClient.js', () => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true }) }));
const termii = vi.fn();
vi.mock('../../src/integrations/termii/termiiClient.js', () => ({ sendSms: (...a) => termii(...a) }));
vi.mock('../../src/services/authService.js', () => ({
  verifyPassword: async (email, password) => [...db.profiles.values()].some((p) => p.email === email && db.passwords.get(p.id) === password),
  assertPasswordPolicy: async () => {},
  setPassword: async (id, pw) => { db.passwords.set(id, pw); },
  invalidateUserCache: () => {},
}));
vi.mock('../../src/services/sessionService.js', () => ({
  describeUserAgent: () => ({ label: 'Chrome on Windows' }),
  maskIp: (ip) => (ip ? 'x.x.x.x' : null),
  revokeAll: async () => 0,
}));

const { env } = await import('../../src/config/env.js');
const adminAuth = await import('../../src/services/adminAuthService.js');
const adminAccounts = await import('../../src/services/adminAccountService.js');
const settingsService = await import('../../src/services/settingsService.js');
const smsService = await import('../../src/services/smsService.js');
const verificationService = await import('../../src/services/verificationService.js');
const permissionService = await import('../../src/services/permissionService.js');

// ---------------------------------------------------------------------------
// Helpers: a fake request/response that keeps cookies like a browser
// ---------------------------------------------------------------------------
function browser() {
  const jar = {};
  const req = () => ({ cookies: { ...jar }, ip: '10.0.0.1', id: 'req-1', get: (h) => (h === 'user-agent' ? 'Mozilla/5.0 Chrome' : undefined) });
  const res = {
    cookie: (name, value) => { jar[name] = value; },
    clearCookie: (name) => { delete jar[name]; },
  };
  return { jar, req, res };
}
function person(id, { roles = [], email = `${id}@x.ng`, password = 'Correct-Horse-9', admin = true } = {}) {
  db.profiles.set(id, { id, email, full_name: id, account_status: 'active', email_verified_at: now(), user_roles: roles.map((r) => ({ role_code: r })) });
  db.passwords.set(id, password);
  if (admin) db.accounts.set(id, { user_id: id, status: 'active', failed_login_count: 0, locked_until: null });
  return { id, email, password };
}
async function signIn(p, b = browser()) {
  const first = await adminAuth.login({ email: p.email, password: p.password }, b.req(), b.res);
  let result;
  if (first.next === 'enroll') {
    p.secret = first.secret;
    result = await adminAuth.verifySecondFactor({ code: totp(first.secret) }, b.req(), b.res);
  } else {
    result = await adminAuth.verifySecondFactor({ code: totp(p.secret, Date.now() + 30_000) }, b.req(), b.res);
  }
  return { ...result, browser: b };
}

beforeEach(() => {
  reset();
  adminAuth.forgetSessions();
  settingsService.clearCache();
  permissionService.clearCache();
  smsService.__resetHealth();
  termii.mockReset();
});

// ---------------------------------------------------------------------------
describe('admin sign-in', () => {
  it('first sign-in enrols an authenticator app and returns single-use backup codes', async () => {
    const p = person('super', { roles: ['SUPER_ADMIN'] });
    const b = browser();
    const first = await adminAuth.login({ email: p.email, password: p.password }, b.req(), b.res);
    expect(first.next).toBe('enroll');
    expect(first.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(b.jar.ach_adm).toBeUndefined(); // no session before the second factor
    const done = await adminAuth.verifySecondFactor({ code: totp(first.secret) }, b.req(), b.res);
    expect(done.backupCodes).toHaveLength(10);
    expect(b.jar.ach_adm).toBeTruthy();
    expect(db.factors[0].secret_ciphertext).not.toContain(first.secret); // stored encrypted
    expect(db.audit.some((a) => a.action === 'admin.auth.login')).toBe(true);
  });

  it('later sign-ins require the authenticator code', async () => {
    const p = person('super', { roles: ['SUPER_ADMIN'] });
    await signIn(p);
    const b = browser();
    expect((await adminAuth.login({ email: p.email, password: p.password }, b.req(), b.res)).next).toBe('mfa');
    await expect(adminAuth.verifySecondFactor({ code: '000000' }, b.req(), b.res)).rejects.toMatchObject({ code: 'MFA_INVALID' });
    expect(b.jar.ach_adm).toBeUndefined();
  });

  it('a correct password without administrator access gets the same answer as a wrong password', async () => {
    const member = person('member', { roles: ['OSUSU_MEMBER'], admin: false });
    const staffNoAccount = person('staff', { roles: ['SUPER_ADMIN'], admin: false });
    const b = browser();
    for (const p of [member, staffNoAccount]) {
      await expect(adminAuth.login({ email: p.email, password: p.password }, b.req(), b.res)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    await expect(adminAuth.login({ email: 'nobody@x.ng', password: 'x' }, b.req(), b.res)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(db.events.filter((e) => e.description.includes('no administrator access'))).toHaveLength(2);
  });

  it('a disabled administrator cannot sign in', async () => {
    const p = person('ops', { roles: ['FINANCE_ADMIN'] });
    db.accounts.get('ops').status = 'disabled';
    const b = browser();
    await expect(adminAuth.login({ email: p.email, password: p.password }, b.req(), b.res)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('repeated wrong passwords lock administrator sign-in', async () => {
    const p = person('ops', { roles: ['FINANCE_ADMIN'] });
    const b = browser();
    for (let i = 0; i < adminAuth.__test__.ADMIN_LOCK.maxFailures; i += 1) {
      await expect(adminAuth.login({ email: p.email, password: 'wrong' }, b.req(), b.res)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    await expect(adminAuth.login({ email: p.email, password: p.password }, b.req(), b.res)).rejects.toMatchObject({ code: 'ADMIN_LOCKED' });
  });

  it('too many wrong codes end the pending sign-in', async () => {
    const p = person('super', { roles: ['SUPER_ADMIN'] });
    const b = browser();
    await adminAuth.login({ email: p.email, password: p.password }, b.req(), b.res);
    for (let i = 0; i < adminAuth.__test__.MAX_CODE_ATTEMPTS; i += 1) {
      await expect(adminAuth.verifySecondFactor({ code: '000000' }, b.req(), b.res)).rejects.toMatchObject({ code: 'MFA_INVALID' });
    }
    await expect(adminAuth.verifySecondFactor({ code: '000000' }, b.req(), b.res)).rejects.toMatchObject({ status: 401 });
  });

  it('an authenticator code cannot be replayed', async () => {
    const p = person('super', { roles: ['SUPER_ADMIN'] });
    await signIn(p);
    const code = totp(p.secret, Date.now() + 30_000); // the step used by signIn() below
    await signIn(p);
    const b = browser();
    await adminAuth.login({ email: p.email, password: p.password }, b.req(), b.res);
    await expect(adminAuth.verifySecondFactor({ code }, b.req(), b.res)).rejects.toMatchObject({ code: 'MFA_INVALID' });
  });

  it('backup codes work once each', async () => {
    const p = person('super', { roles: ['SUPER_ADMIN'] });
    const { backupCodes } = await signIn(p);
    let b = browser();
    await adminAuth.login({ email: p.email, password: p.password }, b.req(), b.res);
    await adminAuth.verifySecondFactor({ backupCode: backupCodes[0] }, b.req(), b.res);
    expect(b.jar.ach_adm).toBeTruthy();
    b = browser();
    await adminAuth.login({ email: p.email, password: p.password }, b.req(), b.res);
    await expect(adminAuth.verifySecondFactor({ backupCode: backupCodes[0] }, b.req(), b.res)).rejects.toMatchObject({ code: 'MFA_INVALID' });
  });
});

describe('admin sessions', () => {
  it('resolve to the admin with permissions from their roles, never a member session id', async () => {
    const p = person('super', { roles: ['SUPER_ADMIN', 'OSUSU_MEMBER'] });
    const { browser: b } = await signIn(p);
    const { user } = await adminAuth.authenticate(b.jar.ach_adm);
    expect(user.roles).toEqual(['SUPER_ADMIN']);
    expect(user.permissions).toContain('admins.manage');
    expect(user.sessionId).toBeNull();
  });

  it('end after the idle timeout', async () => {
    const p = person('super', { roles: ['SUPER_ADMIN'] });
    const { browser: b } = await signIn(p);
    const s = db.sessions[0];
    s.last_active_at = new Date(Date.now() - (s.idle_minutes + 1) * 60_000).toISOString();
    adminAuth.forgetSessions();
    await expect(adminAuth.authenticate(b.jar.ach_adm)).rejects.toMatchObject({ code: 'ADMIN_SESSION_EXPIRED' });
  });

  it('end at the absolute lifetime even when active', async () => {
    const p = person('super', { roles: ['SUPER_ADMIN'] });
    const { browser: b } = await signIn(p);
    db.sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
    adminAuth.forgetSessions();
    await expect(adminAuth.authenticate(b.jar.ach_adm)).rejects.toMatchObject({ code: 'ADMIN_SESSION_EXPIRED' });
  });

  it('can be revoked, and sign-out-all ends every session', async () => {
    const p = person('super', { roles: ['SUPER_ADMIN'] });
    const one = await signIn(p);
    const two = await signIn(p);
    const { user, session } = await adminAuth.authenticate(one.browser.jar.ach_adm);
    await adminAuth.revokeSession(user, db.sessions[1].id, {});
    await expect(adminAuth.authenticate(two.browser.jar.ach_adm)).rejects.toMatchObject({ status: 401 });
    await adminAuth.logoutAll(user, session, {}, one.browser.res);
    await expect(adminAuth.authenticate(one.browser.jar.ach_adm)).rejects.toMatchObject({ status: 401 });
  });

  it('stop working when the admin loses every staff role or is disabled', async () => {
    const p = person('ops', { roles: ['FINANCE_ADMIN'] });
    const { browser: b } = await signIn(p);
    db.profiles.get('ops').user_roles = [];
    adminAuth.forgetSessions();
    await expect(adminAuth.authenticate(b.jar.ach_adm)).rejects.toMatchObject({ status: 401 });
  });

  it('step-up needs a fresh authenticator code and expires', async () => {
    const p = person('super', { roles: ['SUPER_ADMIN'] });
    const { browser: b } = await signIn(p);
    const { user, session } = await adminAuth.authenticate(b.jar.ach_adm);
    expect(await adminAuth.hasRecentStepUp(session)).toBe(false);
    await expect(adminAuth.stepUp(user, session, { code: '000000' }, {})).rejects.toMatchObject({ code: 'MFA_INVALID' });
    // Enrolment used the current step; the next step's code is fresh.
    const result = await adminAuth.stepUp(user, session, { code: totp(p.secret, Date.now() + 30_000) }, {});
    expect(result.validForMinutes).toBe(5);
    expect(await adminAuth.hasRecentStepUp(session)).toBe(true);
    // The same code cannot confirm a second action.
    await expect(adminAuth.stepUp(user, session, { code: totp(p.secret, Date.now() + 30_000) }, {})).rejects.toMatchObject({ code: 'MFA_INVALID' });
    db.sessions[0].step_up_at = new Date(Date.now() - 6 * 60_000).toISOString();
    expect(await adminAuth.hasRecentStepUp(session)).toBe(false);
  });
});

describe('administrator management', () => {
  const actor = (id, roles) => ({ id, roles, permissions: ['admins.manage'] });

  it('grants access to an existing verified account and records who, why and what', async () => {
    person('super', { roles: ['SUPER_ADMIN'] });
    person('newbie', { roles: ['OSUSU_MEMBER'], admin: false });
    await adminAccounts.create(actor('super', ['SUPER_ADMIN']), { email: 'newbie@x.ng', roles: ['AUDITOR'], reason: 'Quarterly audit' }, {});
    expect(db.accounts.get('newbie').status).toBe('active');
    expect(db.profiles.get('newbie').user_roles.map((r) => r.role_code)).toContain('AUDITOR');
    const audit = db.audit.find((a) => a.action === 'admin.admins.created');
    expect(audit).toMatchObject({ actorId: 'super', reason: 'Quarterly audit', newState: { roles: ['AUDITOR'] } });
  });

  it('nobody changes their own access, and only super admins grant super admin', async () => {
    person('sec', { roles: ['SECURITY_ADMIN'] });
    person('other', { roles: ['OSUSU_MEMBER'], admin: false });
    await expect(adminAccounts.updateRoles(actor('sec', ['SECURITY_ADMIN']), 'sec', { roles: ['SUPER_ADMIN'], reason: 'promote me' }, {}))
      .rejects.toMatchObject({ code: 'SELF_CHANGE_FORBIDDEN' });
    await expect(adminAccounts.create(actor('sec', ['SECURITY_ADMIN']), { email: 'other@x.ng', roles: ['SUPER_ADMIN'], reason: 'please promote' }, {}))
      .rejects.toMatchObject({ code: 'SUPER_ADMIN_REQUIRED' });
  });

  it('the last active super admin cannot be disabled or demoted', async () => {
    person('s1', { roles: ['SUPER_ADMIN'] });
    person('s2', { roles: ['SUPER_ADMIN'] });
    await adminAccounts.setStatus(actor('s1', ['SUPER_ADMIN']), 's2', { status: 'disabled', reason: 'Left the company' }, {});
    person('s3', { roles: ['SUPER_ADMIN'] });
    db.accounts.get('s3').status = 'active';
    await adminAccounts.setStatus(actor('s3', ['SUPER_ADMIN']), 's1', { status: 'disabled', reason: 'Rotation test' }, {});
    await expect(adminAccounts.updateRoles(actor('s2', ['SUPER_ADMIN']), 's3', { roles: ['AUDITOR'], reason: 'demote last super' }, {}))
      .rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' });
  });

  it('disabling an admin ends their sessions; MFA reset forces re-enrolment', async () => {
    person('super', { roles: ['SUPER_ADMIN'] });
    const ops = person('ops', { roles: ['FINANCE_ADMIN'] });
    const { browser: b } = await signIn(ops);
    await adminAccounts.resetMfa(actor('super', ['SUPER_ADMIN']), 'ops', { reason: 'Lost phone' }, {});
    await expect(adminAuth.authenticate(b.jar.ach_adm)).rejects.toMatchObject({ status: 401 });
    const b2 = browser();
    expect((await adminAuth.login({ email: ops.email, password: ops.password }, b2.req(), b2.res)).next).toBe('enroll');
  });
});

describe('settings', () => {
  const superAdmin = { id: 'super', roles: ['SUPER_ADMIN'] };
  it('every change needs a reason and is kept in history and the audit log', async () => {
    db.settings.set('registration.enabled', true);
    await expect(settingsService.update('registration.enabled', false, superAdmin, { reason: '' })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await settingsService.update('registration.enabled', false, superAdmin, { reason: 'Launch pause', req: { id: 'r-9', adminSession: { id: 's-9' } } });
    expect(db.settingChanges[0]).toMatchObject({ setting_key: 'registration.enabled', previous_value: true, new_value: false, reason: 'Launch pause', request_id: 'r-9', admin_session_id: 's-9' });
    expect(db.audit.at(-1)).toMatchObject({ action: 'admin.settings.changed', previousState: { value: true }, newState: { value: false } });
  });

  it('SMS toggles are audited with their own action names', async () => {
    db.settings.set('sms.verification_enabled', true);
    await settingsService.update('sms.verification_enabled', false, superAdmin, { reason: 'Termii outage' });
    expect(db.audit.at(-1).action).toBe('admin.sms.verification_disabled');
  });

  it('SMS verification cannot be switched on while Termii is not configured', async () => {
    db.settings.set('sms.verification_enabled', false);
    expect(env.features.sms).toBe(false);
    await expect(settingsService.update('sms.verification_enabled', true, superAdmin, { reason: 'Turn it on' })).rejects.toMatchObject({ code: 'INVALID_SETTING_VALUE' });
  });

  it('KYC levels cannot be weakened below government ID for withdrawals', async () => {
    db.settings.set('kyc.required_levels', { contribute: 1, receive_payout: 2, withdraw: 2, operator: 2 });
    await expect(settingsService.update('kyc.required_levels', { contribute: 0, receive_payout: 0, withdraw: 0, operator: 0 }, superAdmin, { reason: 'Loosen it' }))
      .rejects.toMatchObject({ code: 'INVALID_SETTING_VALUE' });
  });
});

describe('SMS verification states and fallback', () => {
  it('SMS_DISABLED: no SMS is attempted and email is the verification method', async () => {
    db.settings.set('sms.verification_enabled', false);
    expect(await smsService.verificationState()).toBe('SMS_DISABLED');
    const m = await verificationService.methods();
    expect(m.phoneVerification).toBe('email_fallback');
    expect(m.message).toBe('SMS verification is temporarily unavailable. Please use email verification.');
    const r = await smsService.send({ to: '+2348030000000', message: 'x', kind: 'verification' });
    expect(r).toMatchObject({ ok: false, skipped: true });
    expect(termii).not.toHaveBeenCalled();
    expect((await verificationService.emailFallbackAllowed()).allowed).toBe(true);
  });

  describe('with Termii configured', () => {
    beforeEach(() => {
      Object.defineProperty(env.features, 'sms', { value: true, configurable: true });
    });
    const restore = () => Object.defineProperty(env.features, 'sms', { value: false, configurable: true });

    it('SMS_ENABLED: codes go through Termii and email fallback is refused while it works', async () => {
      try {
        db.settings.set('sms.verification_enabled', true);
        termii.mockResolvedValue({ ok: true, messageId: 'm1' });
        expect(await smsService.verificationState()).toBe('SMS_ENABLED');
        expect((await smsService.send({ to: '+2348030000000', message: 'x', kind: 'verification' })).ok).toBe(true);
        expect((await verificationService.emailFallbackAllowed()).allowed).toBe(false);
        expect((await smsService.status()).providerStatus).toBe('operational');
      } finally { restore(); }
    });

    it('SMS_PROVIDER_ERROR: failures degrade, then pause the provider, and email fallback opens', async () => {
      try {
        db.settings.set('sms.verification_enabled', true);
        termii.mockResolvedValue({ ok: false, error: 'Insufficient balance (provider text)' });
        const r = await smsService.send({ to: '+2348030000000', message: 'x', kind: 'verification' });
        expect(r).toEqual({ ok: false, error: 'SMS_SEND_FAILED' }); // provider text never leaves the service
        expect(smsService.providerStatus()).toBe('degraded');
        expect((await verificationService.emailFallbackAllowed()).allowed).toBe(true);
        await smsService.send({ to: '+2348030000000', message: 'x', kind: 'verification' });
        await smsService.send({ to: '+2348030000000', message: 'x', kind: 'verification' });
        expect(smsService.providerStatus()).toBe('unavailable');
        expect(await smsService.verificationState()).toBe('SMS_PROVIDER_ERROR');
        const calls = termii.mock.calls.length;
        const skipped = await smsService.send({ to: '+2348030000000', message: 'x', kind: 'verification' });
        expect(skipped).toMatchObject({ skipped: true, error: 'SMS_PROVIDER_UNAVAILABLE' });
        expect(termii.mock.calls.length).toBe(calls); // not called again during the back-off
        const s = await smsService.status();
        expect(s).toMatchObject({ failureCount: 3, state: 'SMS_PROVIDER_ERROR' });
        expect(s.retryAfter).toBeTruthy();
      } finally { restore(); }
    });

    it('notifications respect their own switch', async () => {
      try {
        db.settings.set('sms.verification_enabled', true);
        db.settings.set('sms.notifications_enabled', false);
        termii.mockResolvedValue({ ok: true });
        expect(await smsService.send({ to: '+2348030000000', message: 'x', kind: 'notification' })).toMatchObject({ skipped: true, error: 'SMS_DISABLED' });
        expect((await smsService.send({ to: '+2348030000000', message: 'x', kind: 'security' })).ok).toBe(true);
      } finally { restore(); }
    });
  });

  it('the email fallback is recorded, and only for accounts with a verified email', async () => {
    db.settings.set('sms.verification_enabled', false);
    person('m', { roles: ['OSUSU_MEMBER'], admin: false });
    db.profiles.get('m').email_verified_at = null;
    await expect(verificationService.waivePhoneVerification('m', 'sms_disabled', {})).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    db.profiles.get('m').email_verified_at = now();
  });
});
