import * as paymentService from '../services/paymentService.js';
import * as callService from '../services/callService.js';
import { logger } from '../utils/logger.js';
import { asyncHandler, ok } from '../utils/http.js';

const v = (req) => req.validated;

export const status = asyncHandler(async (req, res) => ok(res, await paymentService.statusForUser(req.user, v(req).params.reference)));

export const listTransactions = asyncHandler(async (req, res) => {
  const { rows, total } = await paymentService.listTransactions(req.user.id, v(req).query);
  const { page, pageSize } = v(req).query;
  return ok(res, rows.map((t) => ({ ...t, amount: Number(t.amount) })), 'OK', 200, { page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

export const getTransaction = asyncHandler(async (req, res) => {
  const tx = await paymentService.getTransaction(req.user, v(req).params.id);
  return ok(res, { ...tx, amount: Number(tx.amount) });
});

export const banks = asyncHandler(async (_req, res) => ok(res, await paymentService.listBanks()));

/**
 * Paystack webhook. Signature is verified over the RAW body before anything
 * is parsed or stored. Always 200 after durable storage so Paystack does not
 * hammer us; our own job retries processing failures.
 */
export const paystackWebhook = asyncHandler(async (req, res) => {
  const result = await paymentService.handleWebhook(req.body, req.get('x-paystack-signature'), req);
  return res.status(200).json({ success: true, ...result });
});

export const livekitWebhook = async (req, res) => {
  try {
    await callService.handleLivekitWebhook(req.body.toString('utf8'), req.get('authorization'));
    res.status(200).json({ success: true });
  } catch (err) {
    logger.warn({ err: err.message }, 'livekit webhook rejected');
    res.status(401).json({ success: false, message: 'Invalid webhook', error: { code: 'INVALID_SIGNATURE' } });
  }
};
