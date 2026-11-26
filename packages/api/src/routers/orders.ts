import { OrderListFilter } from '@instincts/spree-domain';
import { z } from 'zod';
import { requireCapability, router } from '../trpc';

const readOrders = requireCapability('orders.read');

export const ordersRouter = router({
  list: readOrders
    .input(
      z.object({
        filter: OrderListFilter.default('all'),
        query: z.string().trim().max(120).optional(),
        cursor: z.string().nullish(),
        perPage: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(({ ctx, input }) => {
      const params: Parameters<typeof ctx.session.adapter.orders.list>[0] = {
        filter: input.filter,
        perPage: input.perPage,
        cursor: input.cursor ?? null,
      };
      if (input.query) params.query = input.query;
      return ctx.session.adapter.orders.list(params);
    }),
  get: readOrders
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.session.adapter.orders.get(input.id)),
});
