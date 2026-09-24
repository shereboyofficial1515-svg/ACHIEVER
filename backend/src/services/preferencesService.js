import * as userRepo from '../repositories/userRepository.js';
import * as auditService from './auditService.js';

/**
 * Per-user settings. Every option here is wired to real behaviour:
 *  - accessibility: applied by the web app to the whole UI (font size, motion,
 *    contrast, touch targets, link underlines, focus rings)
 *  - messages: message sound, call ringtone, message previews in alerts,
 *    automatic image loading (client); read receipts (server, reciprocal)
 *  - privacy: online status visibility (server)
 *  - security: sign-in alert emails (server)
 * Security notifications themselves can never be disabled.
 */
export const DEFAULTS = Object.freeze({
  accessibility: {
    fontScale: 1, reducedMotion: 'system', highContrast: false, largerTargets: false, underlineLinks: false, strongFocus: false,
  },
  messages: { messageSound: true, callRingtone: true, messagePreview: true, autoLoadImages: true, readReceipts: true },
  privacy: { showOnlineStatus: true },
  security: { loginAlerts: 'new_device' },
});

const merge = (row) => Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, { ...d, ...(row?.[k] || {}) }]));

export async function get(userId) {
  return merge(await userRepo.getUserPreferences(userId));
}

export async function update(userId, patch, req) {
  const current = await get(userId);
  const next = { user_id: userId };
  for (const section of Object.keys(DEFAULTS)) {
    next[section] = { ...current[section], ...(patch[section] || {}) };
  }
  await userRepo.upsertUserPreferences(next);
  await auditService.record({ actorId: userId, action: 'settings.preferences.update', resourceType: 'profile', resourceId: userId, metadata: { sections: Object.keys(patch) }, req });
  return get(userId);
}

/** Message/privacy flags for many users at once (used by chat formatting). */
export async function flagsFor(userIds) {
  const rows = await userRepo.listUserPreferences([...new Set(userIds)]);
  const byId = new Map(rows.map((r) => [r.user_id, r]));
  return (id) => ({
    readReceipts: (byId.get(id)?.messages?.readReceipts ?? DEFAULTS.messages.readReceipts) !== false,
    showOnlineStatus: (byId.get(id)?.privacy?.showOnlineStatus ?? DEFAULTS.privacy.showOnlineStatus) !== false,
  });
}
