import { env } from '../config/env.js';
import { sendSms } from '../integrations/termii/termiiClient.js';
import * as notificationRepo from '../repositories/notificationRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as settingsService from './settingsService.js';
import * as emailService from './emailService.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

const MAX_ATTEMPTS = 3;
// Security notifications are not a preference: they are always delivered.
export const CATEGORIES = ['payments', 'reminders', 'payouts', 'meetings', 'groups', 'messages', 'account', 'support', 'system', 'marketing'];

/**
 * Create an in-app notification; email/SMS delivery is decided in SQL from the
 * user's preferences and delivered by the outbox dispatcher.
 */
export async function notify(userId, { type, category, title, body, data = {}, dedupeKey = null }) {
  const id = await notificationRepo.enqueue({ userId, type, category, title, body, data, dedupeKey });
  if (id) kickDispatcher();
  return id;
}

let kickTimer = null;
/** Debounced trigger so bursts of notifications are sent in one pass. */
export function kickDispatcher() {
  if (env.isTest || kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    dispatchPending().catch((err) => logger.error({ err: err.message }, 'notification dispatch failed'));
  }, 500);
}

function deepLink(data = {}) {
  const base = `${env.CLIENT_URL}/app`;
  if (data.group_id) return `${base}/osusu/${data.group_id}`;
  if (data.plan_id) return `${base}/collector/plans/${data.plan_id}`;
  if (data.bill_payment_id) return `${base}/bills/${data.bill_payment_id}`;
  if (data.meeting_id) return `${base}/meetings`;
  if (data.transaction_id) return `${base}/transactions`;
  return base;
}

async function deliver(item, profile, channel, smsCap) {
  const attempts = item[`${channel}_attempts`];
  if (!(await notificationRepo.claimChannel(item.id, channel, attempts))) return; // another worker has it

  let result;
  if (channel === 'email') {
    result = await emailService.sendNotificationEmail(item, profile, deepLink(item.data));
  } else {
    if (item.category !== 'security') {
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      const sent = await notificationRepo.countSmsSentToday(item.user_id, since.toISOString());
      if (sent >= smsCap) {
        await notificationRepo.setChannelStatus(item.id, 'sms', 'skipped', 'daily SMS cap reached');
        return;
      }
    }
    result = await sendSms({ to: profile.phone, message: `ACHIEVER: ${item.body}` });
  }

  if (result.ok) {
    await notificationRepo.setChannelStatus(item.id, channel, 'sent');
  } else if (['EMAIL_NOT_CONFIGURED', 'SMS_NOT_CONFIGURED'].includes(result.error) || attempts + 1 >= MAX_ATTEMPTS) {
    await notificationRepo.setChannelStatus(item.id, channel, result.error?.endsWith('NOT_CONFIGURED') ? 'skipped' : 'failed', result.error);
  }
  // otherwise stays 'pending' for the next dispatcher run (retry)
}

export async function dispatchPending(limit = 50) {
  const items = await notificationRepo.listOutbox(limit);
  if (!items.length) return 0;
  const smsCap = Number(await settingsService.get('notifications.sms_daily_cap', 10));
  const profiles = new Map();
  for (const item of items) {
    if (!profiles.has(item.user_id)) profiles.set(item.user_id, await userRepo.findById(item.user_id));
    const profile = profiles.get(item.user_id);
    if (!profile) continue;
    try {
      if (item.email_status === 'pending') await deliver(item, profile, 'email', smsCap);
      if (item.sms_status === 'pending') await deliver(item, profile, 'sms', smsCap);
    } catch (err) {
      logger.warn({ id: item.id, err: err.message }, 'notification delivery error');
    }
  }
  return items.length;
}

// User-facing API -------------------------------------------------------------
export function list(userId, opts) {
  return notificationRepo.list(userId, opts);
}

export function unreadCount(userId) {
  return notificationRepo.unreadCount(userId);
}

export async function markRead(userId, id) {
  await notificationRepo.markRead(userId, id);
}

export function markAllRead(userId) {
  return notificationRepo.markAllRead(userId);
}

export async function getPreferences(userId) {
  const prefs = (await userRepo.getPreferences(userId)) || { email_enabled: true, sms_enabled: true, category_settings: {} };
  const defaults = {
    payments: { email: true, sms: true },
    reminders: { email: true, sms: true },
    payouts: { email: true, sms: true },
    meetings: { email: true, sms: false },
    groups: { email: true, sms: false },
    messages: { email: false, sms: false },
    account: { email: true, sms: false },
    support: { email: true, sms: false },
    system: { email: false, sms: false },
    marketing: { email: false, sms: false },
  };
  const categories = {};
  for (const c of CATEGORIES) categories[c] = { ...defaults[c], ...(prefs.category_settings?.[c] || {}) };
  return { emailEnabled: prefs.email_enabled, smsEnabled: prefs.sms_enabled, categories };
}

/** One-click unsubscribe from a non-transactional category (signed link in the email). */
export async function unsubscribe(userId, category, token) {
  if (!['system', 'marketing'].includes(category) || !emailService.verifyUnsubscribe(userId, category, token)) {
    throw AppError.badRequest('This unsubscribe link is invalid', 'INVALID_UNSUBSCRIBE');
  }
  const current = await getPreferences(userId);
  const categories = { ...current.categories, [category]: { ...current.categories[category], email: false } };
  await updatePreferences(userId, { emailEnabled: current.emailEnabled, smsEnabled: current.smsEnabled, categories });
}

export async function updatePreferences(userId, { emailEnabled, smsEnabled, categories }) {
  const categorySettings = {};
  for (const [key, value] of Object.entries(categories || {})) {
    if (!CATEGORIES.includes(key)) throw AppError.badRequest('Unknown notification category');
    categorySettings[key] = { email: Boolean(value.email), sms: Boolean(value.sms) };
  }
  await userRepo.upsertPreferences(userId, {
    email_enabled: emailEnabled,
    sms_enabled: smsEnabled,
    category_settings: categorySettings,
  });
  return getPreferences(userId);
}
