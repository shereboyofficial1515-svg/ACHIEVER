import { Resend } from 'resend';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const client = env.features.email ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Send an email through Resend. Never throws: returns { ok, id?, error? } so
 * callers can record delivery status and retry.
 */
export async function sendEmail({ to, subject, html, text, idempotencyKey, headers }) {
  if (!client) return { ok: false, error: 'EMAIL_NOT_CONFIGURED' };
  try {
    const { data, error } = await client.emails.send(
      { from: env.RESEND_FROM_EMAIL, to, subject, html, text, replyTo: env.SUPPORT_EMAIL, ...(headers ? { headers } : {}) },
      idempotencyKey ? { idempotencyKey } : undefined,
    );
    if (error) {
      logger.warn({ name: error.name, message: error.message }, 'resend send failed');
      return { ok: false, error: error.message || 'EMAIL_SEND_FAILED' };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    logger.warn({ err: err.message }, 'resend unreachable');
    return { ok: false, error: 'EMAIL_PROVIDER_UNREACHABLE' };
  }
}
