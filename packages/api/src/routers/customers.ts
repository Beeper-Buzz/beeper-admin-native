import { z } from 'zod';
import { requireCapability, router } from '../trpc';

const readCustomers = requireCapability('customers.read');

export const customersRouter = router({
  list: readCustomers
    .input(
      z.object({
        /** Email or name. */
        query: z.string().trim().max(120).optional(),
        cursor: z.string().nullish(),
        perPage: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(({ ctx, input }) => {
      const params: Parameters<typeof ctx.session.adapter.customers.list>[0] = {
        perPage: input.perPage,
        cursor: input.cursor ?? null,
      };
      if (input.query) params.query = input.query;
      return ctx.session.adapter.customers.list(params);
    }),
  get: readCustomers
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.session.adapter.customers.get(input.id)),
});
