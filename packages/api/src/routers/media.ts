import { z } from 'zod';
import { requireCapability, router } from '../trpc';

const productMedia = requireCapability('products.media');

const ProductRef = z.object({ id: z.string().min(1) });
const Alt = z.string().trim().max(255, 'Keep alt text under 255 characters.').nullish();
const VariantIds = z.array(z.string().min(1)).max(100);
/**
 * A photo on the device, as the image picker returns it. The router runs in the app (localLink),
 * so the SDK uploads straight from this file URI.
 */
const PickedFile = z.object({
  uri: z.string().min(1),
  name: z.string().trim().min(1).max(255),
  type: z.string().regex(/^image\/[\w.+-]+$/, 'Pick a photo.'),
});

export const mediaRouter = router({
  /** One product's gallery, in display order. */
  list: productMedia
    .input(z.object({ product: ProductRef }))
    .query(({ ctx, input }) => ctx.session.adapter.media.list(input.product)),

  upload: productMedia
    .input(z.object({ product: ProductRef, file: PickedFile, alt: Alt, variantIds: VariantIds.optional() }))
    .mutation(({ ctx, input }) => {
      const upload: Parameters<typeof ctx.session.adapter.media.upload>[1] = { file: input.file };
      if (input.alt) upload.alt = input.alt;
      if (input.variantIds?.length) upload.variantIds = input.variantIds;
      return ctx.session.adapter.media.upload(input.product, upload);
    }),

  update: productMedia
    .input(
      z.object({
        product: ProductRef,
        imageId: z.string().min(1),
        /** Empty or null clears it. */
        alt: Alt,
        /** Empty shows it for every variant. */
        variantIds: VariantIds.optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const patch: Parameters<typeof ctx.session.adapter.media.update>[2] = {};
      if (input.alt !== undefined) patch.alt = input.alt || null;
      if (input.variantIds !== undefined) patch.variantIds = input.variantIds;
      return ctx.session.adapter.media.update(input.product, input.imageId, patch);
    }),

  /** `toIndex` 0 makes it the main photo. */
  move: productMedia
    .input(z.object({ product: ProductRef, imageId: z.string().min(1), toIndex: z.number().int().min(0) }))
    .mutation(({ ctx, input }) =>
      ctx.session.adapter.media.move(input.product, input.imageId, input.toIndex),
    ),

  remove: productMedia
    .input(z.object({ product: ProductRef, imageId: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.session.adapter.media.remove(input.product, input.imageId)),

  /** Every product photo in the store. */
  library: requireCapability('media.library')
    .input(
      z.object({
        /** Product name (or SKU where the store can search it). */
        query: z.string().trim().max(120).optional(),
        missingAlt: z.boolean().default(false),
        cursor: z.string().nullish(),
        perPage: z.number().int().min(1).max(100).default(24),
      }),
    )
    .query(({ ctx, input }) => {
      const params: Parameters<typeof ctx.session.adapter.media.library>[0] = {
        missingAlt: input.missingAlt,
        perPage: input.perPage,
        cursor: input.cursor ?? null,
      };
      if (input.query) params.query = input.query;
      return ctx.session.adapter.media.library(params);
    }),
});
