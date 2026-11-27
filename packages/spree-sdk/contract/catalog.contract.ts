import { addMoney, money, type Product, sellableVariants, type Variant } from '@instincts/spree-domain';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createAdapter } from '../src/adapters';
import { probeStore } from '../src/capabilities/probe';
import type { SpreeAdapter } from '../src/ports';
import { baseTransport, enabled, env, proves, signIn, writeResults } from './env';

/** A value the test can't go on without. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const usable = (v: Variant) => v.price !== null && v.totalOnHand !== null && !!v.sku;

/**
 * Products, inventory and customers against a live store. Every write is undone in `finally`
 * (names, statuses, prices, SKUs and stock levels go back to what they were).
 */
describe.runIf(enabled)(`catalog contract: Spree ${env.label}`, () => {
  let adapter: SpreeAdapter;
  /** An active product with a priced, stock-tracked sellable variant. */
  let sample: Product;
  let variant: Variant;

  beforeAll(async () => {
    const transport = baseTransport();
    const auth = await signIn(transport);
    const probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
    // Like the app: the companion gem's endpoints come along when the store has it.
    adapter = createAdapter(env.family ?? probe.preferredApi, transport.withAuth(auth), {
      companion: probe.gem !== null,
    });
    // Newest first: seeded orders tend to use the oldest products, which orders tests restock.
    const page = await adapter.products.list({ status: 'active', perPage: 50 });
    sample = must(
      page.items.find((p) => sellableVariants(p).some(usable)),
      'an active product with a priced, stock-tracked variant',
    );
    variant = must(sellableVariants(sample).find(usable), 'variant');
  });

  afterAll(writeResults);

  // --- products.read ---------------------------------------------------------------------------

  proves('products.read', 'lists products as valid domain products', async () => {
    const page = await adapter.products.list({ perPage: 10 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.totalCount).toBeGreaterThan(0);
    for (const p of page.items) {
      expect(p.variants.length).toBeGreaterThan(0);
      expect(['active', 'draft', 'archived']).toContain(p.status);
    }
    expect(page.items.some((p) => p.variants.some((v) => v.price !== null))).toBe(true);
  });

  proves('products.read', 'pages with a cursor', async () => {
    const first = await adapter.products.list({ perPage: 3 });
    expect(first.nextCursor).not.toBeNull();
    const second = await adapter.products.list({ perPage: 3, cursor: first.nextCursor });
    expect(second.items.length).toBeGreaterThan(0);
    const firstIds = new Set(first.items.map((p) => p.id));
    for (const p of second.items) expect(firstIds.has(p.id)).toBe(false);
  });

  proves('products.read', 'searches by name and by SKU', async () => {
    const byName = await adapter.products.list({ query: sample.name, perPage: 50 });
    expect(byName.items.map((p) => p.id)).toContain(sample.id);
    const bySku = await adapter.products.list({ query: must(variant.sku, 'sku'), perPage: 50 });
    expect(bySku.items.map((p) => p.id)).toContain(sample.id);
  });

  proves('products.read', 'gets a product by id with priced variants and stock', async () => {
    const p = await adapter.products.get(sample.id);
    expect(p).toMatchObject({ id: sample.id, name: sample.name, status: 'active' });
    const v = p.variants.find((x) => x.id === variant.id);
    expect(v?.price?.currency).toMatch(/^[A-Z]{3}$/);
    expect(v?.sku).toBe(variant.sku);
    expect(typeof v?.totalOnHand).toBe('number');
  });

  proves('products.read', 'filters by status', async () => {
    const active = await adapter.products.list({ status: 'active', perPage: 10 });
    expect(active.items.length).toBeGreaterThan(0);
    for (const p of active.items) expect(p.status).toBe('active');
    for (const status of ['draft', 'archived'] as const) {
      const page = await adapter.products.list({ status, perPage: 10 });
      for (const p of page.items) expect(p.status).toBe(status);
    }
  });

  // --- products.write --------------------------------------------------------------------------

  proves('products.write', 'renames a product and restores the name', async () => {
    const renamed = `${sample.name} (contract)`;
    try {
      const after = await adapter.products.update(sample, { name: renamed });
      expect(after.name).toBe(renamed);
      expect((await adapter.products.get(sample.id)).name).toBe(renamed);
    } finally {
      const restored = await adapter.products.update(sample, { name: sample.name });
      expect(restored.name).toBe(sample.name);
    }
  });

  proves('products.write', 'moves a product to draft and archived, and back to active', async () => {
    try {
      const draft = await adapter.products.update(sample, { status: 'draft' });
      expect(draft.status).toBe('draft');
      const drafts = await adapter.products.list({ status: 'draft', query: sample.name, perPage: 50 });
      expect(drafts.items.map((p) => p.id)).toContain(sample.id);

      const archived = await adapter.products.update(sample, { status: 'archived' });
      expect(archived.status).toBe('archived');
      expect((await adapter.products.get(sample.id)).status).toBe('archived');
      const archivedList = await adapter.products.list({
        status: 'archived',
        query: sample.name,
        perPage: 50,
      });
      expect(archivedList.items.map((p) => p.id)).toContain(sample.id);
      const all = await adapter.products.list({ query: sample.name, perPage: 50 });
      expect(all.items.find((p) => p.id === sample.id)?.status).toBe('archived');
    } finally {
      const active = await adapter.products.update(sample, { status: 'active' });
      expect(active.status).toBe('active');
    }
  });

  /** API v1 renders no compare_at_price; the 4.2 Storefront API v2 does, for active products. */
  async function storefrontCompareAt(slug: string, v: Variant): Promise<string | null> {
    const res = await fetch(`${env.url}/api/v2/storefront/products/${slug}?include=variants`);
    const body = (await res.json()) as {
      data: { attributes: { compare_at_price: string | null } };
      included?: { id: string; type: string; attributes: { compare_at_price: string | null } }[];
    };
    if (v.isMaster) return body.data.attributes.compare_at_price;
    return (
      body.included?.find((i) => i.type === 'variant' && i.id === v.id)?.attributes.compare_at_price ?? null
    );
  }

  async function roundTripVariant(v: Variant): Promise<void> {
    const price = must(v.price, 'price');
    const newPrice = addMoney(price, money('1', price.currency));
    const compareAt = addMoney(price, money('5', price.currency));
    const sku = `${v.sku ?? 'SKU'}-CT`;
    const v1 = adapter.family === 'api-v1';
    const originalCompareAt = v1
      ? await storefrontCompareAt(sample.slug, v)
      : (v.compareAtPrice?.amount ?? null);
    try {
      const after = await adapter.products.updateVariant(sample, v.id, {
        price: newPrice.amount,
        compareAtPrice: compareAt.amount,
        sku,
      });
      const changed = after.variants.find((x) => x.id === v.id);
      expect(changed?.price).toEqual(newPrice);
      expect(changed?.sku).toBe(sku);
      if (v1) {
        expect(Number(await storefrontCompareAt(after.slug, v))).toBe(Number(compareAt.amount));
      } else {
        expect(changed?.compareAtPrice).toEqual(compareAt);
      }
    } finally {
      const restored = await adapter.products.updateVariant(sample, v.id, {
        price: price.amount,
        compareAtPrice: originalCompareAt,
        sku: v.sku,
      });
      const back = restored.variants.find((x) => x.id === v.id);
      expect(back?.price).toEqual(price);
      expect(back?.sku).toBe(v.sku);
      if (v1) expect(await storefrontCompareAt(sample.slug, v)).toBe(originalCompareAt);
      else expect(back?.compareAtPrice ?? null).toEqual(v.compareAtPrice);
    }
  }

  proves(
    'products.write',
    'updates a variant price, compare-at price and SKU, then restores them',
    async () => {
      await roundTripVariant(variant);
    },
  );

  proves(
    'products.write',
    "updates the master variant's price through the product (API v1)",
    async (skip) => {
      const master = sample.variants.find((v) => v.isMaster && v.price !== null);
      if (!master || master.id === variant.id)
        return skip('no separate master variant (Spree 5.4+ has none)');
      await roundTripVariant(master);
    },
  );

  // --- inventory.adjust ------------------------------------------------------------------------

  proves('inventory.adjust', 'sets the on-hand count at the default location and restores it', async () => {
    const before = (await adapter.products.get(sample.id)).variants.find((v) => v.id === variant.id);
    const total0 = must(before?.totalOnHand, 'on-hand count');
    const onHand = async (p: Product) => p.variants.find((v) => v.id === variant.id)?.totalOnHand;
    let others: number | null = null;
    try {
      const t1 = must(await onHand(await adapter.products.setStock(sample, variant.id, 7)), 'on-hand count');
      // Other locations keep their stock (possibly negative when backordered), so the total moves
      // by exactly what this location moved. Totals can also drift on their own (Spree 6 nets out
      // expiring cart reservations), so only changes made here are asserted.
      others = t1 - 7;
      expect(await onHand(await adapter.products.setStock(sample, variant.id, 9))).toBe(t1 + 2);
    } finally {
      if (others !== null) await adapter.products.setStock(sample, variant.id, total0 - others);
    }
  });

  proves(
    'inventory.lowStock',
    'lists a product once a tracked variant runs out, then restores it',
    async (skip) => {
      const caps = (await probeStore({ baseUrl: env.url, timeoutMs: 10_000 })).capabilities;
      if (!caps.includes('inventory.lowStock')) return skip('store has no low-stock list');
      const before = (await adapter.products.get(sample.id)).variants.find((v) => v.id === variant.id);
      const total0 = must(before?.totalOnHand, 'on-hand count');
      const onHand = async (p: Product) => p.variants.find((v) => v.id === variant.id)?.totalOnHand;
      let others: number | null = null;
      try {
        const t1 = must(
          await onHand(await adapter.products.setStock(sample, variant.id, 0)),
          'on-hand count',
        );
        others = t1;
        if (others > 2) return skip('the variant has stock at other locations');
        const ids: string[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 10; page++) {
          const res = await adapter.products.list({ lowStock: true, perPage: 100, cursor });
          ids.push(...res.items.map((p) => p.id));
          if (!res.nextCursor) break;
          cursor = res.nextCursor;
        }
        expect(ids).toContain(sample.id);
      } finally {
        // Totals can drift on their own (expiring reservations), so the restore isn't asserted.
        if (others !== null) await adapter.products.setStock(sample, variant.id, total0 - others);
      }
    },
  );

  // --- customers.read --------------------------------------------------------------------------

  proves('customers.read', 'lists customers as valid domain customers', async () => {
    const page = await adapter.customers.list({ perPage: 5 });
    expect(page.items.length).toBeGreaterThan(0);
    for (const c of page.items) expect(c.email).toContain('@');
  });

  proves('customers.read', 'pages with a cursor', async () => {
    const first = await adapter.customers.list({ perPage: 2 });
    expect(first.nextCursor).not.toBeNull();
    const second = await adapter.customers.list({ perPage: 2, cursor: first.nextCursor });
    expect(second.items.length).toBeGreaterThan(0);
    const firstIds = new Set(first.items.map((c) => c.id));
    for (const c of second.items) expect(firstIds.has(c.id)).toBe(false);
  });

  proves('customers.read', 'searches by email and gets a customer with an order count', async (skip) => {
    const email = 'customer1@example.com';
    const page = await adapter.customers.list({ query: email });
    const found = page.items.find((c) => c.email === email);
    if (!found) return skip(`no ${email} in this store's seed`);
    const c = await adapter.customers.get(found.id);
    expect(c).toMatchObject({ id: found.id, email });
    // Seeded with completed orders on both stores.
    expect(c.ordersCount).toBeGreaterThan(0);
  });

  proves('customers.read', 'searches by name', async (skip) => {
    const named = (await adapter.customers.list({ perPage: 50 })).items.find((c) => c.firstName);
    if (!named?.firstName) return skip('no customer with a name (4.2 names come from saved addresses)');
    const page = await adapter.customers.list({ query: named.firstName });
    expect(page.items.map((c) => c.id)).toContain(named.id);
  });
});
