import { LibraryImage, type Page, ProductImage } from '@instincts/spree-domain';
import type { PaginatedResponse, Media as V3Media, Product as V3Product } from '@spree/admin-sdk';
import { appendFile, cleanAlt, moveTarget, notFound } from '../../media/shared';
import type { ListLibraryParams, MediaPort, MediaUpdate, MediaUploadInput } from '../../ports';
import type { Transport } from '../../transport';
import { parseV1Cursor } from '../api-v1/products';

const PRODUCTS = '/api/v3/admin/products';
/** Server pages a product-name search reads before returning what it has found. */
const MAX_SCAN_PAGES = 5;

const enc = encodeURIComponent;

/** Images only: videos and external videos stay as Spree's dashboard placed them. */
export function mapV3Image(m: V3Media): ProductImage | null {
  if (m.media_type !== 'image') return null;
  const url = m.large_url ?? m.original_url ?? m.medium_url ?? m.small_url;
  if (!url) return null;
  return ProductImage.parse({
    id: m.id,
    url,
    thumbUrl: m.small_url ?? m.medium_url ?? m.mini_url ?? null,
    alt: cleanAlt(m.alt),
    position: m.position,
    variantIds: m.variant_ids ?? [],
  });
}

const images = (media: V3Media[]) =>
  media.flatMap((m) => mapV3Image(m) ?? []).sort((a, b) => a.position - b.position);

/**
 * Admin API v3 (Spree 5.4+/6): a product's gallery is `/products/:id/media`. A file is uploaded to
 * `POST /files` first, and the media row created from its `signed_id`: the media endpoint's own
 * multipart `attachment` is dropped by Spree 6.0.6 ("Attachment can't be blank", FINDINGS.md §h).
 * The store-wide list is Spree's media library (`/media`), or a product search when filtering by name.
 */
export function adminV3Media(transport: Transport): MediaPort {
  const mediaPath = (productId: string) => `${PRODUCTS}/${enc(productId)}/media`;

  async function gallery(productId: string): Promise<ProductImage[]> {
    const res = await transport.request<PaginatedResponse<V3Media>>({
      path: mediaPath(productId),
      query: { limit: 100 },
    });
    return images(res.data.data);
  }

  async function productNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const res = await transport.request<PaginatedResponse<V3Product>>({
      path: PRODUCTS,
      query: { q: { id_in: ids }, limit: 100 },
    });
    return new Map(res.data.data.map((p) => [p.id, p.name]));
  }

  /** The media library: one row per file, newest first. Placed files only, on products only. */
  async function libraryPage(params: ListLibraryParams): Promise<Page<LibraryImage>> {
    const q: Record<string, string> = { attached: '1', media_type_eq: 'image' };
    if (params.missingAlt) q.alt_blank = '1';
    const res = await transport.request<PaginatedResponse<V3Media>>({
      path: '/api/v3/admin/media',
      query: { q, page: Number(params.cursor) || 1, limit: params.perPage ?? 24 },
    });
    const rows = res.data.data.filter((m) => m.product_id);
    const names = await productNames([...new Set(rows.map((m) => m.product_id as string))]);
    return {
      items: rows.flatMap((m) => {
        const image = mapV3Image(m);
        if (!image || !m.product_id) return [];
        return [{ ...image, productId: m.product_id, productName: names.get(m.product_id) ?? null }];
      }),
      nextCursor: res.data.meta.next ? String(res.data.meta.next) : null,
      totalCount: res.data.meta.count,
    };
  }

  /** The library can't filter by product, so a name search reads matching products' galleries. */
  async function searchPage(params: ListLibraryParams): Promise<Page<LibraryImage>> {
    const perPage = params.perPage ?? 24;
    const { page, skip } = parseV1Cursor(params.cursor);
    const items: LibraryImage[] = [];
    let n = page;
    let from = skip;
    for (let scanned = 0; scanned < MAX_SCAN_PAGES; scanned++) {
      const res = await transport.request<PaginatedResponse<V3Product>>({
        path: PRODUCTS,
        query: { q: { search: params.query }, page: n, limit: 25, sort: '-created_at', expand: 'media' },
      });
      const found = res.data.data.flatMap((p) =>
        images(p.media ?? []).map((i) => LibraryImage.parse({ ...i, productId: p.id, productName: p.name })),
      );
      for (let i = from; i < found.length; i++) {
        const image = found[i] as LibraryImage;
        if (!params.missingAlt || image.alt === null) items.push(image);
        if (items.length === perPage) {
          const more = i + 1 < found.length;
          return { items, nextCursor: more ? `${n}:${i + 1}` : res.data.meta.next ? String(n + 1) : null };
        }
      }
      if (!res.data.meta.next) return { items, nextCursor: null };
      n += 1;
      from = 0;
    }
    return { items, nextCursor: String(n) };
  }

  const port: MediaPort = {
    list: (product) => gallery(product.id),

    async upload(product, input: MediaUploadInput) {
      const form = new FormData();
      appendFile(form, 'file', input.file);
      form.append('filename', input.file.name);
      form.append('content_type', input.file.type);
      const file = await transport.request<{ signed_id: string }>({
        method: 'POST',
        path: '/api/v3/admin/files',
        body: form,
        // Large photos on a phone connection take longer than a JSON call.
        timeoutMs: 120_000,
      });
      const body: Record<string, unknown> = { signed_id: file.data.signed_id };
      const alt = cleanAlt(input.alt);
      if (alt) body.alt = alt;
      if (input.variantIds?.length) body.variant_ids = input.variantIds;
      await transport.request({ method: 'POST', path: mediaPath(product.id), body });
      return gallery(product.id);
    },

    async update(product, imageId, patch: MediaUpdate) {
      const body: Record<string, unknown> = {};
      if (patch.alt !== undefined) body.alt = cleanAlt(patch.alt);
      if (patch.variantIds !== undefined) body.variant_ids = patch.variantIds;
      if (Object.keys(body).length > 0)
        await transport.request({
          method: 'PATCH',
          path: `${mediaPath(product.id)}/${enc(imageId)}`,
          body,
        });
      return gallery(product.id);
    },

    async move(product, imageId, toIndex) {
      const move = moveTarget(await gallery(product.id), imageId, toIndex);
      if (move) {
        // acts_as_list shifts the images in between, so taking the target's position is the move.
        await transport.request({
          method: 'PATCH',
          path: `${mediaPath(product.id)}/${enc(imageId)}`,
          body: { position: move.target.position },
        });
      }
      return gallery(product.id);
    },

    async remove(product, imageId) {
      const current = await gallery(product.id);
      if (!current.some((i) => i.id === imageId)) throw notFound(imageId);
      // Removes this placement; a library file placed elsewhere stays there.
      await transport.request({ method: 'DELETE', path: `${mediaPath(product.id)}/${enc(imageId)}` });
      return gallery(product.id);
    },

    library: (params) => (params.query ? searchPage(params) : libraryPage(params)),
  };
  return port;
}
