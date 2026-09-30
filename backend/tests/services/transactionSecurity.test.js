import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const txState = { challenges: new Map(), credentials: new Map(), keys: new Map(), login: new Map(), events: [] };
vi.mock('../../src/repositories/transactionSecurityRepository.js', () => ({
  findCredential: vi.fn(async (u) => txState.credentials.get(u) || null),
  upsertCredential: vi.fn(async (u, h) => { txState.credentials.set(u, { user_id: u, pin_hash: h, failed_attempts: 0, locked_until: null }); return {}; }),
  updateCredential: vi.fn(async (u, patch) => Object.assign(txState.credentials.get(u), patch)),
  insertChallenge: vi.fn(async (row) => { const c = { attempts: 0, verified_at: null, consumed_at: null, ...row }; txState.challenges.set(c.id, c); return { ...c }; }),
  findChallenge: vi.fn(async (id) => (txState.challenges.get(id) ? { ...txState.challenges.get(id) } : null)),
  updateChallenge: vi.fn(async (id, patch) => Object.assign(txState.challenges.get(id), patch)),
  consumeChallenge: vi.fn(async (id) => { const c = txState.challenges.get(id); if (!c || c.consumed_at || !c.verified_at) return null; c.consumed_at = 'now'; return { id }; }),
  countRecentChallenges: vi.fn(async () => 0),
  insertDeviceKey: vi.fn(async (row) => { const k = { id: crypto.randomUUID(), revoked_at: null, created_at: 'now', ...row }; txState.keys.set(k.id, k); return { ...k }; }),
  findDeviceKey: vi.fn(async (id) => (txState.keys.get(id) ? { ...txState.keys.get(id) } : null)),
  listDeviceKeys: vi.fn(async (u) => [...txState.keys.values()].filter((k) => k.user_id === u && !k.revoked_at)),
  touchDeviceKey: vi.fn(async () => []),
  revokeDeviceKey: vi.fn(async (id, u) => { const k = txState.keys.get(id); if (!k || k.user_id !== u || k.revoked_at) return null; k.revoked_at = 'now'; return { ...k }; }),
  revokeAllDeviceKeys: vi.fn(async () => []),
  insertLoginChallenge: vi.fn(async (row) => { const c = { id: crypto.randomUUID(), consumed_at: null, ...row }; txState.login.set(c.id, c); return { ...c }; }),
  findLoginChallenge: vi.fn(async (id) => (txState.login.get(id) ? { ...txState.login.get(id) } : null)),
  consumeLoginChallenge: vi.fn(async (id) => { const c = txState.login.get(id); if (!c || c.consumed_at) return null; c.consumed_at = 'now'; return { id }; }),
  insertEvent: vi.fn(async (row) => { txState.events.push(row); }),
}));
vi.mock('../../src/services/settingsService.js', () => ({ getInt: vi.fn(async (_k, d) => d), get: vi.fn(async (_k, d) => d), getBool: vi.fn(async (_k, d) => d) }));
vi.mock('../../src/services/notificationService.js', () => ({ notify: vi.fn(async () => null), kickDispatcher: vi.fn() }));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn(async () => null) }));
const emailed = [];
vi.mock('../../src/services/emailService.js', () => ({ sendSecurityCode: vi.fn(async (_t, _n, code) => { emailed.push(code); return { ok: true }; }) }));
vi.mock('../../src/repositories/userRepository.js', () => ({
  findById: vi.fn(async (id) => ({ id, email: 'ada@example.com', account_status: id === 'u-suspended' ? 'suspended' : 'active' })),
  registerLoginSuccess: vi.fn(async () => {}),
}));
vi.mock('../../src/integrations/supabase/client.js', () => ({
  supabaseAdmin: { auth: { admin: { generateLink: vi.fn(async () => ({ data: { properties: { hashed_token: 'th' } } })) } } },
  createAuthClient: () => ({ auth: { verifyOtp: vi.fn(async () => ({ data: { session: { access_token: 'at', refresh_token: 'rt' } } })) } }),
}));

const tx = await import('../../src/services/transactionAuthService.js');
const deviceKeys = await import('../../src/services/deviceKeyService.js');
const confirmSchema = (await import('../../src/validators/billValidators.js')).confirm;

const user = { id: 'u-1', email: 'ada@example.com', fullName: 'Ada', sessionId: 's-1' };
const bill = { id: crypto.randomUUID(), user_id: 'u-1', amount: 100000, fee: 0, total_amount: 100000, service_id: 'mtn', customer_identifier: '08011111111', variation_code: null, quantity: 1, phone: '+2348011111111' };

function newDeviceKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const sign = (payload) => crypto.sign('sha256', Buffer.from(payload), privateKey).toString('base64'); // DER, like Android
  return { spki, sign };
}

beforeEach(() => {
  txState.challenges.clear(); txState.credentials.clear(); txState.keys.clear(); txState.login.clear(); txState.events.length = 0; emailed.length = 0;
});

