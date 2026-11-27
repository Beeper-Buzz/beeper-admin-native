import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sellableVariants } from '@instincts/spree-domain';
import { describe, expect, it } from 'vitest';
import { mapV3Customer, mapV3Product } from './admin-v3/mapProduct';
import { isAvailableOn, mapV1Product, mapV1User, type V1Product, v1ProductStatus } from './api-v1/mapProduct';

const rec = (version: string, file: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../../infra/spree/recordings', version, file), 'utf8'));

describe('Spree 4.2 API v1 catalog recordings', () => {
  const show: V1Product = rec('4.2', 'products.show.json');

  it('maps a product with its master and option variants', () => {
    const p = mapV1Product(show, { currency: 'USD' });
    expect(p).toMatchObject({ id: '1', name: 'Denim Shirt', slug: 'denim-shirt', status: 'active' });
    expect(p.variants[0]).toMatchObject({ id: '1', isMaster: true, optionsText: null, compareAtPrice: null });
    expect(p.variants[0]?.price).toEqual({ amount: '69.99', currency: 'USD' });
    const sellable = sellableVariants(p);
    expect(sellable.length).toBeGreaterThan(0);
    expect(sellable.every((v) => !v.isMaster)).toBe(true);
    expect(sellable[0]).toMatchObject({ optionsText: 'Color: blue, Size: XS', purchasable: true });
    expect(sellable[0]?.sku).toMatch(/blue_xs$/);
    expect(typeof sellable[0]?.totalOnHand).toBe('number');
    // The sample color option keeps its hex swatch in `presentation`.
    expect(sellable[0]?.optionValues[0]).toMatchObject({
      name: 'blue',
      presentation: 'blue',
      color: '#0000FF',
    });
    expect(p.optionTypes.map((t) => t.presentation)).toEqual(['Color', 'Size']);
    expect(p.updatedAt).toBeNull();
  });

  it('maps every list item in the store currency', () => {
    const list = rec('4.2', 'products.list.json');
    expect(list.total_count).toBeGreaterThan(3);
    const items = list.products.map((p: V1Product) => mapV1Product(p, { currency: 'CAD' }));
    expect(items).toHaveLength(3);
    for (const p of items) {
      expect(p.status).toBe('active');
      expect(p.variants[0]?.price?.currency).toBe('CAD');
    }
  });

  it('derives status from available_on and how the product was found', () => {
    const now = Date.parse('2026-06-01T00:00:00Z');
    expect(v1ProductStatus(null, false, now)).toBe('draft');
    expect(v1ProductStatus('2026-07-01T00:00:00Z', false, now)).toBe('draft');
    expect(v1ProductStatus('2026-05-01T00:00:00Z', false, now)).toBe('active');
    expect(v1ProductStatus('2026-05-01T00:00:00Z', true, now)).toBe('archived');
    expect(isAvailableOn('garbage', now)).toBe(false);
    expect(mapV1Product({ ...show, available_on: null }, { currency: 'USD' }).status).toBe('draft');
    expect(mapV1Product(show, { currency: 'USD', archived: true }).status).toBe('archived');
  });

  it('leaves untracked inventory as null rather than Infinity', () => {
    const master = { ...show.master, track_inventory: false, total_on_hand: 'Infinity' };
    expect(mapV1Product({ ...show, master }, { currency: 'USD' }).variants[0]?.totalOnHand).toBeNull();
    const odd = { ...show.master, total_on_hand: 'Infinity' };
    expect(mapV1Product({ ...show, master: odd }, { currency: 'USD' }).variants[0]?.totalOnHand).toBeNull();
  });

  it('maps product images to thumbnails and full-size images', () => {
    const image = { id: 9, alt: 'Front', small_url: '/s.jpg', product_url: '/p.jpg', large_url: '/l.jpg' };
    const p = mapV1Product({ ...show, master: { ...show.master, images: [image] } }, { currency: 'USD' });
    expect(p.imageUrl).toBe('/p.jpg');
    expect(p.images).toEqual([{ url: '/l.jpg', alt: 'Front' }]);
  });

  it('maps users, taking names and phone from their addresses', () => {
    const users = rec('4.2', 'users.list.json').users.map((u: Parameters<typeof mapV1User>[0]) =>
      mapV1User(u),
    );
    expect(users.length).toBeGreaterThan(0);
    expect(users[0]).toMatchObject({ ordersCount: null, totalSpent: null, defaultAddress: null });
    const user = rec('4.2', 'users.show.json');
    const c = mapV1User(
      {
        ...user,
        ship_address: {
          firstname: 'Ada',
          lastname: 'Lovelace',
          company: null,
          address1: '1 Main St',
          address2: null,
          city: 'Portland',
          zipcode: '97201',
          phone: '555-0100',
          state_name: null,
          state_text: 'OR',
          country: { iso: 'US' },
          state: { name: 'Oregon', abbr: 'OR' },
        },
      },
      { ordersCount: 5 },
    );
    expect(c).toMatchObject({
      id: '3',
      email: 'customer1@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '555-0100',
      ordersCount: 5,
      defaultAddress: { city: 'Portland', stateCode: 'OR', countryIso: 'US' },
    });
  });
});

describe('Spree 6.0 Admin API v3 catalog recordings', () => {
  it('maps a product with option variants and prefixed ids', () => {
    const p = mapV3Product(rec('6.0', 'products.show.json'));
    expect(p).toMatchObject({ id: 'prod_UkLWZg9DAJ', name: 'Automatic Espresso Machine', status: 'active' });
    expect(p.variants).toHaveLength(3);
    expect(p.variants[0]).toMatchObject({
      id: expect.stringMatching(/^variant_/),
      isMaster: false,
      optionsText: 'Color: Matte Black',
      price: { amount: '879.99', currency: 'USD' },
      // 0.00 means "no compare-at price".
      compareAtPrice: null,
      purchasable: true,
    });
    expect(p.variants[0]?.totalOnHand).toBeGreaterThan(0);
    expect(p.variants[0]?.optionValues[0]).toMatchObject({
      presentation: 'Matte Black',
      optionTypeId: 'opt_UkLWZg9DAJ',
    });
    expect(p.optionTypes[0]).toMatchObject({ name: 'color', presentation: 'Color' });
    expect(p.updatedAt).toBeTruthy();
    expect(sellableVariants(p)).toHaveLength(3);
  });

  it('maps every list item, with untracked inventory as null', () => {
    const items = rec('6.0', 'products.list.json').data.map(mapV3Product);
    expect(items).toHaveLength(3);
    for (const p of items) {
      expect(p.status).toBe('active');
      expect(p.variants.length).toBeGreaterThan(0);
    }
    const digital = items.find((p: { name: string }) => p.name === 'The Spree Commerce Handbook');
    expect(digital?.variants[0]?.totalOnHand).toBeNull();
  });

  it('keeps a real compare-at price and treats soft-deleted products as archived', () => {
    const raw = rec('6.0', 'products.show.json');
    const variant = raw.variants[0];
    const priced = { ...variant, price: { ...variant.price, compare_at_amount: '999.00' } };
    const p = mapV3Product({ ...raw, variants: [priced], deleted_at: '2026-11-26T00:00:00Z' });
    expect(p.variants[0]?.compareAtPrice).toEqual({ amount: '999.00', currency: 'USD' });
    expect(p.status).toBe('archived');
    expect(mapV3Product({ ...raw, status: 'proposed' }).status).toBe('unknown');
  });

  it('maps customers with order totals and their default address', () => {
    const c = mapV3Customer(rec('6.0', 'customers.show.json'), 'USD');
    expect(c).toMatchObject({
      id: 'cust_YHETxCGlb0',
      email: 'customer1@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(c.ordersCount).toBeGreaterThan(0);
    expect(c.totalSpent?.currency).toBe('USD');
    const list = rec('6.0', 'customers.list.json').data.map((x: Parameters<typeof mapV3Customer>[0]) =>
      mapV3Customer(x, 'USD'),
    );
    expect(list).toHaveLength(3);
    expect(list.some((x: { defaultAddress: unknown }) => x.defaultAddress !== null)).toBe(true);
  });
});
