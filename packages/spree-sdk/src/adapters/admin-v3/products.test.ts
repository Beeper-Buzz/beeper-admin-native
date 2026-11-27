import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeTransport } from '../fakeTransport.test-helper';
import { adminV3Customers } from './customers';
import { adminV3Products } from './products';

const rec = (file: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../../../infra/spree/recordings/6.0', file), 'utf8'));
const product = rec('products.show.json');
const customer = rec('customers.show.json');
const meta = { page: 1, limit: 1, count: 38, pages: 38, from: 1, to: 1, in: 1, previous: null, next: 2 };

describe('adminV3Products', () => {
  function store() {
    return fakeTransport((method, url) => {
      if (url.startsWith('/api/v3/admin/stock_locations'))
        return {
          data: [
            { id: 'sloc_a', active: true, default: false },
            { id: 'sloc_b', active: true, default: true },
          ],
          meta,
        };
      if (url.startsWith('/api/v3/admin/stock_levels/bulk_upsert')) return { stock_level_count: 1 };
      if (url.startsWith('/api/v3/admin/products?')) return { data: [product], meta };
      if (url.startsWith(`/api/v3/admin/products/${product.id}`)) return method === 'GET' ? product : {};
      return undefined;
    });
  }

  it('lists with search, status and page, and reports the total', async () => {
    const { transport, calls } = store();
    const res = await adminV3Products(transport).list({
      query: 'espresso',
      status: 'draft',
      cursor: '3',
      perPage: 10,
    });
    expect(calls[0]?.url).toBe(
      '/api/v3/admin/products?q[search]=espresso&q[status_eq]=draft&page=3&limit=10&sort=-created_at&expand=variants,option_types,media',
    );
    expect(res).toMatchObject({ nextCursor: '2', totalCount: 38 });
    expect(res.items[0]?.id).toBe(product.id);
    await adminV3Products(transport).list({ status: 'all' });
    expect(calls[1]?.url).not.toContain('status_eq');
  });

  it('patches attributes, then moves status through its member action', async () => {
    const { transport, calls } = store();
    await adminV3Products(transport).update(
      { id: product.id },
      { name: 'New', description: null, status: 'archived' },
    );
    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        url: `/api/v3/admin/products/${product.id}`,
        body: { name: 'New', description: '' },
      }),
      expect.objectContaining({ method: 'PATCH', url: `/api/v3/admin/products/${product.id}/archive` }),
    ]);
  });

  it('upserts the base price by currency, keeping what the patch leaves out', async () => {
    const { transport, calls } = store();
    const v = product.variants[1];
    await adminV3Products(transport).updateVariant({ id: product.id }, v.id, { compareAtPrice: '999.00' });
    await adminV3Products(transport).updateVariant({ id: product.id }, v.id, { price: '1.50', sku: null });
    const writes = calls.filter((c) => c.method === 'PATCH');
    expect(writes[0]).toMatchObject({
      url: `/api/v3/admin/products/${product.id}/variants/${v.id}`,
      body: { prices: [{ currency: 'USD', amount: v.price.amount, compare_at_amount: '999.00' }] },
    });
    expect(writes[1]?.body).toEqual({
      sku: '',
      prices: [{ currency: 'USD', amount: '1.50', compare_at_amount: v.price.compare_at_amount }],
    });
    await expect(
      adminV3Products(transport).updateVariant({ id: product.id }, 'variant_nope', { price: '1' }),
    ).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('sets stock at the default location through bulk_upsert', async () => {
    const { transport, calls } = store();
    await adminV3Products(transport).setStock({ id: product.id }, 'variant_x', 9);
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/v3/admin/stock_levels/bulk_upsert',
      body: { stock_levels: [{ variant_id: 'variant_x', stock_location_id: 'sloc_b', count_on_hand: 9 }] },
    });
  });
});

describe('adminV3Customers', () => {
  it('prices total_spent in the store currency, fetched once', async () => {
    const { transport, calls } = fakeTransport((_m, url) => {
      if (url === '/api/v3/admin/store') return { default_currency: 'EUR' };
      if (url.startsWith('/api/v3/admin/customers?')) return { data: [customer], meta };
      return customer;
    });
    const customers = adminV3Customers(transport);
    const page = await customers.list({ query: 'Ada' });
    expect(calls.find((c) => c.url.startsWith('/api/v3/admin/customers?'))?.url).toBe(
      '/api/v3/admin/customers?q[search]=Ada&page=1&limit=25&sort=-created_at&expand=default_billing_address,default_shipping_address',
    );
    expect(page.items[0]?.totalSpent?.currency).toBe('EUR');
    expect(page.totalCount).toBe(38);
    const one = await customers.get(customer.id);
    expect(one.email).toBe('customer1@example.com');
    expect(calls.filter((c) => c.url === '/api/v3/admin/store')).toHaveLength(1);
  });
});
