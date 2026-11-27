import type { Page, Product } from '@instincts/spree-domain';
import type { PaginatedResponse, StockLocation, Product as V3Product } from '@spree/admin-sdk';
import { SpreeError } from '../../errors';
import type { ListProductsParams, ProductsPort, ProductUpdate, VariantUpdate } from '../../ports';
import type { QueryObject } from '../../query';
import type { Transport } from '../../transport';
import { mapV3Product } from './mapProduct';

const BASE = '/api/v3/admin/products';
const EXPAND = 'variants,option_types,media';
/** Status moves go through these member actions, which run Spree's workflow and publish its event. */
const STATUS_ACTION = { active: 'activate', draft: 'draft', archived: 'archive' } as const;

const enc = encodeURIComponent;

/** Admin API v3 (Spree 5.4+/6): products by prefixed id (`prod_…`), variants `variant_…`. */
/** Matches the companion gem's default low_stock_threshold. */
export const LOW_STOCK_THRESHOLD = 2;
/** At most this many pages of 100 low stock levels are read. */
const LOW_STOCK_MAX_PAGES = 5;

export interface V3LowLevel {
  count_on_hand: number;
  variant_id: string;
  variant?: { product_id: string; track_inventory: boolean } | null;
}

/**
 * Products with tracked variants whose stock, summed across the low levels, is at or under the
 * threshold; lowest first. Levels above the threshold aren't fetched, so a variant also stocked
 * elsewhere above it still counts as low at the low location.
 */
export function lowStockProducts(levels: V3LowLevel[]) {
  const byVariant = new Map<string, { productId: string; onHand: number }>();
  for (const l of levels) {
    if (!l.variant?.track_inventory) continue;
    const v = byVariant.get(l.variant_id) ?? { productId: l.variant.product_id, onHand: 0 };
    v.onHand += l.count_on_hand;
    byVariant.set(l.variant_id, v);
  }
  const byProduct = new Map<string, { productId: string; lowVariants: number; lowestOnHand: number }>();
  for (const v of byVariant.values()) {
    if (v.onHand > LOW_STOCK_THRESHOLD) continue;
    const p = byProduct.get(v.productId) ?? {
      productId: v.productId,
      lowVariants: 0,
      lowestOnHand: v.onHand,
    };
    p.lowVariants += 1;
    p.lowestOnHand = Math.min(p.lowestOnHand, v.onHand);
    byProduct.set(v.productId, p);
  }
  return [...byProduct.values()].sort(
    (a, b) => a.lowestOnHand - b.lowestOnHand || a.productId.localeCompare(b.productId),
  );
}

