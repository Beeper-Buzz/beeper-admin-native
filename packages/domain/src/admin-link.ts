import { z } from 'zod';

/**
 * Gem 0.7 `link` fields (docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md §1): a menu
 * item's target, either a URL or a record such as a product, a taxon or a page.
 */

/** The link kinds the spec names; hosts may add others, which work like a reference to their resource. */
export const LINK_KINDS = ['url', 'product', 'taxon', 'page'] as const;

/** Where a link kind's records come from when the host doesn't say (gem 0.7 built-in lookups). */
export const DEFAULT_LINK_RESOURCES: Readonly<Record<string, string>> = {
  product: 'spree_products',
  taxon: 'spree_taxons',
  page: 'pages',
};

/** One kind of link target: a URL, or a record of `resource`. */
export const AdminLinkKind = z.object({
  kind: z.string().min(1),
  /** The type key to pick a record from; null for `url`. */
  resource: z.string().nullable(),
  /** null when the host gave none; the app names it after the kind or its resource. */
  label: z.string().nullable(),
});
export type AdminLinkKind = z.infer<typeof AdminLinkKind>;

const linkKind = (kind: string, resource: unknown, label: unknown): AdminLinkKind => ({
  kind,
  resource:
    kind === 'url'
      ? null
      : typeof resource === 'string' && resource
        ? resource
        : (DEFAULT_LINK_RESOURCES[kind] ?? null),
  label: typeof label === 'string' && label ? label : null,
});

/**
 * A link field's kinds, however the host wrote them: a list of names (`%w[url product]`), a list of
 * `{ kind, resource, label }`, or a map of kind to resource (`{ product: 'spree_products' }`, as
 * `r.field :link, :link, kinds: {…}` declares them, with the URL kind implied). Nothing usable
 * gives the spec's four kinds. A kind other than `url` with no resource to pick from is dropped.
 */
export function normalizeLinkKinds(raw: unknown): AdminLinkKind[] {
  const out: AdminLinkKind[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && item) out.push(linkKind(item, null, null));
      else if (typeof item === 'object' && item !== null) {
        const o = item as Record<string, unknown>;
        const kind = typeof o.kind === 'string' ? o.kind : typeof o.value === 'string' ? o.value : null;
        if (kind) out.push(linkKind(kind, o.resource, o.label));
      }
    }
  } else if (typeof raw === 'object' && raw !== null) {
    out.push(linkKind('url', null, null));
    for (const [kind, target] of Object.entries(raw as Record<string, unknown>)) {
      if (kind === 'url') continue;
      if (typeof target === 'object' && target !== null) {
        const o = target as Record<string, unknown>;
        out.push(linkKind(kind, o.resource, o.label));
      } else out.push(linkKind(kind, target, null));
    }
  }
  const seen = new Set<string>();
  const usable = out.filter((k) => {
    if (seen.has(k.kind) || (k.kind !== 'url' && !k.resource)) return false;
    seen.add(k.kind);
    return true;
  });
  return usable.length ? usable : LINK_KINDS.map((k) => linkKind(k, null, null));
}

/** A link field's kinds: the host's, or the spec's four when it listed none. */
export function linkKinds(field: { kinds?: readonly AdminLinkKind[] }): AdminLinkKind[] {
  return field.kinds?.length ? [...field.kinds] : normalizeLinkKinds(null);
}

/** What a `link` field holds: a URL, or a record (`id`, with its `title`) of the kind's resource. */
export const AdminLink = z.object({
  kind: z.string().min(1),
  url: z.string().nullable(),
  id: z.string().nullable(),
  title: z.string().nullable(),
});
export type AdminLink = z.infer<typeof AdminLink>;

/**
 * A link value as an AdminLink, from the store's `{ kind, url, id, title }` (or a bare URL); null
 * when there is none, or it's missing what its kind needs (a URL, or an id).
 */
export function adminLink(value: unknown): AdminLink | null {
  if (typeof value === 'string')
    return value.trim() ? { kind: 'url', url: value.trim(), id: null, title: null } : null;
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const url = typeof v.url === 'string' && v.url.trim() ? v.url.trim() : null;
  const id = typeof v.id === 'string' || typeof v.id === 'number' ? String(v.id) || null : null;
  const title = typeof v.title === 'string' && v.title ? v.title : null;
  const kind = typeof v.kind === 'string' && v.kind ? v.kind : url ? 'url' : null;
  if (!kind) return null;
  if (kind === 'url') return url ? { kind, url, id: null, title } : null;
  return id ? { kind, url, id, title } : null;
}
