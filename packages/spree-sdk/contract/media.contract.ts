import { type Product, type ProductImage, sellableVariants } from '@instincts/spree-domain';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createAdapter } from '../src/adapters';
import { probeStore } from '../src/capabilities/probe';
import type { SpreeAdapter } from '../src/ports';
import { baseTransport, enabled, env, proves, signIn, writeResults } from './env';
import { png } from './png';

const ids = (gallery: ProductImage[]) => gallery.map((i) => i.id);

/**
 * Product photos and the store-wide media list against a live store. Uploads to one product and
 * deletes what it uploaded in afterAll; images other people put on the product are left alone and
 * only the uploaded ones' relative order is asserted.
 */
describe.runIf(enabled)(`media contract: Spree ${env.label}`, () => {
  let adapter: SpreeAdapter;
  let product: Product;
  const run = Date.now().toString(36);
  const uploaded: string[] = [];
  let first = '';
  let second = '';

  beforeAll(async () => {
    const probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
    const transport = baseTransport();
    const auth = await signIn(transport);
    adapter = createAdapter(env.family ?? probe.preferredApi, transport.withAuth(auth), {
      companion: probe.gem !== null,
    });
    // A product with option variants, so assigning a photo to a variant can be proven too.
    const page = await adapter.products.list({ status: 'active', perPage: 25 });
    const withOptions = page.items.find((p) => sellableVariants(p).some((v) => !v.isMaster));
    product = withOptions ?? (page.items[0] as Product);
    expect(product).toBeDefined();
  });

  afterAll(async () => {
    for (const id of uploaded) await adapter.media.remove(product, id).catch(() => undefined);
    writeResults();
  });

  proves('products.media', 'uploads photos with alt text, appended to the gallery', async () => {
    const before = await adapter.media.list(product);
    let gallery = await adapter.media.upload(product, {
      file: { blob: png([200, 40, 40]), name: `contract-${run}-a.png`, type: 'image/png' },
      alt: `Contract ${run} front`,
    });
    const added = gallery.filter((i) => !before.some((b) => b.id === i.id));
    expect(added).toHaveLength(1);
    first = (added[0] as ProductImage).id;
    uploaded.push(first);
    gallery = await adapter.media.upload(product, {
      file: { blob: png([40, 40, 200]), name: `contract-${run}-b.png`, type: 'image/png' },
    });
    second = gallery.find((i) => !before.some((b) => b.id === i.id) && i.id !== first)?.id ?? '';
    expect(second).not.toBe('');
    uploaded.push(second);

    const mine = gallery.filter((i) => uploaded.includes(i.id));
    expect(ids(mine)).toEqual([first, second]);
    expect(mine[0]).toMatchObject({ alt: `Contract ${run} front`, variantIds: [] });
    expect(mine[1]?.alt).toBeNull();
    // The renditions are real images anyone can fetch (the app shows them without auth headers).
    for (const url of [mine[0]?.url, mine[0]?.thumbUrl]) {
      const res = await fetch(url as string);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^image\//);
    }
    expect(ids(await adapter.media.list(product))).toEqual(ids(gallery));
  });

  proves('products.media', 'sets and clears alt text', async (skip) => {
    if (!second) return skip('nothing uploaded');
    let gallery = await adapter.media.update(product, second, { alt: `Contract ${run} back` });
    expect(gallery.find((i) => i.id === second)?.alt).toBe(`Contract ${run} back`);
    gallery = await adapter.media.update(product, second, { alt: '' });
    expect(gallery.find((i) => i.id === second)?.alt).toBeNull();
  });

  proves('products.media', 'moves a photo earlier, and makes one the main photo', async (skip) => {
    if (!second) return skip('nothing uploaded');
    let gallery = await adapter.media.list(product);
    gallery = await adapter.media.move(
      product,
      second,
      gallery.findIndex((i) => i.id === first),
    );
    expect(ids(gallery).filter((id) => uploaded.includes(id))).toEqual([second, first]);
    gallery = await adapter.media.move(product, first, 0);
    expect(gallery[0]?.id).toBe(first);
    expect(ids(gallery).filter((id) => uploaded.includes(id))).toEqual([first, second]);
  });

  proves('products.media', 'shows a photo for one variant, then for all', async (skip) => {
    if (!second) return skip('nothing uploaded');
    const variant = sellableVariants(product).find((v) => !v.isMaster);
    if (!variant) return skip('no product with option variants');
    let gallery = await adapter.media.update(product, second, { variantIds: [variant.id] });
    expect(gallery.find((i) => i.id === second)?.variantIds).toEqual([variant.id]);
    gallery = await adapter.media.update(product, second, { variantIds: [] });
    expect(gallery.find((i) => i.id === second)?.variantIds).toEqual([]);
  });

  proves('media.library', 'lists product photos store-wide with their product', async (skip) => {
    if (!first) return skip('nothing uploaded');
    // Newest first on both stores (Spree 6's library, the companion gem); a few pages for
    // concurrent uploads by other people.
    let cursor: string | null = null;
    let found = false;
    for (let n = 0; n < 4 && !found; n++) {
      const page = await adapter.media.library({ perPage: 50, cursor });
      const hit = page.items.find((i) => i.id === first);
      if (hit) {
        found = true;
        expect(hit).toMatchObject({ productId: product.id, productName: product.name });
      }
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(found).toBe(true);
  });

  proves('media.library', 'searches by product name and filters to missing alt text', async (skip) => {
    if (!second) return skip('nothing uploaded');
    const all = await adapter.media.library({ query: product.name, perPage: 100 });
    expect(ids(all.items)).toEqual(expect.arrayContaining([first, second]));
    for (const i of all.items) expect(i.productName?.toLowerCase()).toContain(product.name.toLowerCase());
    const missing = await adapter.media.library({ query: product.name, missingAlt: true, perPage: 100 });
    expect(ids(missing.items)).toContain(second);
    expect(ids(missing.items)).not.toContain(first);
    for (const i of missing.items) expect(i.alt).toBeNull();
  });

  proves('products.media', 'deletes photos', async (skip) => {
    if (!second) return skip('nothing uploaded');
    let gallery = await adapter.media.remove(product, second);
    expect(ids(gallery)).not.toContain(second);
    gallery = await adapter.media.remove(product, first);
    expect(ids(gallery)).not.toContain(first);
    uploaded.length = 0;
  });
});
