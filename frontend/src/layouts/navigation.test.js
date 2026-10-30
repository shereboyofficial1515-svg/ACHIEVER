import { describe, expect, it } from 'vitest';
import { buildNavigation } from './navigation.js';

const nav = (roles) => buildNavigation((...r) => r.some((x) => roles.includes(x)));
const labels = (section) => section.items.map((i) => i.label);

describe('navigation', () => {
  it('groups the sidebar into savings, money, community and support', () => {
    const n = nav(['OSUSU_MEMBER']);
    expect(n.sections.map((s) => s.id)).toEqual(['home', 'savings', 'money', 'community', 'support']);
    expect(labels(n.sections[1])).toEqual(['Osusu groups', 'Meetings']);
    expect(labels(n.sections[2])).toEqual(['ACHIEVER Wallet', 'Payments', 'Bills & Services']);
    expect(n.account.map((i) => i.to)).toEqual(['/app/profile', '/app/settings']);
  });

  it('shows role-only destinations only to members with the role', () => {
    const saver = nav(['SAVER']);
    expect(labels(saver.sections.find((s) => s.id === 'savings'))).toEqual(['My savings']);
    const collector = nav(['COLLECTOR']);
    expect(collector.main.some((i) => i.to === '/app/collector')).toBe(true);
    expect(nav([]).sections.some((s) => s.id === 'savings')).toBe(false);
  });

  it('keeps five bottom-bar destinations that all exist in the menu', () => {
    for (const roles of [['OSUSU_MEMBER'], ['OSUSU_MEMBER', 'SAVER'], ['COLLECTOR'], ['SAVER'], []]) {
      const n = nav(roles);
      expect(n.bottom.length).toBeGreaterThanOrEqual(4);
      for (const b of n.bottom) expect(n.main).toContain(b);
    }
  });
});
