import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES, findArticle, searchArticles } from './articles.js';
import { HELP_ASSETS, helpAsset } from '../content/helpCenterAssets.js';
import { IMAGES } from '../content/imageAssets.js';

describe('Help Center', () => {
  it.each([
    ['payment', 'make-contribution'], ['contribution', 'make-contribution'], ['Osusu', 'create-osusu-group'],
    ['Collector', 'save-with-collector'], ['payout', 'payout-order'], ['withdrawal', 'payout-order'],
    ['password', 'change-password'], ['phone', 'change-phone'], ['email', 'change-email'], ['security', 'change-password'],
    ['refund', 'refund'], ['account deletion', 'delete-account'], ['KYC', 'kyc'], ['video call', 'video-call'], ['messages', 'messages'],
  ])('search "%s" finds a relevant article', (q, expected) => {
    const ids = searchArticles(q).slice(0, 3).map((a) => a.id);
    expect(ids).toContain(expected);
  });

  it('every article has steps, a diagram with alt text, and valid related links', () => {
    for (const a of HELP_ARTICLES) {
      expect(a.steps.length, a.id).toBeGreaterThan(0);
      expect(a.diagram.length, a.id).toBeGreaterThan(1);
      const asset = helpAsset(a.id);
      expect(asset.alt, a.id).toMatch(/^Diagram: /);
      expect(asset.license).toBeTruthy();
      for (const r of a.related) expect(findArticle(r), `${a.id} -> ${r}`).toBeTruthy();
    }
    expect(Object.keys(HELP_ASSETS)).toHaveLength(HELP_ARTICLES.length);
  });

  it('the hero photograph carries its credit and licence', () => {
    const hero = IMAGES.heroMarket;
    expect(hero.credit).toMatchObject({ name: 'Omotayo Tajudeen', source: 'Unsplash', license: 'Unsplash License' });
    expect(hero.srcSet.split(', ')).toHaveLength(4); // responsive sizes, not one huge image
    expect(hero.src).toMatch(/^https:\/\/images\.unsplash\.com\/photo-/);
  });
});
