import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function toRange({ page, pageSize }) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function pageMeta({ page, pageSize }, total) {
  return { page, pageSize, total: total ?? 0, totalPages: total ? Math.ceil(total / pageSize) : 0 };
}

/** Escape user text before using it inside a PostgREST ilike filter. */
export function likePattern(term) {
  return `%${String(term).replace(/[%_\\,()*]/g, (c) => `\\${c}`)}%`;
}
