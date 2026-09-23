/**
 * Operational error with a stable machine-readable code. Anything that is not
 * an AppError is treated as an unexpected failure and never shown to users.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }

  static badRequest(message = 'Invalid request', code = 'BAD_REQUEST', details) {
    return new AppError(400, code, message, details);
  }
  static unauthorized(message = 'Please sign in to continue', code = 'UNAUTHENTICATED') {
    return new AppError(401, code, message);
  }
  static forbidden(message = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }
  static notFound(message = 'Not found', code = 'NOT_FOUND') {
    return new AppError(404, code, message);
  }
  static conflict(message, code = 'CONFLICT') {
    return new AppError(409, code, message);
  }
  static unprocessable(message, code = 'UNPROCESSABLE', details) {
    return new AppError(422, code, message, details);
  }
  static tooMany(message = 'Too many requests. Please try again later.', code = 'RATE_LIMITED') {
    return new AppError(429, code, message);
  }
  static unavailable(message = 'Service temporarily unavailable', code = 'SERVICE_UNAVAILABLE') {
    return new AppError(503, code, message);
  }
}
