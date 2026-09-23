import multer from 'multer';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

export function notFound(req, _res, next) {
  next(AppError.notFound('The requested endpoint does not exist', 'ROUTE_NOT_FOUND'));
}

/**
 * Centralised error handler. Stack traces and internal messages are logged
 * server-side only; clients receive a stable code and a safe message.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let error = err;

  if (err instanceof multer.MulterError) {
    error = err.code === 'LIMIT_FILE_SIZE'
      ? new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than the permitted size')
      : AppError.badRequest('The upload could not be processed', 'UPLOAD_INVALID');
  } else if (err?.type === 'entity.too.large') {
    error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  } else if (err?.type === 'entity.parse.failed') {
    error = AppError.badRequest('Request body is not valid JSON', 'INVALID_JSON');
  }

  const isOperational = error instanceof AppError && error.expose;
  const status = isOperational ? error.status : 500;

  if (status >= 500) {
    logger.error({ err: { message: err.message, stack: err.stack, code: err.code }, requestId: req.id, path: req.path }, 'request failed');
  } else if (status === 401 || status === 403) {
    logger.info({ requestId: req.id, path: req.path, code: error.code }, 'request denied');
  }

  if (res.headersSent) return undefined;
  return res.status(status).json({
    success: false,
    message: isOperational ? error.message : 'Something went wrong on our side. Please try again.',
    error: {
      code: isOperational ? error.code : 'INTERNAL_ERROR',
      requestId: req.id,
      ...(isOperational && status < 500 && error.details ? { details: error.details } : {}),
    },
  });
}
