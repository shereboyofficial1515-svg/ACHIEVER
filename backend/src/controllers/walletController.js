import * as walletService from '../services/walletService.js';
import { asyncHandler, created, ok, paged } from '../utils/http.js';

const v = (req) => req.validated;
const key = (req) => req.get('idempotency-key') || null;
const noStore = (res) => res.set('Cache-Control', 'no-store');

// Member ---------------------------------------------------------------------------------------------
export const summary = asyncHandler(async (req, res) => ok(noStore(res), await walletService.summary(req.user)));
export const transactions = asyncHandler(async (req, res) => paged(noStore(res), await walletService.transactions(req.user, v(req).query)));
export const receipt = asyncHandler(async (req, res) => ok(noStore(res), await walletService.receipt(req.user, v(req).params.id)));

export const startTopup = asyncHandler(async (req, res) =>
  created(res, await walletService.startTopup(req.user, req.body, key(req)), 'Redirecting to secure payment'));
export const topupStatus = asyncHandler(async (req, res) => ok(noStore(res), await walletService.topupStatus(req.user, v(req).params.id)));

export const resolveRecipient = asyncHandler(async (req, res) => ok(res, await walletService.resolveRecipient(req.user, req.body.walletId)));
export const startTransfer = asyncHandler(async (req, res) =>
  created(res, await walletService.startTransfer(req.user, { walletCode: req.body.walletId, amount: req.body.amount, note: req.body.note }, key(req)), 'Review your transfer'));
export const authorizeTransfer = asyncHandler(async (req, res) =>
  created(res, await walletService.authorizeTransfer(req.user, v(req).params.id, req.body, req), 'Approve this transfer'));
export const confirmTransfer = asyncHandler(async (req, res) =>
  ok(res, await walletService.confirmTransfer(req.user, v(req).params.id, req.body, req), 'Transfer complete'));
export const cancelTransfer = asyncHandler(async (req, res) => ok(res, await walletService.cancelTransfer(req.user, v(req).params.id), 'Cancelled'));

export const authorizePayment = asyncHandler(async (req, res) =>
  created(res, await walletService.authorizePayment(req.user, req.body, req), 'Approve this payment'));
export const confirmPayment = asyncHandler(async (req, res) =>
  ok(res, await walletService.confirmPayment(req.user, req.body, req), 'Payment successful'));

export const mandates = asyncHandler(async (req, res) => ok(res, await walletService.listMandates(req.user)));
export const createMandate = asyncHandler(async (req, res) => created(res, await walletService.createMandate(req.user, req.body), 'Review automatic payments'));
export const authorizeMandate = asyncHandler(async (req, res) =>
  created(res, await walletService.authorizeMandate(req.user, v(req).params.id, req.body, req), 'Approve automatic payments'));
export const confirmMandate = asyncHandler(async (req, res) =>
  ok(res, await walletService.confirmMandate(req.user, v(req).params.id, req.body, req), 'Automatic payments are on'));
export const mandateAction = asyncHandler(async (req, res) =>
  ok(res, await walletService.setMandateState(req.user, v(req).params.id, req.body.action, req.body.reason, req), 'Updated'));

// Admin ----------------------------------------------------------------------------------------------
const canUnmask = (req) => Boolean(req.user?.permissions?.includes?.('users.read_sensitive'));
export const adminStats = asyncHandler(async (_req, res) => ok(res, await walletService.adminStats()));
export const adminSearch = asyncHandler(async (req, res) => paged(res, await walletService.adminSearch(v(req).query, { unmask: canUnmask(req) })));
export const adminAccount = asyncHandler(async (req, res) => ok(res, await walletService.adminAccount(v(req).params.id)));
export const adminLedger = asyncHandler(async (req, res) => ok(res, await walletService.adminLedger(v(req).params.id)));
export const adminSetStatus = asyncHandler(async (req, res) => ok(res, await walletService.adminSetStatus(req.user, v(req).params.id, req.body, req), 'Wallet updated'));
export const adminRequestAdjustment = asyncHandler(async (req, res) =>
  created(res, await walletService.adminRequestAdjustment(req.user, v(req).params.id, req.body, req), 'Adjustment requested. A second administrator must approve it.'));
export const adminAdjustments = asyncHandler(async (req, res) => ok(res, await walletService.adminAdjustments(v(req).query.status)));
export const adminDecideAdjustment = asyncHandler(async (req, res) =>
  ok(res, await walletService.adminDecideAdjustment(req.user, v(req).params.id, req.body), 'Decision recorded'));
export const adminTransfersForReview = asyncHandler(async (_req, res) => ok(res, await walletService.adminTransfersForReview()));
export const adminReviewTransfer = asyncHandler(async (req, res) =>
  ok(res, await walletService.adminReviewTransfer(req.user, v(req).params.id, req.body), 'Decision recorded'));
