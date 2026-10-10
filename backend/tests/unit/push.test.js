import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
vi.stubEnv('FCM_PROJECT_ID', 'achiever-test');
vi.stubEnv('FCM_CLIENT_EMAIL', 'push@achiever-test.iam.gserviceaccount.com');
vi.stubEnv('FCM_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n'));

const devices = [];
const disabled = [];
vi.mock('../../src/integrations/supabase/db.js', () => {
  const chain = (result) => {
    const q = { select: () => q, eq: () => q, is: () => q, limit: () => Promise.resolve({ data: result, error: null }), update: (patch) => { disabled.push(patch); return q; }, upsert: (row) => { devices.push(row); return q; } };
    return q;
  };
  return {
    db: { from: () => chain(devices.map((d, i) => ({ id: `d${i}`, token_encrypted: d.token_encrypted }))) },
    run: async (q) => (q && typeof q.then === 'function' ? (await q).data : []),
    one: async () => null,
  };
});
vi.mock('../../src/services/providerHealthService.js', () => ({ record: vi.fn() }));

const push = await import('../../src/services/pushService.js');

beforeEach(() => { devices.length = 0; disabled.length = 0; push.__reset(); });

describe('push notifications', () => {
  it('lock-screen text for money and security notices is generic (no amounts, names or numbers)', () => {
    expect(push.lockScreenText({ category: 'payments', title: 'Purchase successful', body: 'Your MTN purchase of ₦1,000.00 for 08011111111 was successful.' }))
      .toEqual({ title: 'Purchase successful', body: 'You have a new payment update. Open ACHIEVER to view it.' });
    expect(push.lockScreenText({ category: 'security', title: 'New sign-in', body: 'Signed in from Tecno KM6 at 10.0.0.1' }).body).not.toMatch(/Tecno|10\.0/);
    expect(push.lockScreenText({ category: 'referrals', title: 'New referral', body: 'Someone joined ACHIEVER using your referral code.' }).body)
      .toBe('Someone joined ACHIEVER using your referral code.');
  });

  it('stores device tokens encrypted, never in plain text', async () => {
    await push.registerDevice({ id: 'u1' }, { token: 'fcm-token-abcdefghijklmnopqrstuvwxyz', appVersion: '1.2.0' });
    expect(devices[0].token_encrypted).toMatch(/^v1\./);
    expect(JSON.stringify(devices[0])).not.toContain('fcm-token-abcdefghijklmnopqrstuvwxyz');
    await expect(push.registerDevice({ id: 'u1' }, { token: 'bad token' })).rejects.toMatchObject({ code: 'INVALID_PUSH_TOKEN' });
  });

  it('sends through FCM HTTP v1 and switches off tokens FCM reports as unregistered', async () => {
    await push.registerDevice({ id: 'u1' }, { token: 'fcm-token-abcdefghijklmnopqrstuvwxyz' });
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }) };
      return { ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) };
    };
    const r = await push.send({ id: 'n1', user_id: 'u1', category: 'payments', title: 'Purchase successful', body: '₦1,000', data: { bill_payment_id: 'b1' } }, { fetchImpl });
    expect(r.ok).toBe(false);
    const sent = JSON.parse(calls[1].init.body);
    expect(calls[1].url).toBe('https://fcm.googleapis.com/v1/projects/achiever-test/messages:send');
    expect(sent.message.notification.body).not.toContain('₦');
    expect(sent.message.data.route).toBe('/app/bills/history/b1');
    expect(disabled.at(-1)).toMatchObject({ disabled_reason: 'token_invalid' });
  });

  it('incoming call: high priority on the calls channel, expires in 45s, tagged by call; identifiers only', async () => {
    await push.registerDevice({ id: 'u2' }, { token: 'fcm-token-calls-abcdefghijklmnopqrstuvwxyz' });
    const bodies = [];
    const fetchImpl = async (url, init) => {
      if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }) };
      bodies.push(JSON.parse(init.body).message);
      return { ok: true, json: async () => ({ name: 'projects/x/messages/1' }) };
    };
    const call = { id: 'c-1', conversation_id: 'conv-9', call_type: 'video', scope: 'group', room_name: 'ach_c-1' };
    expect(await push.sendCall('u2', call, 'ring', { fetchImpl })).toMatchObject({ ok: true, devices: 1 });
    expect(bodies[0]).toMatchObject({
      notification: { title: 'Incoming group video call', body: 'Open ACHIEVER to answer.' },
      data: { type: 'call', call_event: 'ring', call_id: 'c-1', conversation_id: 'conv-9', route: '/app/messages/conv-9?call=c-1' },
      android: { priority: 'high', ttl: '45s', notification: { channel_id: 'calls', tag: 'call-c-1' } },
    });
    const { token: _deviceAddress, ...payload } = bodies[0];   // "token" is the FCM device address itself
    expect(JSON.stringify(payload)).not.toMatch(/ach_c-1|token|secret|jwt/i);   // no LiveKit room or credentials

    // Follow-ups replace the ringing notification (same tag) quietly.
    await push.sendCall('u2', call, 'cancelled', { fetchImpl });
    expect(bodies[1]).toMatchObject({ notification: { title: 'Missed video call' }, android: { priority: 'normal', notification: { channel_id: 'quiet', tag: 'call-c-1' } } });

    // The "Missed call" notice from the notification queue uses the same tag.
    await push.send({ id: 'n2', user_id: 'u2', category: 'messages', title: 'Missed call', body: 'You missed a call', data: { call_id: 'c-1', conversation_id: 'conv-9' } }, { fetchImpl });
    expect(bodies[2].android.notification.tag).toBe('call-c-1');
  });

  it('no registered phone is reported honestly, not as delivered', async () => {
    expect(await push.sendCall('nobody', { id: 'c', conversation_id: 'v', call_type: 'voice', scope: 'direct' }, 'ring', { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }))
      .toMatchObject({ ok: false, error: 'NO_DEVICES' });
  });
});
