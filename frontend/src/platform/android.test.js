import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }));
vi.mock('@capacitor/app', () => ({ App: {} }));
vi.mock('@capacitor/browser', () => ({ Browser: {} }));
vi.mock('@capacitor/network', () => ({ Network: {} }));
vi.mock('@capacitor/share', () => ({ Share: {} }));
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: {} }));
vi.mock('@capacitor/status-bar', () => ({ StatusBar: {}, Style: {} }));
const { parentPath } = await import('./android.js');

describe('Android back without in-app history goes up one screen', () => {
  it('chat pages: settings → info → chat → Messages → Home', () => {
    expect(parentPath('/app/messages/c1/settings')).toBe('/app/messages/c1/info');
    expect(parentPath('/app/messages/c1/info')).toBe('/app/messages/c1');
    expect(parentPath('/app/messages/c1/media')).toBe('/app/messages/c1');
    expect(parentPath('/app/messages/c1')).toBe('/app/messages');
    expect(parentPath('/app/messages')).toBe('/app');
  });

  it('other screens go to their parent; root screens leave the app', () => {
    expect(parentPath('/app/profile/edit')).toBe('/app/profile');
    expect(parentPath('/app/contacts/u1')).toBe('/app/messages');
    expect(parentPath('/app/wallet/')).toBe('/app');
    expect(parentPath('/app')).toBeNull();
    expect(parentPath('/login')).toBeNull();
  });
});
