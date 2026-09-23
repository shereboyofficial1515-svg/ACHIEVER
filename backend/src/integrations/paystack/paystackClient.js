import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

/**
 * Thin client over the documented Paystack REST API
 * (https://paystack.com/docs/api/). Secret key never leaves the server.
 */
async function request(method, path, body, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${env.PAYSTACK_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    logger.warn({ path, err: err.message }, 'paystack request failed');
    throw AppError.unavailable('Payment provider is unreachable. Please try again.', 'PAYSTACK_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok || json.status === false) {
    logger.warn({ path, httpStatus: res.status, message: json.message }, 'paystack error response');
    const err = new AppError(
      res.status >= 500 ? 503 : 502,
      'PAYSTACK_ERROR',
      json.message || 'Payment provider returned an error',
    );
    err.providerStatus = res.status;
    throw err;
  }
  return json.data;
}

export const paystack = {
  /** POST /transaction/initialize — amount in kobo. */
  initializeTransaction({ email, amount, reference, callbackUrl, metadata, channels }) {
    return request('POST', '/transaction/initialize', {
      email,
      amount,
      currency: 'NGN',
      reference,
      callback_url: callbackUrl,
      metadata,
      channels,
    });
  },

  /** GET /transaction/verify/:reference */
  verifyTransaction(reference) {
    return request('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  },

  /** POST /refund — refunds a charged transaction (full amount unless specified). */
  createRefund({ transactionReference, amount, merchantNote }) {
    return request('POST', '/refund', {
      transaction: transactionReference,
      ...(amount ? { amount } : {}),
      merchant_note: merchantNote,
    });
  },

  /** GET /bank?country=nigeria */
  listBanks() {
    return request('GET', '/bank?country=nigeria&perPage=100');
  },

  /** GET /bank/resolve */
  resolveAccount({ accountNumber, bankCode }) {
    return request(
      'GET',
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
  },

  /** POST /transferrecipient */
  createTransferRecipient({ name, accountNumber, bankCode }) {
    return request('POST', '/transferrecipient', {
      type: 'nuban',
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN',
    });
  },

  /** POST /transfer — reference must be unique per transfer attempt. */
  initiateTransfer({ amount, recipientCode, reference, reason }) {
    return request('POST', '/transfer', {
      source: 'balance',
      amount,
      recipient: recipientCode,
      reference,
      reason,
    });
  },
};
