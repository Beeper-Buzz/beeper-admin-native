/**
 * Stable React keys for rows that have no id (cart lines, page views): each item's own key, with
 * `#2`, `#3`… added to repeats, so equal rows don't collide and no array index is used.
 */
export function withKeys<T>(items: readonly T[], keyOf: (item: T) => string): { key: string; item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = keyOf(item);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { key: n === 1 ? base : `${base}#${n}`, item };
  });
}
