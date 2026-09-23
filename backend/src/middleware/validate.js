import { AppError } from '../utils/AppError.js';

/**
 * Validate and coerce request input with zod. Parsed values replace the raw
 * input so downstream code only ever sees validated data.
 */
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    try {
      req.validated = {};
      if (params) req.validated.params = parseOrThrow(params, req.params);
      if (query) req.validated.query = parseOrThrow(query, req.query);
      if (body) {
        req.validated.body = parseOrThrow(body, req.body ?? {});
        req.body = req.validated.body;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function parseOrThrow(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw AppError.badRequest('Please check the highlighted fields', 'VALIDATION_ERROR', { fields });
  }
  return result.data;
}
