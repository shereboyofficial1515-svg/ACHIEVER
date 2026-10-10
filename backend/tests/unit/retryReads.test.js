import { describe, expect, it, vi } from 'vitest';
import { retryReadsOnce } from '../../src/utils/timeout.js';

const dropped = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });

describe('database reads survive one dropped connection', () => {
  it('a GET whose connection dropped is tried once more and succeeds', async () => {
    const f = vi.fn().mockRejectedValueOnce(dropped()).mockResolvedValueOnce({ ok: true, status: 200 });
    expect((await retryReadsOnce(f, { delayMs: 0 })('https://db/rest/v1/x', { method: 'GET' })).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('writes are never retried (nothing may be applied twice)', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
      const f = vi.fn().mockRejectedValue(dropped());
      await expect(retryReadsOnce(f, { delayMs: 0 })('https://db/rest/v1/rpc/x', { method })).rejects.toThrow('fetch failed');
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
  it('time-outs are not retried, and a second failure is reported', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const f1 = vi.fn().mockRejectedValue(timeout);
    await expect(retryReadsOnce(f1, { delayMs: 0 })('u', { method: 'GET' })).rejects.toThrow('timed out');
    expect(f1).toHaveBeenCalledTimes(1);
    const f2 = vi.fn().mockRejectedValue(dropped());
    await expect(retryReadsOnce(f2, { delayMs: 0 })('u', {})).rejects.toThrow('fetch failed');
    expect(f2).toHaveBeenCalledTimes(2);
  });
});
