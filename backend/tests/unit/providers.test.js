import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeProvider } from '../../src/services/vtpass/providers.js';

vi.mock('../../src/repositories/billRepository.js', () => ({
  findService: vi.fn(async (id) => ({
    mtn: { image_url: 'https://sandbox.vtpass.com/resources/products/200X200/MTN-Airtime-VTU.jpg' },
    evil: { image_url: 'https://attacker.example/resources/x.jpg' },
    internal: { image_url: 'https://169.254.169.254/resources/x.jpg' },
  }[id] || null)),
}));
const logos = await import('../../src/services/vtpass/logos.js');

describe('provider names', () => {
  it('known services get clean names and stable codes', () => {
    expect(describeProvider('aba-electric', 'Aba Electric Payment - ABEDC')).toMatchObject({ providerCode: 'abedc', providerName: 'Aba Power', shortName: 'ABEDC' });
    expect(describeProvider('etisalat', '9mobile Airtime VTU')).toMatchObject({ providerCode: '9mobile', providerName: '9mobile' });
    expect(describeProvider('mtn-data', 'MTN Data').providerCode).toBe('mtn');
  });

  it('new services from VTpass still get a sensible name (not hardcoded)', () => {
    expect(describeProvider('new-electric', 'New Town Electric Payment - NTEDC')).toMatchObject({ providerName: 'New Town Electric', shortName: 'NTEDC', providerCode: 'new' });
    expect(describeProvider('sporty', 'SportyBet')).toMatchObject({ providerName: 'SportyBet', providerCode: 'sporty' });
  });
});

describe('logo proxy', () => {
  beforeEach(() => logos.__clear());

  it('only fetches images from VTpass hosts (no open proxy)', async () => {
    const fetchImpl = vi.fn();
    expect(logos.isAllowedLogoUrl('https://vtpass.com/resources/products/a.jpg')).toBe(true);
    expect(logos.isAllowedLogoUrl('http://vtpass.com/resources/a.jpg')).toBe(false);
    expect(logos.isAllowedLogoUrl('https://vtpass.com.evil.io/resources/a.jpg')).toBe(false);
    expect(await logos.logoFor('evil', { fetchImpl })).toBeNull();
    expect(await logos.logoFor('internal', { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back from a missing sandbox copy to the same path on vtpass.com, accepts images only, and caches', async () => {
    const jpg = new Uint8Array([255, 216, 255, 224]);
    const fetchImpl = vi.fn(async (url) => (url.startsWith('https://sandbox.')
      ? { ok: false, headers: new Headers({ 'content-type': 'text/html' }), arrayBuffer: async () => new ArrayBuffer(0) }
      : { ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => jpg.buffer }));
    const img = await logos.logoFor('mtn', { fetchImpl });
    expect(img.type).toBe('image/jpeg');
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      'https://sandbox.vtpass.com/resources/products/200X200/MTN-Airtime-VTU.jpg',
      'https://vtpass.com/resources/products/200X200/MTN-Airtime-VTU.jpg',
    ]);
    await logos.logoFor('mtn', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
