import { z } from 'zod';
import { Image, OptionType, OptionValue } from './catalog';
import { Id, IsoDateTime, tolerantEnum } from './common';
import { Money } from './money';

export const ProductStatus = tolerantEnum(['active', 'draft', 'archived'] as const);

export const Variant = z.object({
  id: Id,
  sku: z.string().nullable(),
  optionsText: z.string().nullable(),
  isMaster: z.boolean(),
  price: Money.nullable(),
  compareAtPrice: Money.nullable(),
  /** null when inventory isn't tracked for this variant. */
  totalOnHand: z.number().int().nullable(),
  imageUrl: z.string().nullable(),
  /** Storefront fields; admin lists may leave them empty. */
  optionValues: z.array(OptionValue).default([]),
  images: z.array(Image).default([]),
  /** Can be bought now (in stock, or backorderable). null when the API doesn't say. */
  purchasable: z.boolean().nullable().default(null),
});
export type Variant = z.infer<typeof Variant>;

export const Product = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  status: ProductStatus,
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  variants: z.array(Variant),
  optionTypes: z.array(OptionType).default([]),
  images: z.array(Image).default([]),
  /** null where the API doesn't send it (Store API v3). */
  updatedAt: IsoDateTime.nullable(),
});
export type Product = z.infer<typeof Product>;

/** Sellable variants: non-master when a product has options, otherwise the master. */
export function sellableVariants<V extends Pick<Variant, 'isMaster'>>(product: { variants: V[] }): V[] {
  const options = product.variants.filter((v) => !v.isMaster);
  return options.length > 0 ? options : product.variants;
}

export function isLowStock(variant: Pick<Variant, 'totalOnHand'>, threshold = 2): boolean {
  return variant.totalOnHand !== null && variant.totalOnHand <= threshold;
}
