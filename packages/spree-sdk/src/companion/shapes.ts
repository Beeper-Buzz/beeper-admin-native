import { type Money, money } from '@instincts/spree-domain';

/** Readers for the gem 0.7 inbox, cart and visitor JSON: anything unexpected reads as null. */

export type Json = Record<string, unknown>;

export const obj = (v: unknown): Json | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : null;

export const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Ids arrive as numbers on Spree 4 and strings elsewhere. */
export const idOf = (v: unknown): string | null =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : str(v);

/**
 * A URL the app can open: absolute ones as they are, a path (`/rails/active_storage/…`, which the
 * demo adapter and Spree 4.2's image helpers send) on the store's own origin.
 */
export function absoluteUrl(v: unknown, base: string | null | undefined): string | null {
  const url = str(v);
  if (!url) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (!base) return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * A total as money: a decimal string or number with the record's currency, or `{ amount,
 * currency }`. null when either is missing or unreadable.
 */
export function toMoney(total: unknown, currency: unknown): Money | null {
  const o = obj(total);
  const amount = o ? o.amount : total;
  const code = o ? (o.currency ?? currency) : currency;
  const text = typeof amount === 'number' && Number.isFinite(amount) ? String(amount) : str(amount);
  if (!text || typeof code !== 'string') return null;
  try {
    return money(text, code.toUpperCase());
  } catch {
    return null;
  }
}

/** The gem's paginated list meta (`{ page, per_page, total_count }`), as a Page cursor. */
export function pageMeta(meta: unknown, page: number, perPage: number, count: number) {
  const m = obj(meta) ?? {};
  const total = num(m.total_count);
  const per = num(m.per_page) ?? perPage;
  const more = total === undefined ? count >= per : page * per < total;
  return { nextCursor: more && count > 0 ? String(page + 1) : null, totalCount: total ?? count };
}

/** Rows that parse; one bad row never hides the others. */
export function parsed<T>(rows: unknown[], map: (row: unknown) => T | null): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const value = map(row);
    if (value !== null) out.push(value);
  }
  return out;
}
