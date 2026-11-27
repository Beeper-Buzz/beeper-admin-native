import type { Page, Product } from '@instincts/spree-domain';
import { isSpreeError, SpreeError } from '../../errors';
import type { ListProductsParams, ProductsPort, ProductUpdate, VariantUpdate } from '../../ports';
import type { QueryObject } from '../../query';
import type { Transport } from '../../transport';
import {
  isAvailableOn,
  mapV1Product,
  type V1Product,
  type V1ProductList,
  v1ProductStatus,
} from './mapProduct';

const BASE = '/api/v1/products';
/**
 * v1 product and user reads answer `Cache-Control: public, max-age=900`; a client cache that
 * honours it would show a product as it was before an edit (FINDINGS.md §g).
 */
export const V1_NO_CACHE = { 'Cache-Control': 'no-cache' } as const;
/** Without this, update and get can't see discontinued (archived) products. */
const SHOW_ARCHIVED = { show_discontinued: 1 } as const;
/** Server pages a status-filtered list reads before returning what it has found. */
export const V1_MAX_SCAN_PAGES = 5;

const enc = encodeURIComponent;

/** `"3"` or, mid-page for a status-filtered scan, `"3:12"` (server page, rows already read). */
export function parseV1Cursor(cursor: string | null | undefined): { page: number; skip: number } {
  const m = /^(\d+)(?::(\d+))?$/.exec(cursor ?? '');
  if (!m) return { page: 1, skip: 0 };
  return { page: Math.max(1, Number(m[1])), skip: Number(m[2] ?? 0) };
}

/** The store's currency: v1 prices are bare decimals in Spree::Config[:currency]. */
function storeCurrency(transport: Transport): () => Promise<string> {
  let cached: Promise<string> | undefined;
  return () => {
    cached ??= transport
      .request<{ stores: { default?: boolean; default_currency?: string | null }[] }>({
        path: '/api/v1/stores',
        headers: V1_NO_CACHE,
      })
      .then(({ data }) => {
        const store = data.stores.find((s) => s.default) ?? data.stores[0];
        return store?.default_currency || 'USD';
      })
      .catch((e: unknown) => {
        if (isSpreeError(e) && (e.kind === 'forbidden' || e.kind === 'notFound')) return 'USD';
        cached = undefined;
        throw e;
      });
    return cached;
  };
}

/** Stock is set at the first active location (v1 lists them by name and doesn't say which is default). */
async function stockLocationId(transport: Transport): Promise<number> {
  const res = await transport.request<{ stock_locations: { id: number; active: boolean }[] }>({
    path: '/api/v1/stock_locations',
    query: { per_page: 100 },
    headers: V1_NO_CACHE,
  });
  const location = res.data.stock_locations.find((l) => l.active);
  if (!location)
    throw new SpreeError({
      kind: 'invalid',
      status: 422,
      message: 'This store has no active stock location.',
    });
  return location.id;
}

