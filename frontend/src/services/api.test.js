import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';

const reply = (status, body, type) => Promise.resolve(new Response(body, { status, headers: type ? { 'content-type': type } : {} }));

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('a web page instead of JSON (wrong VITE_API_URL) is an error, not an empty success', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply(200, '<!doctype html><html></html>', 'text/html; charset=utf-8')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(api.get('/auth/providers')).rejects.toMatchObject({ code: 'API_UNREACHABLE' });
  });

  it('normal JSON answers still work, with cookies included', async () => {
    const fetch = vi.fn(() => reply(200, JSON.stringify({ success: true, data: { google: true, facebook: true } }), 'application/json; charset=utf-8'));
    vi.stubGlobal('fetch', fetch);
    expect((await api.get('/auth/providers')).data).toEqual({ google: true, facebook: true });
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
  });
});
