import { describe, expect, it } from 'vitest';
import { fakeTransport } from '../fakeTransport.test-helper';
import type { V1Image, V1Product, V1Variant } from './mapProduct';
import { apiV1Media, v1Gallery } from './media';

const img = (id: number, position: number, alt: string | null = null): V1Image => ({
  id,
  position,
  alt,
  mini_url: `https://shop.test/mini/${id}.png`,
  product_url: `https://shop.test/product/${id}.png`,
  large_url: `https://shop.test/large/${id}.png`,
});

const variant = (id: number, isMaster: boolean, images: V1Image[]): V1Variant => ({
  id,
  sku: `SKU-${id}`,
  price: '10.0',
  is_master: isMaster,
  options_text: isMaster ? '' : 'Size: S',
  track_inventory: true,
  total_on_hand: 4,
  images,
});

function product(): V1Product {
  return {
    id: 7,
    name: 'Tote',
    slug: 'tote',
    description: null,
    available_on: '2026-01-01T00:00:00Z',
    // Out of order on purpose: the gallery sorts by position within each owner.
    master: variant(70, true, [img(2, 2, 'Back'), img(1, 1, '  ')]),
    variants: [variant(71, false, [img(3, 1, 'Red')])],
  };
}

describe('v1Gallery', () => {
  it('lists master images then variant images, each by position, with blank alt as null', () => {
    expect(v1Gallery(product()).map(({ viewableId, ...i }) => ({ ...i, viewableId }))).toEqual([
      {
        id: '1',
        url: 'https://shop.test/large/1.png',
        thumbUrl: 'https://shop.test/product/1.png',
        alt: null,
        position: 1,
        variantIds: [],
        viewableId: 70,
      },
      expect.objectContaining({ id: '2', alt: 'Back', position: 2, variantIds: [] }),
      expect.objectContaining({ id: '3', alt: 'Red', position: 1, variantIds: ['71'], viewableId: 71 }),
    ]);
  });
});

function store() {
  return fakeTransport((method, url) => {
    if (method === 'GET' && url.startsWith('/api/v1/products/7')) return product();
    if (method !== 'GET') return {};
    return undefined;
  });
}

const file = { blob: new Blob(['x'], { type: 'image/jpeg' }), name: 'photo.jpg', type: 'image/jpeg' };

