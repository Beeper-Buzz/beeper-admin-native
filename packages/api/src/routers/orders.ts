import { OrderListFilter } from '@instincts/spree-domain';
import { z } from 'zod';
import { requireCapability, router } from '../trpc';

const readOrders = requireCapability('orders.read');

const OrderRef = z.object({ id: z.string().min(1), number: z.string().min(1) });
const Ref = z.object({ id: z.string().min(1), number: z.string().min(1) });
/** Positive decimal string with at most two places, e.g. "12.50". */
const Amount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount like 12.50.')
  .refine((v) => Number(v) > 0, 'Enter an amount more than 0.');

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

  ship: requireCapability('shipments.ship')
    .input(z.object({ order: OrderRef, fulfillment: Ref, tracking: z.string().trim().max(500).nullish() }))
    .mutation(({ ctx, input }) =>
      ctx.session.adapter.orders.ship(input.order, input.fulfillment, { tracking: input.tracking || null }),
    ),
  capture: requireCapability('orders.capture')
    .input(z.object({ order: OrderRef, payment: Ref }))
    .mutation(({ ctx, input }) => ctx.session.adapter.orders.capture(input.order, input.payment)),
  cancel: requireCapability('orders.cancel')
    .input(z.object({ order: OrderRef }))
    .mutation(({ ctx, input }) => ctx.session.adapter.orders.cancel(input.order)),
  refund: requireCapability('orders.refund')
    .input(z.object({ order: OrderRef, payment: Ref, amount: Amount, reasonId: z.string().nullish() }))
    .mutation(({ ctx, input }) =>
      ctx.session.adapter.orders.refund(input.order, {
        payment: input.payment,
        amount: input.amount,
        reasonId: input.reasonId ?? null,
      }),
    ),
  refundReasons: requireCapability('orders.refund').query(({ ctx }) =>
    ctx.session.adapter.orders.refundReasons(),
  ),
});
