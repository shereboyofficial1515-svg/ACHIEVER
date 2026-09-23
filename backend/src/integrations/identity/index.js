import { env } from '../../config/env.js';
import { manualReviewProvider } from './manualReviewProvider.js';

/**
 * Identity verification (BVN / NIN) provider abstraction.
 *
 * ACHIEVER does not bundle a specific BVN/NIN vendor. A compliant, licensed
 * Nigerian identity provider must be contracted and wired in as an adapter:
 *
 *   name: string
 *   verify({ idType: 'bvn'|'nin', idNumber, firstName, lastName, dateOfBirth })
 *     : Promise<{ status: 'verified'|'failed'|'manual_review', providerReference?, nameMatch?, reason? }>
 *
 * Adapters must not persist or log the raw idNumber. The calling service stores
 * only a keyed hash and the last four digits.
 *
 * Until an adapter is configured, the 'manual' provider routes every request to
 * staff review of an uploaded identity document.
 */
const providers = { manual: manualReviewProvider };

export function getIdentityProvider() {
  return providers[env.IDENTITY_PROVIDER] ?? manualReviewProvider;
}