describe('apiV1Media', () => {
  it('reads the gallery without the public cache', async () => {
    const { transport, calls } = store();
    const gallery = await apiV1Media(transport).list({ id: '7' });
    expect(gallery.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(calls[0]?.headers).toMatchObject({ 'Cache-Control': 'no-cache' });
  });

  it('uploads multipart to the master, or to the chosen variant', async () => {
    const { transport, calls } = store();
    const media = apiV1Media(transport);
    await media.upload({ id: '7' }, { file, alt: ' Front ' });
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/v1/products/7/images');
    const form = post?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('image[alt]')).toBe('Front');
    expect((form.get('image[attachment]') as File).name).toBe('photo.jpg');

    await media.upload({ id: '7' }, { file, variantIds: ['71'] });
    const second = calls.filter((c) => c.method === 'POST')[1];
    expect(second?.url).toBe('/api/v1/variants/71/images');
    expect((second?.body as FormData | undefined)?.has('image[alt]')).toBe(false);
  });

  it('refuses more than one variant: Spree 4 keeps an image on one', async () => {
    const { transport } = store();
    await expect(
      apiV1Media(transport).upload({ id: '7' }, { file, variantIds: ['71', '72'] }),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('updates alt text and the variant through the image’s own endpoint', async () => {
    const { transport, calls } = store();
    const media = apiV1Media(transport);
    await media.update({ id: '7' }, '2', { alt: '', variantIds: ['71'] });
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      url: '/api/v1/products/7/images/2',
      body: { image: { alt: null, viewable_id: 71 } },
    });
    await media.update({ id: '7' }, '3', { variantIds: [] });
    expect(calls.filter((c) => c.method === 'PUT')[1]).toMatchObject({
      url: '/api/v1/variants/71/images/3',
      body: { image: { viewable_id: 70 } },
    });
  });

  it('skips the write when nothing changes', async () => {
    const { transport, calls } = store();
    await apiV1Media(transport).update({ id: '7' }, '3', { variantIds: ['71'] });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it("moves by taking the target's position, only within one owner", async () => {
    const { transport, calls } = store();
    const media = apiV1Media(transport);
    await media.move({ id: '7' }, '2', 0);
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      url: '/api/v1/products/7/images/2',
      body: { image: { position: 1 } },
    });
    await expect(media.move({ id: '7' }, '3', 1)).rejects.toMatchObject({ kind: 'invalid' });
    await media.move({ id: '7' }, '1', 0);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('deletes through the variant endpoint for a variant image', async () => {
    const { transport, calls } = store();
    await apiV1Media(transport).remove({ id: '7' }, '3');
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/v1/variants/71/images/3');
    await expect(apiV1Media(transport).remove({ id: '7' }, '99')).rejects.toMatchObject({
      kind: 'notFound',
    });
  });
});

describe('apiV1Media.library', () => {
  const list = (products: V1Product[], n: number, pages: number) => ({
    products,
    count: products.length,
    total_count: 99,
    current_page: n,
    per_page: 25,
    pages,
  });

  it('without the gem, flattens product galleries and filters missing alt across pages', async () => {
    const { transport, calls } = fakeTransport((_m, url) => {
      if (url.includes('page=1')) return list([product()], 1, 2);
      if (url.includes('page=2'))
        return list(
          [{ ...product(), id: 8, name: 'Bag', master: variant(80, true, [img(9, 1)]), variants: [] }],
          2,
          2,
        );
      return undefined;
    });
    const page = await apiV1Media(transport).library({ query: 'to', missingAlt: true, perPage: 2 });
    expect(page.items.map((i) => [i.id, i.productId, i.productName])).toEqual([
      ['1', '7', 'Tote'],
      ['9', '8', 'Bag'],
    ]);
    expect(page.nextCursor).toBeNull();
    expect(calls[0]?.url).toBe(
      '/api/v1/products?q[s]=id desc&q[name_or_variants_including_master_sku_cont]=to&page=1&per_page=25&show_discontinued=1',
    );
  });

  it('continues mid-page with a page:offset cursor', async () => {
    const { transport } = fakeTransport(() => list([product()], 1, 1));
    const media = apiV1Media(transport);
    const first = await media.library({ perPage: 2 });
    expect(first.items.map((i) => i.id)).toEqual(['1', '2']);
    expect(first.nextCursor).toBe('1:2');
    const second = await media.library({ perPage: 2, cursor: first.nextCursor });
    expect(second.items.map((i) => i.id)).toEqual(['3']);
  });

  it('uses the gem endpoint when the store has it', async () => {
    const { transport, calls } = fakeTransport((_m, url) =>
      url.startsWith('/api/admin_native/v1/media')
        ? {
            data: [
              {
                id: '5',
                product_id: '7',
                product_name: 'Tote',
                variant_id: '71',
                alt: null,
                position: 1,
                mini_url: 'https://shop.test/mini/5.png',
                product_url: 'https://shop.test/product/5.png',
                large_url: 'https://shop.test/large/5.png',
              },
            ],
            meta: { page: 1, per_page: 1, total_count: 3 },
          }
        : undefined,
    );
    const page = await apiV1Media(transport, { companion: true }).library({
      query: 'tote',
      missingAlt: true,
      perPage: 1,
    });
    expect(calls[0]?.url).toBe('/api/admin_native/v1/media?q=tote&missing_alt=1&page=1&per_page=1');
    expect(page).toEqual({
      items: [
        {
          id: '5',
          url: 'https://shop.test/large/5.png',
          thumbUrl: 'https://shop.test/product/5.png',
          alt: null,
          position: 1,
          variantIds: ['71'],
          productId: '7',
          productName: 'Tote',
        },
      ],
      nextCursor: '2',
      totalCount: 3,
    });
  });

  it('falls back to scanning when the gem predates the endpoint, and remembers', async () => {
    const { transport, calls } = fakeTransport((_m, url) =>
      url.startsWith('/api/v1/products') ? list([product()], 1, 1) : undefined,
    );
    const media = apiV1Media(transport, { companion: true });
    expect((await media.library({})).items).toHaveLength(3);
    await media.library({});
    expect(calls.filter((c) => c.url.startsWith('/api/admin_native'))).toHaveLength(1);
  });
});