/** API v1 (Spree 4.2–4.3). Status is derived from available_on / discontinue_on (FINDINGS.md §g). */
export function apiV1Products(transport: Transport): ProductsPort {
  const currency = storeCurrency(transport);

  /** The raw product, and whether only the archived lookup found it. Accepts an id or a slug. */
  async function fetchRaw(id: string): Promise<{ raw: V1Product; archived: boolean }> {
    const path = `${BASE}/${enc(id)}`;
    try {
      return {
        raw: (await transport.request<V1Product>({ path, headers: V1_NO_CACHE })).data,
        archived: false,
      };
    } catch (e) {
      if (!isSpreeError(e) || e.kind !== 'notFound') throw e;
    }
    const res = await transport.request<V1Product>({
      path,
      query: { ...SHOW_ARCHIVED, show_deleted: 1 },
      headers: V1_NO_CACHE,
    });
    return { raw: res.data, archived: true };
  }

  /** Which of these (all listed with show_discontinued) the default scope hides: the archived ones. */
  async function archivedIds(products: V1Product[]): Promise<Set<number>> {
    if (products.length === 0) return new Set();
    const res = await transport.request<V1ProductList>({
      path: BASE,
      query: { ids: products.map((p) => p.id).join(','), per_page: products.length },
      headers: V1_NO_CACHE,
    });
    const visible = new Set(res.data.products.map((p) => p.id));
    return new Set(products.filter((p) => !visible.has(p.id)).map((p) => p.id));
  }

  const port: ProductsPort = {
    async list(params: ListProductsParams): Promise<Page<Product>> {
      const perPage = params.perPage ?? 25;
      const status = params.status ?? 'all';
      const { page, skip } = parseV1Cursor(params.cursor);
      const now = Date.now();
      const q: Record<string, string> = { s: 'id desc' };
      if (params.query) q.name_or_variants_including_master_sku_cont = params.query;
      // discontinue_on is the only status column v1 lets Ransack filter on.
      if (status === 'archived') q.discontinue_on_lteq = new Date(now).toISOString();
      const fetchPage = (n: number) =>
        transport.request<V1ProductList>({
          path: BASE,
          query: {
            q: q as QueryObject,
            page: n,
            per_page: perPage,
            ...(status === 'all' || status === 'archived' ? SHOW_ARCHIVED : {}),
          },
          headers: V1_NO_CACHE,
        });
      const cur = await currency();

      if (status === 'all' || status === 'archived') {
        const { products, pages, total_count } = (await fetchPage(page)).data;
        const archived =
          status === 'archived' ? new Set(products.map((p) => p.id)) : await archivedIds(products);
        return {
          items: products.map((p) => mapV1Product(p, { currency: cur, archived: archived.has(p.id), now })),
          nextCursor: page < pages ? String(page + 1) : null,
          totalCount: total_count,
        };
      }

      // available_on isn't ransackable, so active/draft are filtered here, a few server pages at a time.
      const items: Product[] = [];
      let n = page;
      let from = skip;
      for (let scanned = 0; scanned < V1_MAX_SCAN_PAGES; scanned++) {
        const { products, pages } = (await fetchPage(n)).data;
        for (let i = from; i < products.length; i++) {
          const raw = products[i] as V1Product;
          if (v1ProductStatus(raw.available_on, false, now) === status)
            items.push(mapV1Product(raw, { currency: cur, now }));
          if (items.length === perPage) {
            const nextCursor = i + 1 < products.length ? `${n}:${i + 1}` : n < pages ? String(n + 1) : null;
            return { items, nextCursor };
          }
        }
        if (n >= pages) return { items, nextCursor: null };
        n += 1;
        from = 0;
      }
      return { items, nextCursor: String(n) };
    },

    async get(id: string): Promise<Product> {
      const [{ raw, archived }, cur] = await Promise.all([fetchRaw(id), currency()]);
      return mapV1Product(raw, { currency: cur, archived });
    },

    async update(product, patch: ProductUpdate) {
      const { raw, archived } = await fetchRaw(product.id);
      const attrs: Record<string, unknown> = {};
      if (patch.name !== undefined) attrs.name = patch.name;
      if (patch.description !== undefined) attrs.description = patch.description;
      const now = Date.now();
      if (patch.status && patch.status !== v1ProductStatus(raw.available_on, archived, now)) {
        const nowIso = new Date(now).toISOString();
        if (patch.status === 'draft') {
          attrs.available_on = null;
          attrs.discontinue_on = null;
        } else if (patch.status === 'active') {
          attrs.available_on = isAvailableOn(raw.available_on, now) ? raw.available_on : nowIso;
          attrs.discontinue_on = null;
        } else {
          attrs.discontinue_on = nowIso;
          // discontinue_on may not precede available_on.
          if (raw.available_on && !isAvailableOn(raw.available_on, now)) attrs.available_on = null;
        }
      }
      if (Object.keys(attrs).length > 0) {
        await transport.request({
          method: 'PUT',
          path: `${BASE}/${raw.id}`,
          query: SHOW_ARCHIVED,
          body: { product: attrs },
        });
      }
      return port.get(String(raw.id));
    },

    async updateVariant(product, variantId, patch: VariantUpdate) {
      const { raw } = await fetchRaw(product.id);
      const variant = [raw.master, ...(raw.variants ?? [])].find((v) => String(v.id) === variantId);
      if (!variant)
        throw new SpreeError({ kind: 'notFound', status: 404, message: `Variant ${variantId} not found.` });
      const attrs: Record<string, unknown> = {};
      if (patch.price !== undefined) attrs.price = patch.price;
      if (patch.compareAtPrice !== undefined) attrs.compare_at_price = patch.compareAtPrice;
      if (patch.sku !== undefined) attrs.sku = patch.sku ?? '';
      if (Object.keys(attrs).length > 0) {
        // The variants endpoint can't find a master that has option variants; the product
        // delegates price, compare_at_price and sku to its master instead.
        await transport.request(
          variant.is_master
            ? { method: 'PUT', path: `${BASE}/${raw.id}`, query: SHOW_ARCHIVED, body: { product: attrs } }
            : { method: 'PUT', path: `${BASE}/${raw.id}/variants/${variant.id}`, body: { variant: attrs } },
        );
      }
      return port.get(String(raw.id));
    },

    async setStock(product, variantId, countOnHand) {
      const location = await stockLocationId(transport);
      const base = `/api/v1/stock_locations/${location}/stock_items`;
      const res = await transport.request<{ stock_items: { id: number; variant_id: number }[] }>({
        path: base,
        query: { q: { variant_id_eq: variantId }, per_page: 1 },
        headers: V1_NO_CACHE,
      });
      const item = res.data.stock_items.find((i) => String(i.variant_id) === variantId);
      await transport.request(
        item
          ? // `force` sets the count; without it v1 adds count_on_hand to what's there.
            {
              method: 'PUT',
              path: `${base}/${item.id}`,
              body: { stock_item: { count_on_hand: countOnHand, force: true } },
            }
          : {
              method: 'POST',
              path: base,
              body: { stock_item: { variant_id: variantId, count_on_hand: countOnHand } },
            },
      );
      return port.get(product.id);
    },
  };
  return port;
}
