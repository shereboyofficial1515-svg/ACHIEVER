import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repositories/securityRepository.js', () => ({
  listRolePermissions: vi.fn().mockResolvedValue([
    { role_code: 'SUPER_ADMIN', permission_code: 'roles.manage' },
    { role_code: 'SUPER_ADMIN', permission_code: 'users.read' },
    { role_code: 'SUPPORT_ADMIN', permission_code: 'support.tickets' },
    { role_code: 'SUPPORT_ADMIN', permission_code: 'users.read' },
    { role_code: 'FINANCE_ADMIN', permission_code: 'finance.ledger.read' },
  ]),
}));

const { signSessionStart, readSession, readSessionStart } = await import('../../src/utils/cookies.js');
const { describeUserAgent, maskIp } = await import('../../src/services/sessionService.js');
const permissionService = await import('../../src/services/permissionService.js');
const { explain } = await import('../../src/services/riskService.js');

describe('session cookie marker', () => {
  const sid = '6f1c2a4e-1b2c-4d3e-8f90-123456789abc';

  it('round-trips the start time and server-side session id', () => {
    expect(readSession(signSessionStart(1_700_000_000_000, sid))).toEqual({ startedAt: 1_700_000_000_000, sessionId: sid });
  });

  it('still accepts the legacy marker without a session id (no forced logout)', () => {
    expect(readSession(signSessionStart(1_700_000_000_000))).toEqual({ startedAt: 1_700_000_000_000, sessionId: null });
    expect(readSessionStart(signSessionStart(42))).toBe(42);
  });

  it('rejects a tampered session id or start time', () => {
    const good = signSessionStart(1_700_000_000_000, sid);
    const [ts, , sig] = good.split('.');
    expect(readSession(`${ts}.6f1c2a4e-1b2c-4d3e-8f90-000000000000.${sig}`)).toBeNull();
    expect(readSession(`1800000000000.${sid}.${sig}`)).toBeNull();
    expect(readSession('garbage')).toBeNull();
  });
});

describe('device description & IP masking', () => {
  it('labels common browsers without storing the raw fingerprint', () => {
    const d = describeUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36');
    expect(d).toMatchObject({ deviceType: 'mobile', os: 'Android', browser: 'Chrome', label: 'Chrome on Android' });
    expect(describeUserAgent('').label).toBe('Unknown device');
  });

  it('masks the last octet of IPv4 addresses shown to users', () => {
    expect(maskIp('102.89.4.211')).toBe('102.89.4.x');
    expect(maskIp(null)).toBeNull();
  });
});

describe('least-privilege permissions', () => {
  it('derives permissions from staff roles only', async () => {
    expect(await permissionService.permissionsForRoles(['OSUSU_MEMBER', 'SAVER'])).toEqual([]);
    expect(await permissionService.permissionsForRoles(['SUPPORT_ADMIN'])).toEqual(['support.tickets', 'users.read']);
  });

  it('support staff cannot read the ledger or manage roles', async () => {
    const support = { roles: ['SUPPORT_ADMIN'], permissions: await permissionService.permissionsForRoles(['SUPPORT_ADMIN']) };
    expect(permissionService.can(support, 'finance.ledger.read')).toBe(false);
    expect(permissionService.can(support, 'roles.manage')).toBe(false);
    expect(permissionService.canOversee(support)).toBe(true);
  });
});

describe('explainable risk', () => {
  it('lists concrete factors instead of an opaque score', () => {
    const factors = explain({
      account_age_days: 2, verification_level: 1, open_high_security_events: 1, failed_payments_30d: 4, open_risk_flags: 0,
      disputes_as_respondent: 0, failed_verifications: 0, overdue_contributions: 2, last_payment_account_change: new Date().toISOString(),
    });
    expect(factors.map((f) => f.code)).toEqual([
      'new_account', 'low_verification', 'open_security_events', 'failed_payments', 'overdue_contributions', 'recent_payment_account_change',
    ]);
    expect(factors.every((f) => !/fraud/i.test(f.label))).toBe(true);
  });
});
