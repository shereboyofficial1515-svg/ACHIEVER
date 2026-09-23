/** Wrap async route handlers so rejections reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Consistent success envelope: { success, message, data, meta? } */
export function ok(res, data = {}, message = 'OK', status = 200, meta) {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export function created(res, data, message = 'Created') {
  return ok(res, data, message, 201);
}

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

export function requestMeta(req) {
  return { ip: clientIp(req), userAgent: req.get('user-agent')?.slice(0, 300) || null };
}
