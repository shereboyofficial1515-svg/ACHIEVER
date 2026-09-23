import crypto from 'node:crypto';

/** Attach a request id used in logs and returned to clients on errors. */
export function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
