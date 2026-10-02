import * as billService from '../services/billService.js';
import * as logos from '../services/vtpass/logos.js';
import { asyncHandler, created, ok, paged } from '../utils/http.js';

const v = (req) => req.validated;

// Catalogue ------------------------------------------------------------------------------------------
export const overview = asyncHandler(async (_req, res) => ok(res, await billService.overview()));
export const status = asyncHandler(async (_req, res) => ok(res, await billService.status()));

/** Public, cacheable provider logo (VTpass catalogue artwork served through ACHIEVER). */
export const logo = async (req, res) => {
  const id = String(req.params.serviceId || '');
  const img = /^[a-z0-9-]{2,60}$/.test(id) ? await logos.logoFor(id).catch(() => null) : null;
  if (!img) return res.status(404).set('Cache-Control', 'public, max-age=600').json({ success: false, message: 'No logo' });
  if (req.get('if-none-match') === img.etag) return res.status(304).end();
  res.set({
    'Content-Type': img.type, 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800', ETag: img.etag,
    'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff',
  });
  return res.send(img.buf);
};
export const services = asyncHandler(async (req, res) => ok(res, await billService.listServices(v(req).query.category)));
/** /airtime/networks, /data/networks, /electricity/providers, /tv/providers, /betting/providers … */
export const servicesFor = (category) => asyncHandler(async (_req, res) => ok(res, await billService.listServices(category)));
export const products = asyncHandler(async (req, res) => ok(res, await billService.listProducts(v(req).params.category, v(req).params.serviceId)));
export const dataPlans = asyncHandler(async (req, res) => ok(res, await billService.listProducts('data', v(req).params.serviceId)));
export const verify = asyncHandler(async (req, res) => ok(res, await billService.verifyCustomer(req.body)));

// Purchase -------------------------------------------------------------------------------------------
export const quote = asyncHandler(async (req, res) =>
  created(res, await billService.quote(req.user, req.body, req.get('idempotency-key') || null), 'Review your purchase'));
export const authorize = asyncHandler(async (req, res) =>
  created(res, await billService.startAuthorization(req.user, v(req).params.id, req.body, req), 'Approve this purchase'));
export const confirm = asyncHandler(async (req, res) =>
  ok(res, await billService.confirm(req.user, v(req).params.id, req.body, req), 'Approved. Redirecting to secure payment'));
export const resumeCheckout = asyncHandler(async (req, res) => ok(res, await billService.resumeCheckout(req.user, v(req).params.id)));
export const cancel = asyncHandler(async (req, res) => ok(res, await billService.cancel(req.user, v(req).params.id), 'Cancelled'));

// History & receipts ---------------------------------------------------------------------------------
export const history = asyncHandler(async (req, res) => paged(res, await billService.list(req.user, v(req).query)));
export const detail = asyncHandler(async (req, res) => ok(res, await billService.get(req.user, v(req).params.id)));
export const receipt = asyncHandler(async (req, res) => ok(res, await billService.receipt(req.user, v(req).params.id)));
export const secrets = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  return ok(res, await billService.revealSecrets(req.user, v(req).params.id, req));
});
export const requery = asyncHandler(async (req, res) => ok(res, await billService.requery(req.user, v(req).params.id)));

// Admin ----------------------------------------------------------------------------------------------
export const adminList = asyncHandler(async (req, res) => paged(res, await billService.listAll(v(req).query)));
export const adminDetail = asyncHandler(async (req, res) => ok(res, await billService.adminDetail(v(req).params.id)));
export const adminReconcile = asyncHandler(async (req, res) => ok(res, await billService.reconcile(v(req).params.id, req.user)));
export const providerStatus = asyncHandler(async (_req, res) => ok(res, await billService.providerStatus()));
export const revenue = asyncHandler(async (req, res) => ok(res, await billService.revenue(v(req).query)));
export const adminServices = asyncHandler(async (_req, res) => ok(res, await billService.adminServices()));
export const refreshCatalog = asyncHandler(async (req, res) => ok(res, await billService.refreshCatalog(req.user)));
export const toggleService = asyncHandler(async (req, res) =>
  ok(res, await billService.setServiceControl(req.user, v(req).params.serviceId, req.body, req)));
export const reconciliation = asyncHandler(async (req, res) => paged(res, await billService.listReconciliation(v(req).query)));
export const resolveReconciliation = asyncHandler(async (req, res) =>
  ok(res, await billService.resolveReconciliation(req.user, v(req).params.id, req.body.note, req)));

// VTpass callback (unauthenticated, untrusted body: it only triggers our own requery)
export const vtpassWebhook = async (req, res) => {
  // Acknowledge promptly, as VTpass requires; processing continues in the background.
  res.status(200).json({ response: 'success' });
  billService.handleWebhook(req.body).catch(() => {});
};
