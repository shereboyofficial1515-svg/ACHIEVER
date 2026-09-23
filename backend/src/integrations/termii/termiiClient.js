import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Termii SMS (https://developers.termii.com/messaging-api).
 * Returns { ok, messageId?, error? } and never throws, so an SMS outage can
 * never break a financial flow; callers record the failure for retry.
 */
export async function sendSms({ to, message }) {
  if (!env.features.sms) {
    return { ok: false, error: 'SMS_NOT_CONFIGURED' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${env.TERMII_BASE_URL}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.TERMII_API_KEY,
        to: to.replace(/^\+/, ''),
        from: env.TERMII_SENDER_ID,
        sms: message.slice(0, 480),
        type: 'plain',
        channel: env.TERMII_CHANNEL,
      }),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json.code && json.code !== 'ok')) {
      logger.warn({ httpStatus: res.status, message: json.message }, 'termii send failed');
      return { ok: false, error: json.message || `HTTP_${res.status}` };
    }
    return { ok: true, messageId: json.message_id };
  } catch (err) {
    logger.warn({ err: err.message }, 'termii unreachable');
    return { ok: false, error: 'SMS_PROVIDER_UNREACHABLE' };
  } finally {
    clearTimeout(timer);
  }
}
