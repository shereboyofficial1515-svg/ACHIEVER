import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/supabase/client.js', () => ({
  supabaseAdmin: { auth: { getUser: vi.fn(), admin: { signOut: vi.fn() } } },
  createAuthClient: vi.fn(),
}));
vi.mock('../../src/repositories/userRepository.js', () => ({
  findById: vi.fn(), findByEmail: vi.fn(), registerLoginFailure: vi.fn(), registerLoginSuccess: vi.fn(),
}));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn() }));
vi.mock('../../src/integrations/resend/resendClient.js', () => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true }) }));

const { supabaseAdmin, createAuthClient } = await import('../../src/integrations/supabase/client.js');
const userRepo = await import('../../src/repositories/userRepository.js');
const authService = await import('../../src/services/authService.js');

function jwt(payload) {
  return `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
}
const now = Math.floor(Date.now() / 1000);
const profile = (over = {}) => ({
  id: 'u1', email: 'ada@example.com', full_name: 'Ada', account_status: 'active', email_verified_at: '2026-01-01',
  user_roles: [{ role_code: 'OSUSU_MEMBER' }], sessions_revoked_at: null, ...over,
});

let n = 0;
beforeEach(() => {
  vi.clearAllMocks();
  n += 1;
});

describe('session resolution', () => {
  it('loads roles from the database, not from the token', async () => {
    const token = jwt({ sub: 'u1', iat: now, exp: now + 3600, role: 'SUPER_ADMIN', n });
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: `u-roles-${n}` } }, error: null });
    userRepo.findById.mockResolvedValue(profile({ id: `u-roles-${n}` }));
    const user = await authService.resolveUser(token, Date.now());
    expect(user.roles).toEqual(['OSUSU_MEMBER']);
  });

  it('rejects invalid tokens', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: null, error: { message: 'invalid JWT' } });
    await expect(authService.resolveUser(jwt({ n }), Date.now())).rejects.toMatchObject({ status: 401 });
  });

  it('rejects sessions older than the absolute lifetime', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: `u-old-${n}` } }, error: null });
    userRepo.findById.mockResolvedValue(profile({ id: `u-old-${n}` }));
    const started = Date.now() - 400 * 3600 * 1000;
    await expect(authService.resolveUser(jwt({ iat: now, exp: now + 3600, n }), started)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('rejects sessions started before a password change (revocation)', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: `u-rev-${n}` } }, error: null });
    userRepo.findById.mockResolvedValue(profile({ id: `u-rev-${n}`, sessions_revoked_at: new Date().toISOString() }));
    await expect(authService.resolveUser(jwt({ iat: now, exp: now + 3600, n }), Date.now() - 60_000)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });

  it('blocks suspended accounts', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: `u-sus-${n}` } }, error: null });
    userRepo.findById.mockResolvedValue(profile({ id: `u-sus-${n}`, account_status: 'suspended' }));
    await expect(authService.resolveUser(jwt({ iat: now, exp: now + 3600, n }), Date.now())).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
  });
});

describe('login protection', () => {
  it('refuses login while the account is locked, without checking the password', async () => {
    userRepo.findByEmail.mockResolvedValue(profile({ locked_until: new Date(Date.now() + 600_000).toISOString() }));
    await expect(authService.login({ email: 'ada@example.com', password: 'x' }, { get: () => '' })).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(createAuthClient).not.toHaveBeenCalled();
  });

  it('counts failures and returns a generic error', async () => {
    userRepo.findByEmail.mockResolvedValue(profile());
    createAuthClient.mockReturnValue({ auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } }) } });
    userRepo.registerLoginFailure.mockResolvedValue(null);
    await expect(authService.login({ email: 'ada@example.com', password: 'wrong' }, { get: () => '' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(userRepo.registerLoginFailure).toHaveBeenCalledWith('u1', 5, 15);
  });

  it('gives the same error for unknown emails (no account enumeration)', async () => {
    userRepo.findByEmail.mockResolvedValue(null);
    createAuthClient.mockReturnValue({ auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } }) } });
    await expect(authService.login({ email: 'nobody@example.com', password: 'x' }, { get: () => '' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
});
