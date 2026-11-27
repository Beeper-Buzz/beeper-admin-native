import { z } from 'zod';
import { Id } from './common';

/**
 * One image in a product's gallery, in display order (the first is the product's main image).
 * `variantIds` lists the variants it is shown for; empty means every variant. Spree 4.x keeps
 * an image on one variant (or the master), Spree 6 links product images to any number of them.
 */
export const ProductImage = z.object({
  id: Id,
  /** Large rendition for viewing. */
  url: z.string(),
  /** Small rendition for grids and lists. */
  thumbUrl: z.string().nullable(),
  alt: z.string().nullable(),
  position: z.number().int(),
  variantIds: z.array(Id).default([]),
});
export type ProductImage = z.infer<typeof ProductImage>;

/** A product image in the store-wide media list, with the product it belongs to. */
export const LibraryImage = ProductImage.extend({
  productId: Id,
  /** null when the product couldn't be read (deleted since). */
  productName: z.string().nullable(),
});
export type LibraryImage = z.infer<typeof LibraryImage>;

/** Alt text that is missing or only whitespace. */
export function missingAlt(image: Pick<ProductImage, 'alt'>): boolean {
  return !image.alt?.trim();
}
