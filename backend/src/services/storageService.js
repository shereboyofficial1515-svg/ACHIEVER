import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../integrations/supabase/client.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

/** Server-generated, unguessable object path; the user's filename is never used as a path. */
export function objectPath(prefix, ext) {
  return `${prefix}/${crypto.randomUUID()}.${ext}`;
}

export async function upload(bucket, path, file) {
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, file.buffer, {
    contentType: file.detectedMime,
    upsert: false,
    cacheControl: '3600',
  });
  if (error) {
    logger.error({ bucket, message: error.message }, 'storage upload failed');
    throw AppError.unavailable('File upload failed. Please try again.', 'UPLOAD_FAILED');
  }
  return path;
}

export async function remove(bucket, path) {
  if (!path) return;
  const { error } = await supabaseAdmin.storage.from(bucket).remove([path]);
  if (error) logger.warn({ bucket, message: error.message }, 'storage remove failed');
}

/** Short-lived signed URL for private buckets. */
export async function signedUrl(bucket, path, expiresInSeconds = 300, downloadName) {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds, downloadName ? { download: downloadName } : undefined);
  if (error) {
    logger.error({ bucket, message: error.message }, 'signed url failed');
    throw AppError.unavailable('File is temporarily unavailable', 'FILE_UNAVAILABLE');
  }
  return data.signedUrl;
}

export function publicUrl(bucket, path) {
  if (!path) return null;
  return `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}
