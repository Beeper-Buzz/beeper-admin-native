import { describe, expect, it } from 'vitest';
import { displayName } from './customer';
import { isLowStock, Product, sellableVariants } from './product';

const usd = (amount: string) => ({ amount, currency: 'USD' });
const variant = (id: string, isMaster: boolean, totalOnHand: number | null) => ({
  id,
  sku: `SKU-${id}`,
  optionsText: null,
  isMaster,
  price: usd('10.00'),
  compareAtPrice: null,
  totalOnHand,
  imageUrl: null,
});
const product = Product.parse({
  id: '1',
  name: 'Tote',
  slug: 'tote',
  status: 'active',
  description: null,
  imageUrl: null,
  updatedAt: '2026-11-26T09:00:00Z',
  variants: [variant('1', true, 0), variant('2', false, 2), variant('3', false, null)],
});

describe('Product', () => {
  it('maps unknown statuses to "unknown"', () => {
    expect(Product.parse({ ...product, status: 'scheduled' }).status).toBe('unknown');
  });
  it('sells option variants when present, else the master', () => {
    expect(sellableVariants(product).map((v) => v.id)).toEqual(['2', '3']);
    expect(sellableVariants({ variants: [variant('1', true, 4)] }).map((v) => v.id)).toEqual(['1']);
  });
  it('treats untracked inventory as never low', () => {
    expect(isLowStock({ totalOnHand: 2 })).toBe(true);
    expect(isLowStock({ totalOnHand: 3 })).toBe(false);
    expect(isLowStock({ totalOnHand: null })).toBe(false);
  });
});

describe('displayName', () => {
  it('falls back to email', () => {
    expect(displayName({ firstName: 'Maya', lastName: 'Ortiz', email: 'm@x.com' })).toBe('Maya Ortiz');
    expect(displayName({ firstName: null, lastName: null, email: 'm@x.com' })).toBe('m@x.com');
  });
});

describe('storefront fields', () => {
  it('default to empty so admin adapters need not fill them', () => {
    const p = Product.parse(product);
    expect(p.optionTypes).toEqual([]);
    expect(p.variants[0]?.optionValues).toEqual([]);
    expect(p.variants[0]?.purchasable).toBeNull();
  });

  it('carry option values with swatches', () => {
    const p = Product.parse({
      ...product,
      optionTypes: [{ id: 'ot1', name: 'color', presentation: 'Color', position: 1 }],
      variants: [
        {
          ...variant('2', false, 3),
          purchasable: true,
          optionValues: [
            {
              id: 'ov1',
              optionTypeId: 'ot1',
              name: 'red',
              presentation: 'Red',
              position: 1,
              color: '#FF0000',
            },
          ],
        },
      ],
    });
    expect(p.variants[0]?.optionValues[0]?.color).toBe('#FF0000');
  });
});
