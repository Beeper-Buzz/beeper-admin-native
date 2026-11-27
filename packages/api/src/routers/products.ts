import { z } from 'zod';
import { requireCapability, router } from '../trpc';

const readProducts = requireCapability('products.read');
const writeProducts = requireCapability('products.write');

const ProductRef = z.object({ id: z.string().min(1) });
/** Positive decimal string with at most two places, e.g. "19.99". */
const Price = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Enter a price like 19.99.')
  .refine((v) => Number(v) > 0, 'Enter a price more than 0.');

export const productsRouter = router({
  list: readProducts
    .input(
      z.object({
        /** Name or SKU. */
        query: z.string().trim().max(120).optional(),
        status: z.enum(['all', 'active', 'draft', 'archived']).default('all'),
        cursor: z.string().nullish(),
        perPage: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(({ ctx, input }) => {
      const params: Parameters<typeof ctx.session.adapter.products.list>[0] = {
        status: input.status,
        perPage: input.perPage,
        cursor: input.cursor ?? null,
      };
      if (input.query) params.query = input.query;
      return ctx.session.adapter.products.list(params);
    }),
  get: readProducts
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.session.adapter.products.get(input.id)),

  update: writeProducts
    .input(
      z.object({
        product: ProductRef,
        name: z.string().trim().min(1).max(255).optional(),
        description: z.string().max(65_535).nullish(),
        status: z.enum(['active', 'draft', 'archived']).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const patch: Parameters<typeof ctx.session.adapter.products.update>[1] = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = input.description;
      if (input.status !== undefined) patch.status = input.status;
      return ctx.session.adapter.products.update(input.product, patch);
    }),
  updateVariant: writeProducts
    .input(
      z.object({
        product: ProductRef,
        variantId: z.string().min(1),
        price: Price.optional(),
        /** null clears it. */
        compareAtPrice: Price.nullish(),
        /** Empty or null clears it. */
        sku: z.string().trim().max(255).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const patch: Parameters<typeof ctx.session.adapter.products.updateVariant>[2] = {};
      if (input.price !== undefined) patch.price = input.price;
      if (input.compareAtPrice !== undefined) patch.compareAtPrice = input.compareAtPrice;
      if (input.sku !== undefined) patch.sku = input.sku || null;
      return ctx.session.adapter.products.updateVariant(input.product, input.variantId, patch);
    }),
  setStock: requireCapability('inventory.adjust')
    .input(
      z.object({
        product: ProductRef,
        variantId: z.string().min(1),
        /** The absolute on-hand count at the store's default stock location. */
        countOnHand: z
          .number()
          .int('Enter a whole number.')
          .min(0, 'Stock cannot be negative.')
          .max(1_000_000_000),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.session.adapter.products.setStock(input.product, input.variantId, input.countOnHand),
    ),
});
