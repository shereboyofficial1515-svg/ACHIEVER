import { Router } from 'express';
import * as w from '../controllers/walletController.js';
import { idempotent } from '../middleware/idempotency.js';
import { paymentLimiter } from '../middleware/rateLimiters.js';
import { validate } from '../middleware/validate.js';
import * as s from '../validators/walletValidators.js';
import { idParam } from '../validators/common.js';

/**
 * /api/wallet — ACHIEVER Wallet. Every money movement is:
 * review -> approve (PIN / PIN + emailed code / device biometric) -> server executes.
 * The client never sets a balance or a status.
 */
const r = Router();

r.get('/', w.summary);
r.get('/transactions', validate({ query: s.history }), w.transactions);
r.get('/transactions/:id', validate({ params: idParam }), w.receipt);

// Add money (Paystack). Credited only after server-side verification.
r.post('/topups', paymentLimiter, idempotent, validate({ body: s.topup }), w.startTopup);
r.get('/topups/:id', validate({ params: idParam }), w.topupStatus);

// Send money to another ACHIEVER Wallet
r.post('/recipients/resolve', paymentLimiter, validate({ body: s.resolve }), w.resolveRecipient);
r.post('/transfers', paymentLimiter, idempotent, validate({ body: s.transfer }), w.startTransfer);
r.post('/transfers/:id/authorize', paymentLimiter, validate({ params: idParam, body: s.approve }), w.authorizeTransfer);
r.post('/transfers/:id/confirm', paymentLimiter, idempotent, validate({ params: idParam, body: s.confirm }), w.confirmTransfer);
r.post('/transfers/:id/cancel', validate({ params: idParam }), w.cancelTransfer);

// Pay OSUSU contributions / collector savings from the wallet
r.post('/payments/authorize', paymentLimiter, validate({ body: s.payAuthorize }), w.authorizePayment);
r.post('/payments/confirm', paymentLimiter, idempotent, validate({ body: s.payConfirm }), w.confirmPayment);

// Automatic payments (explicitly authorised; pause or cancel any time)
r.get('/mandates', w.mandates);
r.post('/mandates', paymentLimiter, validate({ body: s.mandate }), w.createMandate);
r.post('/mandates/:id/authorize', paymentLimiter, validate({ params: idParam, body: s.approve }), w.authorizeMandate);
r.post('/mandates/:id/confirm', paymentLimiter, idempotent, validate({ params: idParam, body: s.confirm }), w.confirmMandate);
r.post('/mandates/:id/state', validate({ params: idParam, body: s.mandateAction }), w.mandateAction);

export default r;
