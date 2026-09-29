/**
 * Every photograph and illustration used in ACHIEVER, in one place: source,
 * alt text, credit and licence. Components reference assets by id; nothing
 * hard-codes image URLs.
 *
 * Photographs come from Unsplash (Unsplash License: free to use, attribution
 * given as "Photo by <name> on Unsplash"). They are served from Unsplash's
 * image CDN in the size each screen needs (Unsplash's imgix parameters).
 */
const UTM = 'utm_source=achiever&utm_medium=referral';

function unsplash({ id, photoPage, photographer, profile, alt, focal = '50% 50%' }) {
  const base = `https://images.unsplash.com/${id}?auto=format&fit=crop&q=70`;
  return {
    type: 'photo',
    alt,
    focal,
    src: `${base}&w=1280`,
    srcSet: [640, 960, 1280, 1920].map((w) => `${base}&w=${w} ${w}w`).join(', '),
    // Portrait crop for phones so the subject is not cut off.
    mobileSrcSet: [480, 720, 960].map((w) => `${base}&w=${w}&h=${Math.round(w * 1.25)} ${w}w`).join(', '),
    credit: {
      name: photographer,
      url: `https://unsplash.com/${profile}?${UTM}`,
      source: 'Unsplash',
      sourceUrl: `https://unsplash.com/?${UTM}`,
      photoUrl: `https://unsplash.com/photos/${photoPage}?${UTM}`,
      license: 'Unsplash License',
      licenseUrl: 'https://unsplash.com/license',
    },
  };
}

export const IMAGES = {
  heroMarket: {
    id: 'heroMarket',
    title: 'Market trader in Lagos',
    ...unsplash({
      id: 'photo-1575303093127-18b3c4ef8c41',
      photoPage: 'woman-holding-tomatoes-near-containers-of-tomatoes-zlZnNIS7eDk',
      photographer: 'Omotayo Tajudeen',
      profile: '@omotayo_ty',
      // Decorative behind the headline (the text carries the message), so alt is empty in the hero.
      alt: 'A trader arranging tomatoes at her market stall in Lagos, Nigeria',
      focal: '62% 30%',
    }),
  },
};

export function image(id) {
  const asset = IMAGES[id];
  if (!asset) throw new Error(`Unknown image asset: ${id}`);
  return asset;
}
