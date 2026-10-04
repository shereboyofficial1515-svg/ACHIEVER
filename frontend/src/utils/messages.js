/** Merge messages by id (update, never duplicate) and keep them in created_at order. */
export function mergeMessages(list, incoming) {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => {
    const d = new Date(a.createdAt) - new Date(b.createdAt);
    if (d) return d;
    if (a.pending !== b.pending) return a.pending ? 1 : -1;   // optimistic messages after saved ones
    return String(a.id).localeCompare(String(b.id));
  });
}
