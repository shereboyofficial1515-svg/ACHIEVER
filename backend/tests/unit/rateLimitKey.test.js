import { describe, expect, it } from 'vitest';
import { edgeKey } from '../../src/middleware/rateLimiters.js';

const req = (headers, ip) => ({ ip, get: (h) => headers[h.toLowerCase()] });

describe('credential-endpoint backstop key', () => {
  it('uses the address Cloudflare saw, so a forged X-Forwarded-For does not create a fresh budget', () => {
    // req.ip is taken from X-Forwarded-For, whose first entry the client chooses.
    const a = edgeKey(req({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.1' }, '203.0.113.1'));
    const b = edgeKey(req({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.2' }, '203.0.113.2'));
    expect(a).toBe(b);
    expect(a).toContain('198.51.100.7');
  });
  it('falls back to req.ip where there is no Cloudflare in front (local development)', () => {
    expect(edgeKey(req({}, '127.0.0.1'))).toContain('127.0.0.1');
  });
});