describe('transaction PIN', () => {
  it('rejects weak PINs', () => {
    for (const pin of ['123456', '000000', '987654', '12345', 'abcdef', '111111']) expect(() => tx.assertPinStrength(pin)).toThrow();
    expect(() => tx.assertPinStrength('482915')).not.toThrow();
  });

  it('is stored as a salted, peppered scrypt hash — never in plain text', async () => {
    await tx.setPin(user, '482915', {});
    const stored = txState.credentials.get('u-1').pin_hash;
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(stored).not.toContain('482915');
    expect(await tx.checkPinHash('482915', stored)).toBe(true);
    expect(await tx.checkPinHash('482916', stored)).toBe(false);
    expect(await tx.hashPin('482915')).not.toBe(stored);   // unique salt
  });

  it('locks after repeated wrong PINs', async () => {
    await tx.setPin(user, '482915', {});
    for (let i = 0; i < 4; i += 1) await expect(tx.verifyPin(user, '000001', {})).rejects.toMatchObject({ code: 'TRANSACTION_PIN_INVALID' });
    await expect(tx.verifyPin(user, '000001', {})).rejects.toMatchObject({ code: 'TRANSACTION_PIN_LOCKED' });
    await expect(tx.verifyPin(user, '482915', {})).rejects.toMatchObject({ code: 'TRANSACTION_PIN_LOCKED' });   // even the right PIN
    expect(txState.events.map((e) => e.type)).toContain('transaction_pin_locked');
  });

  it('never appears in security event records', async () => {
    await tx.setPin(user, '482915', {});
    await tx.verifyPin(user, '777777', {}).catch(() => {});
    expect(JSON.stringify(txState.events)).not.toMatch(/482915|777777/);
  });
});

describe('emailed transaction code', () => {
  it('is single use, bound to the bill, and stored only as a hash', async () => {
    await tx.setPin(user, '482915', {});
    const ch = await tx.createChallenge(user, { bill, method: 'email_otp', pin: '482915', describe: 'x' }, {});
    const stored = txState.challenges.get(ch.challengeId);
    expect(stored.code_hash).not.toContain(emailed[0]);
    const ok = await tx.consumeChallenge(user, { challengeId: ch.challengeId, code: emailed[0] }, bill, {});
    expect(ok.method).toBe('email_otp');
    await expect(tx.consumeChallenge(user, { challengeId: ch.challengeId, code: emailed[0] }, bill, {})).rejects.toMatchObject({ code: 'TX_AUTH_USED' });
  });

  it('allows a limited number of wrong attempts', async () => {
    await tx.setPin(user, '482915', {});
    const ch = await tx.createChallenge(user, { bill, method: 'email_otp', pin: '482915', describe: 'x' }, {});
    for (let i = 0; i < 5; i += 1) await tx.consumeChallenge(user, { challengeId: ch.challengeId, code: '000000' }, bill, {}).catch(() => {});
    await expect(tx.consumeChallenge(user, { challengeId: ch.challengeId, code: emailed[0] }, bill, {})).rejects.toMatchObject({ code: 'TX_AUTH_LOCKED' });
  });

  it('cannot be requested without the correct PIN', async () => {
    await tx.setPin(user, '482915', {});
    await expect(tx.createChallenge(user, { bill, method: 'email_otp', pin: '999888', describe: 'x' }, {})).rejects.toMatchObject({ code: 'TRANSACTION_PIN_INVALID' });
    expect(emailed).toHaveLength(0);
  });
});

describe('biometric (device key) approval', () => {
  it('accepts only a valid signature from the enrolled key over this exact challenge', async () => {
    const dev = newDeviceKey();
    const key = await (await import('../../src/repositories/transactionSecurityRepository.js')).insertDeviceKey({ user_id: 'u-1', public_key: dev.spki, label: 'Pixel', allow_login: true, allow_transactions: true });
    const ch = await tx.createChallenge(user, { bill, method: 'device_biometric', deviceKeyId: key.id }, {});
    expect(ch.signPayload).toMatch(/^achiever-tx:v1:/);

    const attacker = newDeviceKey();
    await expect(tx.consumeChallenge(user, { challengeId: ch.challengeId, signature: attacker.sign(ch.signPayload) }, bill, {})).rejects.toMatchObject({ code: 'TX_AUTH_INVALID' });
    await expect(tx.consumeChallenge(user, { challengeId: ch.challengeId, signature: dev.sign(`${ch.signPayload}x`) }, bill, {})).rejects.toMatchObject({ code: 'TX_AUTH_INVALID' });
    const ok = await tx.consumeChallenge(user, { challengeId: ch.challengeId, signature: dev.sign(ch.signPayload) }, bill, {});
    expect(ok.method).toBe('device_biometric');
  });

  it('a client claim such as isBiometric=true is not accepted as proof', () => {
    const parsed = confirmSchema.safeParse({ challengeId: crypto.randomUUID(), isBiometric: true });
    expect(parsed.success).toBe(false);
  });

  it('a revoked key cannot approve', async () => {
    const dev = newDeviceKey();
    const repo = await import('../../src/repositories/transactionSecurityRepository.js');
    const key = await repo.insertDeviceKey({ user_id: 'u-1', public_key: dev.spki, label: 'Pixel', allow_login: true, allow_transactions: true });
    const ch = await tx.createChallenge(user, { bill, method: 'device_biometric', deviceKeyId: key.id }, {});
    txState.keys.get(key.id).revoked_at = 'now';
    await expect(tx.consumeChallenge(user, { challengeId: ch.challengeId, signature: dev.sign(ch.signPayload) }, bill, {})).rejects.toMatchObject({ code: 'TX_AUTH_INVALID' });
  });
});

