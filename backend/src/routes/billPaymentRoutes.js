import { Router } from 'express';
import * as b from '../controllers/billPaymentController.js';
import { idempotent } from '../middleware/idempotency.js';
import { paymentLimiter } from '../middleware/rateLimiters.js';
import { validate } from '../middleware/validate.js';
import * as s from '../validators/billValidators.js';
import { idParam } from '../validators/common.js';

/**
 * /api/bills — Bills & Services. The client never talks to VTpass: every
 * call here goes through the backend, which holds the credentials.
 */
const r = Router();

// Catalogue (normalised ACHIEVER data, not raw VTpass responses)
r.get('/overview', b.overview);
r.get('/services', validate({ query: s.categoryQuery }), b.services);
r.get('/airtime/networks', b.servicesFor('airtime'));
r.get('/data/networks', b.servicesFor('data'));
r.get('/data/:serviceId/plans', validate({ params: s.serviceParams }), b.dataPlans);
r.get('/electricity/providers', b.servicesFor('electricity'));
r.get('/tv/providers', b.servicesFor('tv'));
r.get('/education/providers', b.servicesFor('education'));
r.get('/betting/providers', b.servicesFor('betting'));
r.get('/recharge-pin/providers', b.servicesFor('recharge_pin'));
r.get('/:category/:serviceId/products', validate({ params: s.categoryServiceParams }), b.products);
r.post('/verify', paymentLimiter, validate({ body: s.verify }), b.verify);

// Enter details -> review (quote) -> approve (PIN + email code, or biometric) -> pay -> deliver
r.post('/quote', paymentLimiter, idempotent, validate({ body: s.quote }), b.quote);
r.post('/:id/authorize', paymentLimiter, validate({ params: idParam, body: s.authorize }), b.authorize);
r.post('/:id/confirm', paymentLimiter, idempotent, validate({ params: idParam, body: s.confirm }), b.confirm);
r.post('/:id/checkout', paymentLimiter, validate({ params: idParam }), b.resumeCheckout);
r.post('/:id/cancel', validate({ params: idParam }), b.cancel);

// History, status and receipts
r.get('/history', validate({ query: s.history }), b.history);
r.get('/history/:id', validate({ params: idParam }), b.detail);
r.get('/history/:id/receipt', validate({ params: idParam }), b.receipt);
r.post('/history/:id/secrets', paymentLimiter, validate({ params: idParam }), b.secrets);
r.post('/history/:id/requery', paymentLimiter, validate({ params: idParam }), b.requery);

export default r;
