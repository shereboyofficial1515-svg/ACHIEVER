import * as business from '../services/businessWalletService.js';
import { listBanks } from '../services/paymentService.js';
import { asyncHandler, created, ok } from '../utils/http.js';

const v = (req) => req.validated;
const noStore = (res) => res.set('Cache-Control', 'no-store');

// Admin finance: business wallet (platform revenue), company payout account, provider float.
export const overview = asyncHandler(async (req, res) => ok(noStore(res), await business.overview()));
export const vtpassCheck = asyncHandler(async (req, res) => ok(noStore(res), await business.vtpassCheck(req.user, req), 'Health check finished'));
export const accounts = asyncHandler(async (req, res) => ok(noStore(res), await business.listAccounts()));
export const proposeAccount = asyncHandler(async (req, res) => created(res, await business.proposeAccount(req.user, v(req).body, req), 'Sent to a second administrator for approval'));
export const decideAccount = asyncHandler(async (req, res) => ok(res, await business.decideAccount(req.user, v(req).params.id, v(req).body, req), 'Decision recorded'));
export const withdrawals = asyncHandler(async (req, res) => ok(noStore(res), await business.listWithdrawals(v(req).query)));
export const requestWithdrawal = asyncHandler(async (req, res) =>
  created(res, await business.requestWithdrawal(req.user, v(req).body, req.get('idempotency-key') || null, req), 'Withdrawal submitted'));
export const decideWithdrawal = asyncHandler(async (req, res) => ok(res, await business.decideWithdrawal(req.user, v(req).params.id, v(req).body, req), 'Decision recorded'));
export const cancelWithdrawal = asyncHandler(async (req, res) => ok(res, await business.cancelWithdrawal(req.user, v(req).params.id), 'Cancelled'));
export const banks = asyncHandler(async (req, res) => ok(res, await listBanks()));
