import { describe, expect, it } from 'vitest';
import { fakeTransport } from '../fakeTransport.test-helper';
import { apiV1Customers } from './customers';
import type { V1Product, V1Variant } from './mapProduct';
import { apiV1Products, parseV1Cursor } from './products';

const past = '2026-01-01T00:00:00.000Z';
const future = '2999-01-01T00:00:00.000Z';

function variant(id: number, extra: Partial<V1Variant> = {}): V1Variant {
  return {
    id,
    sku: `SKU-${id}`,
    price: '10.0',
    is_master: false,
    options_text: 'Size: S',
    track_inventory: true,
    total_on_hand: 4,
    ...extra,
  };
}

function product(id: number, availableOn: string | null = past): V1Product {
  return {
    id,
    name: `Product ${id}`,
    slug: `product-${id}`,
    description: null,
    available_on: availableOn,
    master: variant(id * 100, { is_master: true, options_text: '' }),
    variants: [variant(id * 100 + 1)],
  };
}

const page = (products: V1Product[], n: number, pages: number) => ({
  products,
  count: products.length,
  total_count: 99,
  current_page: n,
  per_page: products.length,
  pages,
});

const stores = {
  stores: [
    { default: false, default_currency: 'EUR' },
    { default: true, default_currency: 'CAD' },
  ],
};

describe('parseV1Cursor', () => {
  it('reads a page or a page and offset', () => {
    expect(parseV1Cursor(null)).toEqual({ page: 1, skip: 0 });
    expect(parseV1Cursor('3')).toEqual({ page: 3, skip: 0 });
    expect(parseV1Cursor('3:12')).toEqual({ page: 3, skip: 12 });
    expect(parseV1Cursor('nope')).toEqual({ page: 1, skip: 0 });
  });
});

