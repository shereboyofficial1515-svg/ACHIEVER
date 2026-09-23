import { env } from '../config/env.js';
import * as settingsRepo from '../repositories/settingsRepository.js';
import { AppError } from '../utils/AppError.js';

const cache = new Map();
const TTL_MS = 60_000;

export async function get(key, fallback = null) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const row = await settingsRepo.get(key);
  const value = row ? row.value : fallback;
  cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

export function list() {
  return settingsRepo.getAll();
}

const VALIDATORS = {
  'undertaking.current_version': (v) => typeof v === 'string' && /^[\w.-]{3,40}$/.test(v),
  'risk.large_collector_contribution_kobo': (v) => Number.isSafeInteger(v) && v > 0,
  'risk.failed_payments_threshold': (v) => Number.isInteger(v) && v >= 1 && v <= 100,
  'notifications.sms_daily_cap': (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  'payouts.execution_mode': (v) => v === 'manual' || v === 'paystack_transfer',
  'platform.maintenance_mode': (v) => typeof v === 'boolean',
};

export async function update(key, value, actorId) {
  const valid = VALIDATORS[key];
  if (!valid) throw AppError.badRequest('Unknown setting', 'UNKNOWN_SETTING');
  if (!valid(value)) throw AppError.badRequest('Invalid value for this setting', 'INVALID_SETTING_VALUE');
  if (key === 'payouts.execution_mode' && value === 'paystack_transfer' && !env.features.transfers) {
    throw AppError.unprocessable('Enable Paystack Transfers (PAYSTACK_TRANSFERS_ENABLED) before switching payout mode', 'TRANSFERS_DISABLED');
  }
  const row = await settingsRepo.set(key, value, actorId);
  cache.delete(key);
  return row;
}

/** Effective payout mode: automated transfers only when configured AND enabled. */
export async function payoutMode() {
  const mode = await get('payouts.execution_mode', 'manual');
  return mode === 'paystack_transfer' && env.features.transfers ? 'paystack_transfer' : 'manual';
}

export async function assertPaymentsOpen() {
  if (await get('platform.maintenance_mode', false)) {
    throw AppError.unavailable('Payments are paused for scheduled maintenance. Please try again later.', 'MAINTENANCE_MODE');
  }
}
