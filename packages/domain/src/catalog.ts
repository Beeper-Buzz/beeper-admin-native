import { z } from 'zod';
import { Id } from './common';

export const Image = z.object({
  url: z.string(),
  alt: z.string().nullable(),
});
export type Image = z.infer<typeof Image>;

/** "Color", "Size". */
export const OptionType = z.object({
  id: Id,
  name: z.string(),
  presentation: z.string(),
  position: z.number().int(),
});
export type OptionType = z.infer<typeof OptionType>;

/** "Red" of "Color". `color` is a hex swatch when the store sets one. */
export const OptionValue = z.object({
  id: Id,
  optionTypeId: Id,
  name: z.string(),
  presentation: z.string(),
  position: z.number().int(),
  color: z.string().nullable(),
});
export type OptionValue = z.infer<typeof OptionValue>;

/** A category or collection (Spree 4/5 taxon, Spree 6 category/collection). */
export const Taxon = z.object({
  id: Id,
  name: z.string(),
  permalink: z.string(),
  parentId: Id.nullable(),
  description: z.string().nullable(),
  image: Image.nullable(),
});
export type Taxon = z.infer<typeof Taxon>;
