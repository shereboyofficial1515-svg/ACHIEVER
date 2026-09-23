/**
 * Default identity provider: no automated lookup. The record is queued for a
 * platform ADMIN to review against the identity document the user uploads.
 */
export const manualReviewProvider = {
  name: 'manual',
  requiresDocument: true,
  async verify() {
    return { status: 'manual_review', reason: 'Awaiting document review by ACHIEVER staff' };
  },
};
