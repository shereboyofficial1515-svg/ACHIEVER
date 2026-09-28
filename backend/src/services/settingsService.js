import { env } from '../config/env.js';
import * as settingsRepo from '../repositories/settingsRepository.js';
import * as adminRepo from '../repositories/adminRepository.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { withTimeout } from '../utils/timeout.js';

/**
 * Platform settings. Each row is typed in the database (value_type, range,
 * options — enforced by a trigger); this module adds rules that need
 * application context, requires a reason for every change, and writes an
 * append-only history row plus an audit record.
 */
const cache = new Map();
const TTL_MS = 30_000;
const FAILURE_TTL_MS = 10_000;
const READ_TIMEOUT_MS = 1_500;

/**
 * Settings are read on hot paths (maintenance gate, code rules), so a slow or
 * failing database must never stall requests: reads time out quickly and the
 * last known value (or the safe default) is used for a short while.
 */
export async function get(key, fallback = null) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value;
  try {
    const row = await withTimeout(settingsRepo.get(key), READ_TIMEOUT_MS, `setting ${key}`);
    value = row ? row.value : fallback;
  } catch {
    value = hit ? hit.value : fallback;
    cache.set(key, { value, expires: Date.now() + FAILURE_TTL_MS });
    return value;
  }
  cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

export async function getInt(key, fallback) {
  const v = Number(await get(key, fallback));
  return Number.isInteger(v) ? v : fallback;
}

export async function getBool(key, fallback) {
  const v = await get(key, fallback);
  return typeof v === 'boolean' ? v : fallback;
}

export function clearCache() {
  cache.clear();
}

export function list() {
  return settingsRepo.getAll();
}

export function history(key) {
  return adminRepo.settingHistory(key);
}

// Rules the database cannot know about.
const RULES = {
  'kyc.required_levels': (v) => (v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).every((k) => ['contribute', 'receive_payout', 'withdraw', 'operator'].includes(k))
    && Object.values(v).every((n) => Number.isInteger(n) && n >= 0 && n <= 3)
    && (v.withdraw ?? 2) >= 2 && (v.operator ?? 2) >= 2)
    || 'Withdrawals and operators need at least level 2 (government ID); levels are 0–3',
  'undertaking.current_version': (v) => (typeof v === 'string' && /^[\w.-]{3,40}$/.test(v)) || 'Use 3–40 letters, numbers, dots or dashes',
  'payouts.execution_mode': (v) => v !== 'paystack_transfer' || env.features.transfers
    || 'Enable Paystack Transfers (PAYSTACK_TRANSFERS_ENABLED) before switching payout mode',
  'sms.verification_enabled': (v) => v !== true || env.features.sms
    || 'Termii is not configured on the server (TERMII_API_KEY / TERMII_SENDER_ID), so SMS verification cannot be turned on',
  'sms.notifications_enabled': (v) => v !== true || env.features.sms
    || 'Termii is not configured on the server, so SMS notifications cannot be turned on',
};

/** Human description of what a change does (shown before confirming, stored with the audit). */
export const WARNINGS = {
  'sms.verification_enabled': {
    false: 'SMS verification will be disabled for applicable account verification flows. Users will use the configured fallback verification method (email). Continue?',
    true: 'Users will be asked to verify their phone by SMS again. Accounts verified with the email fallback keep their access. Continue?',
  },
  'platform.maintenance_mode': {
    true: 'Members will see a maintenance notice and cannot use the app until this is turned off. The admin platform stays available.',
  },
  'registration.enabled': { false: 'Nobody will be able to create a new ACHIEVER account until this is turned back on.' },
  'auth.login_max_attempts': { any: 'Changes how many wrong passwords lock an account.' },
};

const AUDIT_ACTIONS = {
  'sms.verification_enabled': (v) => (v ? 'admin.sms.verification_enabled' : 'admin.sms.verification_disabled'),
  'sms.notifications_enabled': (v) => (v ? 'admin.sms.notifications_enabled' : 'admin.sms.notifications_disabled'),
  'platform.maintenance_mode': (v) => (v ? 'admin.maintenance.enabled' : 'admin.maintenance.disabled'),
};

export async function update(key, value, actor, { reason, req } = {}) {
  if (!reason || String(reason).trim().length < 5) {
    throw AppError.unprocessable('Give a reason (at least 5 characters) for this change', 'REASON_REQUIRED');
  }
  const current = await settingsRepo.getFull(key);
  if (!current) throw AppError.badRequest('Unknown setting', 'UNKNOWN_SETTING');
  const rule = RULES[key];
  const verdict = rule ? rule(value) : true;
  if (verdict !== true) throw AppError.unprocessable(typeof verdict === 'string' ? verdict : 'Invalid value for this setting', 'INVALID_SETTING_VALUE');
  if (JSON.stringify(current.value) === JSON.stringify(value)) {
    throw AppError.conflict('The setting already has this value', 'SETTING_UNCHANGED');
  }

  const row = await settingsRepo.set(key, value, actor.id); // typed check happens in the database
  cache.delete(key);
  await adminRepo.insertSettingChange({
    setting_key: key, previous_value: current.value, new_value: value, reason: String(reason).trim().slice(0, 1000),
    actor_id: actor.id, admin_session_id: req?.adminSession?.id ?? null, request_id: req?.id ?? null,
  });
  await auditService.record({
    actorId: actor.id,
    action: AUDIT_ACTIONS[key]?.(value) ?? 'admin.settings.changed',
    resourceType: 'app_setting',
    resourceId: key,
    reason,
    permission: 'settings.manage',
    previousState: { value: current.value },
    newState: { value },
    req,
  });
  return row;
}

/** Effective payout mode: automated transfers only when configured AND enabled. */
export async function payoutMode() {
  const mode = await get('payouts.execution_mode', 'manual');
  return mode === 'paystack_transfer' && env.features.transfers ? 'paystack_transfer' : 'manual';
}

export async function maintenanceMode() {
  return getBool('platform.maintenance_mode', false);
}

export async function assertPaymentsOpen() {
  if (await maintenanceMode()) {
    throw AppError.unavailable('Payments are paused for scheduled maintenance. Please try again later.', 'MAINTENANCE_MODE');
  }
}
