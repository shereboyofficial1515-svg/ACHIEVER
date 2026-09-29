import { HELP_ARTICLES } from '../help/articles.js';

/**
 * Help Center visuals registry. Every instructional image has an id, title,
 * type, source, alt text, credit and licence. The step diagrams are drawn by
 * ACHIEVER (FlowIllustration) from the article's own steps, so they always
 * match the app and cost no downloads until an article is opened.
 */
export const HELP_ASSETS = Object.fromEntries(HELP_ARTICLES.map((a) => [
  `diagram:${a.id}`,
  {
    id: `diagram:${a.id}`,
    title: a.title,
    type: 'diagram',
    src: null, // rendered in code from `steps`
    steps: a.diagram,
    alt: `Diagram: ${a.diagram.map((s) => s.label).join(', then ')}.`,
    credit: 'ACHIEVER',
    source: 'ACHIEVER product design',
    license: 'Proprietary (ACHIEVER)',
  },
]));

export function helpAsset(articleId) {
  return HELP_ASSETS[`diagram:${articleId}`] || null;
}
