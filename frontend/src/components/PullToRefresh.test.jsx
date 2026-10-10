// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PullToRefresh, { reloadAll } from './PullToRefresh.jsx';
import { checkPublicUrls } from '../../scripts/public-urls.mjs';

afterEach(cleanup);

const touch = (el, type, y, x = 100) => {
  const ev = new Event(type, { bubbles: true });
  ev.touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
  el.dispatchEvent(ev);
};
const pull = (el, distance) => {
  touch(el, 'touchstart', 100);
  touch(el, 'touchmove', 110);
  touch(el, 'touchmove', 100 + distance);
  touch(el, 'touchend', 100 + distance);
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('PullToRefresh', () => {
  it('a long pull from the top refreshes exactly once, even if pulled again while busy', async () => {
    let resolve;
    const onRefresh = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
    const el = screen.getByText('content').parentElement;
    await act(async () => pull(el, 300));
    await act(async () => pull(el, 300));   // second pull while the first is still loading
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Refreshing…')).toBeTruthy();
    await act(async () => resolve(true));
    await flush();
    expect(screen.getByText('Updated')).toBeTruthy();
  });

  it('a short pull or a sideways swipe does not refresh', async () => {
    const onRefresh = vi.fn(async () => true);
    render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
    const el = screen.getByText('content').parentElement;
    await act(async () => pull(el, 60));
    await act(async () => { touch(el, 'touchstart', 100, 100); touch(el, 'touchmove', 120, 300); touch(el, 'touchend', 120, 300); });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('a failed refresh keeps the screen and says so (never "up to date")', async () => {
    render(<PullToRefresh onRefresh={() => Promise.reject(new Error('offline'))}><p>content</p></PullToRefresh>);
    await act(async () => pull(screen.getByText('content').parentElement, 300));
    await flush();
    expect(screen.getByText(/Couldn’t refresh/)).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('turns off the browser’s own pull-to-reload only while mounted', () => {
    const { unmount } = render(<PullToRefresh onRefresh={async () => true}><p>x</p></PullToRefresh>);
    expect(document.documentElement.classList.contains('has-ptr')).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains('has-ptr')).toBe(false);
  });
});

describe('reloadAll', () => {
  it('uses the background refresh and reports whether anything changed', async () => {
    const a = { data: [1], refresh: vi.fn(async () => ({ data: [1] })), reload: vi.fn() };
    const b = { data: { n: 1 }, refresh: vi.fn(async () => ({ data: { n: 2 } })) };
    expect(await reloadAll(a, b)).toBe(true);
    expect(a.reload).not.toHaveBeenCalled();
    expect(await reloadAll(a)).toBe(false);
  });
  it('loading data where there was none (e.g. after an error) counts as "Updated"', async () => {
    const failedBefore = { data: undefined, refresh: async () => ({ data: { categories: [1, 2] }, meta: undefined, message: 'OK' }) };
    const same = { data: [1], refresh: async () => ({ data: [1], meta: undefined, message: 'OK' }) };
    expect(await reloadAll(failedBefore, same)).toBe(true);
    const errorOverOldData = { data: [1], error: new Error('500'), refresh: async () => ({ data: [1] }) };
    expect(await reloadAll(errorOverOldData)).toBe(true);
  });

  it('rejects when any request fails', async () => {
    const ok = { data: 1, refresh: async () => ({ data: 1 }) };
    const bad = { data: 1, refresh: async () => { throw new Error('500'); } };
    await expect(reloadAll(ok, bad)).rejects.toThrow('500');
  });
});

describe('build-time URL check (VITE_API_URL)', () => {
  it('rejects the malformed value that broke sign-in, accepts empty or full URLs', () => {
    expect(() => checkPublicUrls({ VITE_API_URL: 'https//api.achieverng.site' })).toThrow(/VITE_API_URL/);
    expect(() => checkPublicUrls({ VITE_API_URL: 'api.achieverng.site' })).toThrow();
    expect(() => checkPublicUrls({ VITE_API_URL: '' })).not.toThrow();
    expect(() => checkPublicUrls({ VITE_API_URL: 'https://api.achieverng.site', VITE_PUBLIC_SITE_URL: 'https://achieverng.site' })).not.toThrow();
  });
});
