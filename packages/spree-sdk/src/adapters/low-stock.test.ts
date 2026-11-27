import { describe, expect, it } from 'vitest';
import { lowStockProducts } from './admin-v3/products';
import { apiV1Products } from './api-v1/products';
import { fakeTransport } from './fakeTransport.test-helper';

describe('Spree 6 low-stock grouping', () => {
  const level = (variant: string, product: string, n: number, tracked = true) => ({
    variant_id: variant,
    count_on_hand: n,
    variant: { product_id: product, track_inventory: tracked },
  });

  it('sums locations per variant, skips untracked, groups by product, lowest first', () => {
    expect(
      lowStockProducts([
        level('v1', 'p1', 2),
        level('v2', 'p2', 0),
        level('v3', 'p2', 1),
        level('v4', 'p3', 0, false),
        level('v5', 'p4', 1),
        level('v5', 'p4', 2),
      ]),
    ).toEqual([
      { productId: 'p2', lowVariants: 2, lowestOnHand: 0 },
      { productId: 'p1', lowVariants: 1, lowestOnHand: 2 },
    ]);
  });
});

describe('Spree 4.2 low-stock list', () => {
  it('needs the companion gem', async () => {
    const { transport: t } = fakeTransport(() => ({}));
    await expect(apiV1Products(t).list({ lowStock: true })).rejects.toMatchObject({ kind: 'capability' });
  });

  it('loads the gem rows as products, in the gem order', async () => {
    const { transport: t } = fakeTransport((_m, url) => {
      if (url.includes('/api/v1/stores')) return { stores: [{ default: true, default_currency: 'USD' }] };
      if (url.includes('/api/v1/products'))
        return {
          products: [5, 9].map((id) => ({
            id,
            name: `P${id}`,
            slug: `p${id}`,
            description: null,
            available_on: '2020-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            master: {
              id: id * 10,
              sku: `S${id}`,
              price: '1.0',
              is_master: true,
              total_on_hand: 0,
              options_text: '',
              images: [],
            },
            variants: [],
            has_variants: false,
            option_types: [],
          })),
          count: 2,
          total_count: 2,
          pages: 1,
          current_page: 1,
        };
      return {};
    });
    const companion = {
      lowStockProducts: async () => ({
        rows: [
          { productId: '9', lowVariants: 1, lowestOnHand: 0 },
          { productId: '5', lowVariants: 1, lowestOnHand: 1 },
        ],
        totalCount: 3,
        threshold: 2,
      }),
    } as never;
    const page = await apiV1Products(t, companion).list({ lowStock: true, perPage: 2 });
    expect(page.items.map((p) => p.id)).toEqual(['9', '5']);
    expect(page).toMatchObject({ nextCursor: '2', totalCount: 3 });
  });
});