describe('apiV1Products.list', () => {
  it('lists all products, including discontinued ones, and marks those the default scope hides', async () => {
    const { transport, calls } = fakeTransport((_m, url) => {
      if (url.startsWith('/api/v1/stores')) return stores;
      if (url.includes('ids=')) return page([product(1)], 1, 1);
      return page([product(1), product(2)], 1, 3);
    });
    const res = await apiV1Products(transport).list({ query: 'shirt', perPage: 2 });
    expect(calls[1]?.url).toBe(
      '/api/v1/products?q[s]=id desc&q[name_or_variants_including_master_sku_cont]=shirt&page=1&per_page=2&show_discontinued=1',
    );
    expect(calls[1]?.headers).toEqual({ 'Cache-Control': 'no-cache' });
    expect(calls[2]?.url).toBe('/api/v1/products?ids=1,2&per_page=2');
    expect(res.items.map((p) => [p.id, p.status])).toEqual([
      ['1', 'active'],
      ['2', 'archived'],
    ]);
    expect(res.items[0]?.variants[0]?.price).toEqual({ amount: '10.00', currency: 'CAD' });
    expect(res).toMatchObject({ nextCursor: '2', totalCount: 99 });
  });

  it('filters archived products on discontinue_on', async () => {
    const { transport, calls } = fakeTransport((_m, url) =>
      url.startsWith('/api/v1/stores') ? stores : page([product(5)], 2, 2),
    );
    const res = await apiV1Products(transport).list({ status: 'archived', cursor: '2' });
    expect(calls[1]?.url).toMatch(
      /q\[discontinue_on_lteq\]=\d{4}-.*&page=2&per_page=25&show_discontinued=1$/,
    );
    expect(res.items[0]?.status).toBe('archived');
    expect(res.nextCursor).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('scans server pages for drafts and resumes mid-page', async () => {
    const pages: Record<number, V1Product[]> = {
      1: [product(1), product(2, null), product(3)],
      2: [product(4, future), product(5, null), product(6)],
      3: [product(7), product(8), product(9)],
    };
    const { transport, calls } = fakeTransport((_m, url) => {
      if (url.startsWith('/api/v1/stores')) return stores;
      const n = Number(/[?&]page=(\d+)/.exec(url)?.[1]);
      return page(pages[n] ?? [], n, 3);
    });
    const products = apiV1Products(transport);
    const first = await products.list({ status: 'draft', perPage: 2 });
    expect(first.items.map((p) => p.id)).toEqual(['2', '4']);
    expect(first.nextCursor).toBe('2:1');
    expect(calls.some((c) => c.url.includes('show_discontinued'))).toBe(false);
    const second = await products.list({ status: 'draft', perPage: 2, cursor: first.nextCursor });
    expect(second.items.map((p) => p.id)).toEqual(['5']);
    expect(second.nextCursor).toBeNull();
    expect(second.totalCount).toBeUndefined();
  });

  it('stops scanning after a few pages and hands back a cursor', async () => {
    const { transport } = fakeTransport((_m, url) =>
      url.startsWith('/api/v1/stores') ? stores : page([product(1)], 1, 50),
    );
    const res = await apiV1Products(transport).list({ status: 'draft', perPage: 5 });
    expect(res).toEqual({ items: [], nextCursor: '6' });
  });
});

describe('apiV1Products reads and writes', () => {
  /** A product store: product 1 is visible; product 2 only with show_discontinued. */
  function store() {
    const products: Record<number, V1Product> = { 1: product(1), 2: product(2) };
    const archived = new Set([2]);
    return fakeTransport((method, url) => {
      if (url.startsWith('/api/v1/stores')) return stores;
      if (url.startsWith('/api/v1/stock_locations?'))
        return {
          stock_locations: [
            { id: 4, active: false },
            { id: 7, active: true },
          ],
        };
      if (url.startsWith('/api/v1/stock_locations/7/stock_items?'))
        return url.includes('variant_id_eq]=101')
          ? { stock_items: [{ id: 55, variant_id: 101 }] }
          : { stock_items: [] };
      if (url.startsWith('/api/v1/stock_locations/7/stock_items')) return {};
      const m = /^\/api\/v1\/products\/(\d+)/.exec(url);
      const p = m ? products[Number(m[1])] : undefined;
      if (!p) return undefined;
      if (method === 'GET' && archived.has(p.id) && !url.includes('show_discontinued')) return undefined;
      return p;
    });
  }

  it('gets a product, retrying an archived one with show_discontinued', async () => {
    const { transport, calls } = store();
    const products = apiV1Products(transport);
    expect((await products.get('1')).status).toBe('active');
    const archived = await products.get('2');
    expect(archived.status).toBe('archived');
    expect(calls.map((c) => c.url)).toContain('/api/v1/products/2?show_discontinued=1&show_deleted=1');
  });

  it('maps status writes onto available_on and discontinue_on', async () => {
    const { transport, calls } = store();
    const products = apiV1Products(transport);
    const puts = () => calls.filter((c) => c.method === 'PUT');

    await products.update({ id: '1' }, { name: 'Renamed', status: 'draft' });
    expect(puts()[0]).toMatchObject({
      url: '/api/v1/products/1?show_discontinued=1',
      body: { product: { name: 'Renamed', available_on: null, discontinue_on: null } },
    });

    await products.update({ id: '1' }, { status: 'archived' });
    expect((puts()[1]?.body as { product: Record<string, unknown> } | undefined)?.product).toEqual({
      discontinue_on: expect.stringMatching(/^\d{4}-/),
    });

    // Already available: keep available_on, clear discontinue_on.
    await products.update({ id: '2' }, { status: 'active' });
    expect(puts()[2]?.body).toEqual({ product: { available_on: past, discontinue_on: null } });

    // Same status and nothing else: no write.
    await products.update({ id: '1' }, { status: 'active' });
    expect(puts()).toHaveLength(3);
  });

  it('makes a scheduled draft available now', async () => {
    const { transport, calls } = fakeTransport((_m, url) => {
      if (url.startsWith('/api/v1/stores')) return stores;
      return product(3, future);
    });
    await apiV1Products(transport).update({ id: '3' }, { status: 'active' });
    const body = calls.find((c) => c.method === 'PUT')?.body as { product: { available_on: string } };
    expect(Date.parse(body.product.available_on)).toBeLessThanOrEqual(Date.now());
  });

  it('archives a scheduled draft by clearing its future available_on', async () => {
    const { transport, calls } = fakeTransport((_m, url) =>
      url.startsWith('/api/v1/stores') ? stores : product(3, future),
    );
    await apiV1Products(transport).update({ id: '3' }, { status: 'archived' });
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ product: { available_on: null } });
  });

  it('writes a master through the product and other variants through the variants endpoint', async () => {
    const { transport, calls } = store();
    const products = apiV1Products(transport);
    await products.updateVariant({ id: '1' }, '100', { price: '12.50', compareAtPrice: null, sku: null });
    await products.updateVariant({ id: '1' }, '101', { price: '9.99', compareAtPrice: '15.00' });
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts[0]).toMatchObject({
      url: '/api/v1/products/1?show_discontinued=1',
      body: { product: { price: '12.50', compare_at_price: null, sku: '' } },
    });
    expect(puts[1]).toMatchObject({
      url: '/api/v1/products/1/variants/101',
      body: { variant: { price: '9.99', compare_at_price: '15.00' } },
    });
    await expect(products.updateVariant({ id: '1' }, '999', { price: '1' })).rejects.toMatchObject({
      kind: 'notFound',
    });
  });

  it('forces the on-hand count at the first active location, creating the stock item if needed', async () => {
    const { transport, calls } = store();
    const products = apiV1Products(transport);
    await products.setStock({ id: '1' }, '101', 12);
    await products.setStock({ id: '1' }, '100', 3);
    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes[0]).toMatchObject({
      method: 'PUT',
      url: '/api/v1/stock_locations/7/stock_items/55',
      body: { stock_item: { count_on_hand: 12, force: true } },
    });
    expect(writes[1]).toMatchObject({
      method: 'POST',
      url: '/api/v1/stock_locations/7/stock_items',
      body: { stock_item: { variant_id: '100', count_on_hand: 3 } },
    });
  });
});

describe('apiV1Customers', () => {
  const user = (id: number) => ({
    id,
    email: `customer${id}@example.com`,
    created_at: '2026-11-26T23:36:43.578Z',
    updated_at: '2026-11-26T23:36:43.578Z',
    bill_address: null,
    ship_address: null,
  });

  it('searches email and address names, dropping repeated users', async () => {
    const { transport, calls } = fakeTransport(() => ({
      users: [user(3), user(3), user(4)],
      count: 3,
      current_page: 1,
      pages: 2,
    }));
    const res = await apiV1Customers(transport).list({ query: 'customer', perPage: 3 });
    expect(calls[0]?.url).toBe(
      '/api/v1/users?q[email_start]=customer&q[ship_address_firstname_start]=customer&page=1&per_page=3',
    );
    expect(res.items.map((c) => c.id)).toEqual(['3', '4']);
    expect(res.nextCursor).toBe('2');
  });

  it('counts completed orders on get', async () => {
    const { transport, calls } = fakeTransport((_m, url) =>
      url.startsWith('/api/v1/orders') ? { pages: 5 } : user(3),
    );
    const c = await apiV1Customers(transport).get('3');
    expect(c).toMatchObject({ id: '3', ordersCount: 5, totalSpent: null });
    expect(calls.map((x) => x.url)).toContain(
      '/api/v1/orders?q[user_id_eq]=3&q[completed_at_not_null]=1&per_page=1',
    );
  });
});
