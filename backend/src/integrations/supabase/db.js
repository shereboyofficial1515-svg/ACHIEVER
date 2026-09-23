import { supabaseAdmin } from './client.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

const APP_ERROR = /^ACH:(\d{3}):([A-Z0-9_]+):(.*)$/s;

/**
 * Translate a PostgREST / Postgres error into an AppError. Business rule
 * violations raised by our SQL functions ("ACH:<status>:<CODE>:<message>")
 * are surfaced; everything else becomes an opaque 500.
 */
export function translateDbError(error, context) {
  const match = APP_ERROR.exec(error?.message || '');
  if (match) return new AppError(Number(match[1]), match[2], match[3]);
  if (error?.code === '23505') return AppError.conflict('This record already exists', 'DUPLICATE');
  if (error?.code === '23503') return AppError.unprocessable('A related record does not exist', 'INVALID_REFERENCE');
  if (error?.code === '23514') return AppError.unprocessable('A value is outside the permitted range', 'CONSTRAINT_VIOLATION');
  logger.error({ err: { message: error?.message, code: error?.code, hint: error?.hint }, context }, 'database error');
  const e = new AppError(500, 'DATABASE_ERROR', 'We could not complete your request');
  e.expose = false;
  return e;
}

/** Unwrap a supabase-js result, throwing on error. */
export async function run(query, context) {
  const { data, error } = await query;
  if (error) throw translateDbError(error, context);
  return data;
}

/** Same as run() but returns { data, count } for paginated queries. */
export async function runPaged(query, context) {
  const { data, error, count } = await query;
  if (error) throw translateDbError(error, context);
  return { rows: data ?? [], total: count ?? 0 };
}

/** Like run() for maybeSingle() queries; throws 404 when missing if a message is given. */
export async function one(query, notFoundMessage, context) {
  const { data, error } = await query;
  if (error) throw translateDbError(error, context);
  if (!data && notFoundMessage) throw AppError.notFound(notFoundMessage);
  return data;
}

export async function rpc(fn, params = {}) {
  const { data, error } = await supabaseAdmin.rpc(fn, params);
  if (error) throw translateDbError(error, `rpc:${fn}`);
  return data;
}

export const db = supabaseAdmin;
