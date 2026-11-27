import { LibraryImage, type Page, ProductImage } from '@instincts/spree-domain';
import { isSpreeError, SpreeError } from '../../errors';
import { appendFile, cleanAlt, moveTarget, notFound } from '../../media/shared';
import type { ListLibraryParams, MediaPort, MediaUpdate, MediaUploadInput } from '../../ports';
import type { Transport } from '../../transport';
import type { V1Image, V1Product, V1ProductList } from './mapProduct';
import { fetchV1Product, parseV1Cursor, SHOW_ARCHIVED, V1_MAX_SCAN_PAGES, V1_NO_CACHE } from './products';

const GEM = '/api/admin_native/v1/media';

/** Where a v1 image lives: the master (shown for every variant) or one variant. */
interface Placed extends ProductImage {
  viewableId: number;
}

const large = (i: V1Image) => i.large_url ?? i.product_url ?? i.small_url ?? null;
const thumb = (i: V1Image) => i.product_url ?? i.small_url ?? i.large_url ?? null;

/**
 * The gallery Spree 4.x shows: the master's images, then each variant's, each by position.
 * Positions count within their own variant (acts_as_list is scoped to the viewable).
 */
export function v1Gallery(p: Pick<V1Product, 'master' | 'variants'>): Placed[] {
  const owners = [p.master, ...(p.variants ?? [])];
  return owners.flatMap((v) =>
    [...(v.images ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .flatMap((i) => {
        const url = large(i);
        if (!url) return [];
        return [
          {
            ...ProductImage.parse({
              id: String(i.id),
              url,
              thumbUrl: thumb(i),
              alt: cleanAlt(i.alt),
              position: i.position ?? 0,
              variantIds: v.is_master ? [] : [String(v.id)],
            }),
            viewableId: v.id,
          },
        ];
      }),
  );
}

const strip = (gallery: Placed[]): ProductImage[] => gallery.map(({ viewableId: _, ...image }) => image);

interface GemImage {
  id: string;
  product_id: string;
  product_name: string | null;
  variant_id: string | null;
  alt: string | null;
  position: number;
  mini_url: string | null;
  product_url: string | null;
  large_url: string | null;
}

/**
 * API v1 (Spree 4.2–4.3): `/api/v1/products/:id/images` for the master's images and
 * `/api/v1/variants/:id/images` for a variant's, multipart `image[attachment]`. The store-wide list
 * comes from the companion gem when it has `GET media` (0.3+), else from scanning products.
 */
export function apiV1Media(transport: Transport, options: { companion?: boolean } = {}): MediaPort {
  /** null until the first library call finds out whether the gem has the endpoint. */
  let gemLibrary: boolean | null = options.companion ? null : false;

  async function gallery(productId: string) {
    const { raw } = await fetchV1Product(transport, productId);
    return { raw, images: v1Gallery(raw) };
  }

  /** The image's own endpoint: through its product when it's on the master, else its variant. */
  function imagePath(raw: V1Product, image: Placed): string {
    return image.viewableId === raw.master.id
      ? `/api/v1/products/${raw.id}/images/${image.id}`
      : `/api/v1/variants/${image.viewableId}/images/${image.id}`;
  }

  /** The master, or the one variant an image is for (Spree 4.x keeps an image on one variant). */
  function viewableFor(raw: V1Product, variantIds: string[] | undefined): number {
    const ids = variantIds ?? [];
    if (ids.length > 1)
      throw new SpreeError({
        kind: 'invalid',
        status: 422,
        message: 'On this store an image shows for one variant, or for all of them.',
      });
    if (ids.length === 0) return raw.master.id;
    const variant = (raw.variants ?? []).find((v) => String(v.id) === ids[0]);
    if (!variant)
      throw new SpreeError({ kind: 'notFound', status: 404, message: `Variant ${ids[0]} not found.` });
    return variant.id;
  }

  async function scanLibrary(params: ListLibraryParams): Promise<Page<LibraryImage>> {
    const perPage = params.perPage ?? 24;
    const { page, skip } = parseV1Cursor(params.cursor);
    const q: Record<string, string> = { s: 'id desc' };
    if (params.query) q.name_or_variants_including_master_sku_cont = params.query;
    const items: LibraryImage[] = [];
    let n = page;
    let from = skip;
    for (let scanned = 0; scanned < V1_MAX_SCAN_PAGES; scanned++) {
      const { data } = await transport.request<V1ProductList>({
        path: '/api/v1/products',
        query: { q, page: n, per_page: 25, ...SHOW_ARCHIVED },
        headers: V1_NO_CACHE,
      });
      const images = data.products.flatMap((p) =>
        v1Gallery(p).map(({ viewableId: _, ...image }) =>
          LibraryImage.parse({ ...image, productId: String(p.id), productName: p.name }),
        ),
      );
      for (let i = from; i < images.length; i++) {
        const image = images[i] as LibraryImage;
        if (!params.missingAlt || image.alt === null) items.push(image);
        if (items.length === perPage) {
          const nextCursor = i + 1 < images.length ? `${n}:${i + 1}` : n < data.pages ? String(n + 1) : null;
          return { items, nextCursor };
        }
      }
      if (n >= data.pages) return { items, nextCursor: null };
      n += 1;
      from = 0;
    }
    return { items, nextCursor: String(n) };
  }

  async function gemPage(params: ListLibraryParams): Promise<Page<LibraryImage>> {
    const page = Number(params.cursor) || 1;
    const { data } = await transport.request<{
      data: GemImage[];
      meta: { page: number; per_page: number; total_count: number };
    }>({
      path: GEM,
      query: {
        q: params.query || undefined,
        missing_alt: params.missingAlt ? 1 : undefined,
        page,
        per_page: params.perPage ?? 24,
      },
    });
    const { meta } = data;
    return {
      items: data.data.flatMap((g) => {
        const url = g.large_url ?? g.product_url ?? g.mini_url;
        if (!url) return [];
        return [
          LibraryImage.parse({
            id: g.id,
            url,
            thumbUrl: g.product_url ?? g.mini_url,
            alt: cleanAlt(g.alt),
            position: g.position,
            variantIds: g.variant_id ? [g.variant_id] : [],
            productId: g.product_id,
            productName: g.product_name,
          }),
        ];
      }),
      nextCursor: meta.page * meta.per_page < meta.total_count ? String(meta.page + 1) : null,
      totalCount: meta.total_count,
    };
  }

  const port: MediaPort = {
    async list(product) {
      return strip((await gallery(product.id)).images);
    },

    async upload(product, input: MediaUploadInput) {
      const { raw } = await gallery(product.id);
      const viewable = viewableFor(raw, input.variantIds);
      const form = new FormData();
      appendFile(form, 'image[attachment]', input.file);
      const alt = cleanAlt(input.alt);
      if (alt) form.append('image[alt]', alt);
      await transport.request({
        method: 'POST',
        path:
          viewable === raw.master.id
            ? `/api/v1/products/${raw.id}/images`
            : `/api/v1/variants/${viewable}/images`,
        body: form,
        // Large photos on a phone connection take longer than a JSON call.
        timeoutMs: 120_000,
      });
      return port.list({ id: String(raw.id) });
    },

    async update(product, imageId, patch: MediaUpdate) {
      const { raw, images } = await gallery(product.id);
      const image = images.find((i) => i.id === imageId);
      if (!image) throw notFound(imageId);
      const attrs: Record<string, unknown> = {};
      if (patch.alt !== undefined) attrs.alt = cleanAlt(patch.alt);
      if (patch.variantIds !== undefined) {
        const viewable = viewableFor(raw, patch.variantIds);
        if (viewable !== image.viewableId) attrs.viewable_id = viewable;
      }
      if (Object.keys(attrs).length > 0)
        await transport.request({ method: 'PUT', path: imagePath(raw, image), body: { image: attrs } });
      return port.list({ id: String(raw.id) });
    },

    async move(product, imageId, toIndex) {
      const { raw, images } = await gallery(product.id);
      const move = moveTarget(images, imageId, toIndex);
      if (move) {
        const image = move.image as Placed;
        const target = move.target as Placed;
        if (image.viewableId !== target.viewableId)
          throw new SpreeError({
            kind: 'invalid',
            status: 422,
            message:
              "On this store, images for one variant are ordered among that variant's images. Change which variant it shows for first.",
          });
        // acts_as_list shifts the images in between, so taking the target's position is the move.
        await transport.request({
          method: 'PUT',
          path: imagePath(raw, image),
          body: { image: { position: target.position } },
        });
      }
      return port.list({ id: String(raw.id) });
    },

    async remove(product, imageId) {
      const { raw, images } = await gallery(product.id);
      const image = images.find((i) => i.id === imageId);
      if (!image) throw notFound(imageId);
      await transport.request({ method: 'DELETE', path: imagePath(raw, image) });
      return port.list({ id: String(raw.id) });
    },

    async library(params) {
      if (gemLibrary !== false) {
        try {
          const page = await gemPage(params);
          gemLibrary = true;
          return page;
        } catch (e) {
          // A gem older than 0.3 has no media endpoint; 4.x answers its path with a 404.
          if (gemLibrary === true || !isSpreeError(e) || e.kind !== 'notFound') throw e;
          gemLibrary = false;
        }
      }
      return scanLibrary(params);
    },
  };
  return port;
}