export function adminV3Products(transport: Transport): ProductsPort {
  const fetchRaw = async (id: string) =>
    (await transport.request<V3Product>({ path: `${BASE}/${enc(id)}`, query: { expand: EXPAND } })).data;

  /** The default stock location, else the first active one. */
  async function stockLocationId(): Promise<string> {
    const res = await transport.request<PaginatedResponse<StockLocation>>({
      path: '/api/v3/admin/stock_locations',
      query: { limit: 100 },
    });
    const locations = res.data.data;
    const location = locations.find((l) => l.default && l.active) ?? locations.find((l) => l.active);
    if (!location)
      throw new SpreeError({
        kind: 'invalid',
        status: 422,
        message: 'This store has no active stock location.',
      });
    return location.id;
  }

  /**
   * Spree 6 has no low-stock list: read stock levels at or under the threshold, sum them per
   * tracked variant across locations, group by product (lowest first), then load those products.
   */
  async function lowStockPage(params: ListProductsParams): Promise<Page<Product>> {
    const levels: V3LowLevel[] = [];
    for (let page = 1; page <= LOW_STOCK_MAX_PAGES; page++) {
      const res = await transport.request<PaginatedResponse<V3LowLevel>>({
        path: '/api/v3/admin/stock_levels',
        query: { q: { count_on_hand_lteq: LOW_STOCK_THRESHOLD }, limit: 100, page, expand: 'variant' },
      });
      levels.push(...res.data.data);
      if (!res.data.meta.next) break;
    }
    const products = lowStockProducts(levels);
    const perPage = params.perPage ?? 25;
    const offset = params.cursor ? Number(params.cursor) || 0 : 0;
    const slice = products.slice(offset, offset + perPage);
    if (slice.length === 0) return { items: [], nextCursor: null, totalCount: products.length };
    const res = await transport.request<PaginatedResponse<V3Product>>({
      path: BASE,
      query: { q: { id_in: slice.map((p) => p.productId) }, limit: slice.length, expand: EXPAND },
    });
    const byId = new Map(res.data.data.map((p) => [p.id, p]));
    return {
      items: slice.flatMap((p) => {
        const raw = byId.get(p.productId);
        return raw ? [mapV3Product(raw)] : [];
      }),
      nextCursor: offset + perPage < products.length ? String(offset + perPage) : null,
      totalCount: products.length,
    };
  }

  const port: ProductsPort = {
    async list(params: ListProductsParams): Promise<Page<Product>> {
      if (params.lowStock) return lowStockPage(params);
      const q: Record<string, string> = {};
      // `search` matches names and SKUs.
      if (params.query) q.search = params.query;
      if (params.status && params.status !== 'all') q.status_eq = params.status;
      const res = await transport.request<PaginatedResponse<V3Product>>({
        path: BASE,
        query: {
          q: q as QueryObject,
          page: params.cursor ? Number(params.cursor) || 1 : 1,
          limit: params.perPage ?? 25,
          sort: '-created_at',
          expand: EXPAND,
        },
      });
      const { data, meta } = res.data;
      return {
        items: data.map(mapV3Product),
        nextCursor: meta.next ? String(meta.next) : null,
        totalCount: meta.count,
      };
    },

    async get(id: string) {
      return mapV3Product(await fetchRaw(id));
    },

    async update(product, patch: ProductUpdate) {
      const body: Record<string, unknown> = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.description !== undefined) body.description = patch.description ?? '';
      if (Object.keys(body).length > 0)
        await transport.request({ method: 'PATCH', path: `${BASE}/${enc(product.id)}`, body });
      if (patch.status) {
        await transport.request({
          method: 'PATCH',
          path: `${BASE}/${enc(product.id)}/${STATUS_ACTION[patch.status]}`,
        });
      }
      return port.get(product.id);
    },

    async updateVariant(product, variantId, patch: VariantUpdate) {
      const body: Record<string, unknown> = {};
      if (patch.sku !== undefined) body.sku = patch.sku ?? '';
      if (patch.price !== undefined || patch.compareAtPrice !== undefined) {
        // Prices are upserted by currency and need an amount, so start from the current base price.
        const raw = await fetchRaw(product.id);
        const variant = (raw.variants ?? []).find((v) => v.id === variantId);
        if (!variant)
          throw new SpreeError({ kind: 'notFound', status: 404, message: `Variant ${variantId} not found.` });
        const current = variant.price;
        const currency = current?.currency ?? raw.price?.currency;
        if (!currency)
          throw new SpreeError({
            kind: 'invalid',
            status: 422,
            message: "This variant's currency is unknown.",
          });
        body.prices = [
          {
            currency,
            amount: patch.price ?? current?.amount,
            compare_at_amount:
              patch.compareAtPrice !== undefined
                ? patch.compareAtPrice
                : (current?.compare_at_amount ?? null),
          },
        ];
      }
      if (Object.keys(body).length > 0) {
        await transport.request({
          method: 'PATCH',
          path: `${BASE}/${enc(product.id)}/variants/${enc(variantId)}`,
          body,
        });
      }
      return port.get(product.id);
    },

    async setStock(product, variantId, countOnHand) {
      const location = await stockLocationId();
      // Upserts: creates the stock level when the variant isn't stocked at that location yet.
      const res = await transport.request<{ stock_level_count: number }>({
        method: 'POST',
        path: '/api/v3/admin/stock_levels/bulk_upsert',
        body: {
          stock_levels: [{ variant_id: variantId, stock_location_id: location, count_on_hand: countOnHand }],
        },
      });
      if (!res.data.stock_level_count)
        throw new SpreeError({ kind: 'notFound', status: 404, message: `Variant ${variantId} not found.` });
      return port.get(product.id);
    },
  };
  return port;
}
