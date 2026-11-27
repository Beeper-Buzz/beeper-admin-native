import type { Media } from '@spree/admin-sdk';
import { describe, expect, it } from 'vitest';
import { fakeTransport } from '../fakeTransport.test-helper';
import { adminV3Media, mapV3Image } from './media';

function media(id: string, position: number, extra: Partial<Media> = {}): Media {
  return {
    id,
    product_id: 'prod_1',
    variant_ids: [],
    position,
    alt: null,
    media_type: 'image',
    mini_url: `https://shop.test/mini/${id}.webp`,
    small_url: `https://shop.test/small/${id}.webp`,
    medium_url: null,
    large_url: `https://shop.test/large/${id}.webp`,
    original_url: `https://shop.test/original/${id}.png`,
    ...extra,
  } as Media;
}

const page = <T>(data: T[], next: number | null = null) => ({
  data,
  meta: { page: 1, limit: 25, count: data.length, pages: 1, next, previous: null },
});

describe('mapV3Image', () => {
  it('maps an image and leaves videos out', () => {
    expect(mapV3Image(media('media_1', 2, { alt: ' ', variant_ids: ['variant_1'] }))).toEqual({
      id: 'media_1',
      url: 'https://shop.test/large/media_1.webp',
      thumbUrl: 'https://shop.test/small/media_1.webp',
      alt: null,
      position: 2,
      variantIds: ['variant_1'],
    });
    expect(mapV3Image(media('media_2', 1, { media_type: 'external_video' }))).toBeNull();
  });
});

function store() {
  return fakeTransport((method, url) => {
    if (method === 'GET' && url.startsWith('/api/v3/admin/products/prod_1/media'))
      return page([media('media_b', 2, { alt: 'Back' }), media('media_a', 1)]);
    if (method === 'POST' && url === '/api/v3/admin/files') return { signed_id: 'signed-1' };
    if (method !== 'GET') return {};
    return undefined;
  });
}

const file = { blob: new Blob(['x'], { type: 'image/jpeg' }), name: 'photo.jpg', type: 'image/jpeg' };

describe('adminV3Media', () => {
  it('reads the gallery in position order', async () => {
    const { transport, calls } = store();
    expect((await adminV3Media(transport).list({ id: 'prod_1' })).map((i) => i.id)).toEqual([
      'media_a',
      'media_b',
    ]);
    expect(calls[0]?.url).toBe('/api/v3/admin/products/prod_1/media?limit=100');
  });

  it('uploads the file first, then creates the media from its signed id', async () => {
    const { transport, calls } = store();
    await adminV3Media(transport).upload({ id: 'prod_1' }, { file, alt: 'Front', variantIds: ['variant_1'] });
    const [upload, create] = calls.filter((c) => c.method === 'POST');
    expect(upload?.url).toBe('/api/v3/admin/files');
    const form = upload?.body as FormData;
    expect((form.get('file') as File).name).toBe('photo.jpg');
    expect(form.get('filename')).toBe('photo.jpg');
    expect(form.get('content_type')).toBe('image/jpeg');
    expect(create).toMatchObject({
      url: '/api/v3/admin/products/prod_1/media',
      body: { signed_id: 'signed-1', alt: 'Front', variant_ids: ['variant_1'] },
    });
  });

  it('patches alt text and variants, clearing with null and []', async () => {
    const { transport, calls } = store();
    await adminV3Media(transport).update({ id: 'prod_1' }, 'media_b', { alt: '  ', variantIds: [] });
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/api/v3/admin/products/prod_1/media/media_b',
      body: { alt: null, variant_ids: [] },
    });
  });

  it("moves by taking the target's position", async () => {
    const { transport, calls } = store();
    const port = adminV3Media(transport);
    await port.move({ id: 'prod_1' }, 'media_b', 0);
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/api/v3/admin/products/prod_1/media/media_b',
      body: { position: 1 },
    });
    await port.move({ id: 'prod_1' }, 'media_a', 0);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('deletes a placement, and refuses an image the product does not have', async () => {
    const { transport, calls } = store();
    await adminV3Media(transport).remove({ id: 'prod_1' }, 'media_a');
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/v3/admin/products/prod_1/media/media_a');
    await expect(adminV3Media(transport).remove({ id: 'prod_1' }, 'media_x')).rejects.toMatchObject({
      kind: 'notFound',
    });
  });
});

describe('adminV3Media.library', () => {
  it('lists the media library, placed product images only, with product names', async () => {
    const { transport, calls } = fakeTransport((_m, url) => {
      if (url.startsWith('/api/v3/admin/media'))
        return page([media('media_a', 1), media('media_c', 1, { product_id: null })], 2);
      if (url.startsWith('/api/v3/admin/products')) return page([{ id: 'prod_1', name: 'Tote' }]);
      return undefined;
    });
    const res = await adminV3Media(transport).library({ missingAlt: true, perPage: 2 });
    expect(calls[0]?.url).toBe(
      '/api/v3/admin/media?q[attached]=1&q[media_type_eq]=image&q[alt_blank]=1&page=1&limit=2',
    );
    expect(calls[1]?.url).toBe('/api/v3/admin/products?q[id_in][]=prod_1&limit=100');
    expect(res.items).toEqual([
      expect.objectContaining({ id: 'media_a', productId: 'prod_1', productName: 'Tote' }),
    ]);
    expect(res.nextCursor).toBe('2');
  });

  it('searches by product name through products, filtering missing alt', async () => {
    const { transport, calls } = fakeTransport((_m, url) =>
      url.startsWith('/api/v3/admin/products')
        ? page([
            {
              id: 'prod_1',
              name: 'Tote',
              media: [media('media_a', 1), media('media_b', 2, { alt: 'Back' })],
            },
          ])
        : undefined,
    );
    const res = await adminV3Media(transport).library({ query: 'tote', missingAlt: true });
    expect(calls[0]?.url).toBe(
      '/api/v3/admin/products?q[search]=tote&page=1&limit=25&sort=-created_at&expand=media',
    );
    expect(res).toEqual({
      items: [expect.objectContaining({ id: 'media_a', productName: 'Tote' })],
      nextCursor: null,
    });
  });
});