describe('biometric enrolment and sign-in', () => {
  const verifyPassword = async (_e, p) => p === 'correct horse';

  it('enrolment needs the password and proof that the device holds the key', async () => {
    await expect(deviceKeys.startEnrolment(user, 'wrong', verifyPassword, {})).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    const start = await deviceKeys.startEnrolment(user, 'correct horse', verifyPassword, {});
    const dev = newDeviceKey();
    const other = newDeviceKey();
    await expect(deviceKeys.completeEnrolment(user, { registrationToken: start.registrationToken, publicKey: dev.spki, signature: other.sign(start.signPayload) }, {}))
      .rejects.toMatchObject({ code: 'ENROLMENT_SIGNATURE_INVALID' });
    await expect(deviceKeys.completeEnrolment({ ...user, id: 'u-9' }, { registrationToken: start.registrationToken, publicKey: dev.spki, signature: dev.sign(start.signPayload) }, {}))
      .rejects.toMatchObject({ code: 'ENROLMENT_EXPIRED' });   // token bound to the user
    const key = await deviceKeys.completeEnrolment(user, { registrationToken: start.registrationToken, publicKey: dev.spki, signature: dev.sign(start.signPayload), label: 'Tecno' }, {});
    expect(key).toMatchObject({ label: 'Tecno', allowLogin: true });
    expect(txState.events.map((e) => e.type)).toContain('biometric_enabled');
  });

  it('sign-in works once per challenge; replay and cancelled/forged signatures fail', async () => {
    const dev = newDeviceKey();
    const repo = await import('../../src/repositories/transactionSecurityRepository.js');
    const key = await repo.insertDeviceKey({ user_id: 'u-1', public_key: dev.spki, label: 'Tecno', allow_login: true, allow_transactions: true });
    const ch = await deviceKeys.loginChallenge(key.id, {});
    // Biometric prompt cancelled: the app has no signature to send.
    await expect(deviceKeys.login({ challengeId: ch.challengeId, keyId: key.id, signature: '' }, {})).rejects.toMatchObject({ code: 'BIOMETRIC_LOGIN_FAILED' });
    const signature = dev.sign(ch.signPayload);
    const out = await deviceKeys.login({ challengeId: ch.challengeId, keyId: key.id, signature }, {});
    expect(out).toMatchObject({ userId: 'u-1', session: { access_token: 'at' } });
    await expect(deviceKeys.login({ challengeId: ch.challengeId, keyId: key.id, signature }, {})).rejects.toMatchObject({ code: 'BIOMETRIC_LOGIN_FAILED' });
  });

  it('an expired challenge or suspended account cannot sign in', async () => {
    const dev = newDeviceKey();
    const repo = await import('../../src/repositories/transactionSecurityRepository.js');
    const key = await repo.insertDeviceKey({ user_id: 'u-suspended', public_key: dev.spki, label: 'Tecno', allow_login: true, allow_transactions: true });
    const ch = await deviceKeys.loginChallenge(key.id, {});
    await expect(deviceKeys.login({ challengeId: ch.challengeId, keyId: key.id, signature: dev.sign(ch.signPayload) }, {})).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    const ch2 = await deviceKeys.loginChallenge(key.id, {});
    txState.login.get(ch2.challengeId).expires_at = new Date(Date.now() - 1).toISOString();
    await expect(deviceKeys.login({ challengeId: ch2.challengeId, keyId: key.id, signature: dev.sign(ch2.signPayload) }, {})).rejects.toMatchObject({ code: 'BIOMETRIC_LOGIN_FAILED' });
  });

  it('turning biometrics off is audited and the key stops working', async () => {
    const dev = newDeviceKey();
    const repo = await import('../../src/repositories/transactionSecurityRepository.js');
    const key = await repo.insertDeviceKey({ user_id: 'u-1', public_key: dev.spki, label: 'Tecno', allow_login: true, allow_transactions: true });
    await deviceKeys.revoke(user, key.id, {});
    await expect(deviceKeys.loginChallenge(key.id, {})).rejects.toMatchObject({ code: 'BIOMETRIC_LOGIN_UNAVAILABLE' });
    await expect(deviceKeys.revoke({ ...user, id: 'u-2' }, key.id, {})).rejects.toMatchObject({ status: 404 });
  });
});
