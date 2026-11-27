import { OrderListFilter } from '@instincts/spree-domain';
import { z } from 'zod';
import { requireCapability, router } from '../trpc';

const readOrders = requireCapability('orders.read');
const createOrders = requireCapability('orders.create');

const OrderRef = z.object({ id: z.string().min(1), number: z.string().min(1) });
const Ref = z.object({ id: z.string().min(1), number: z.string().min(1) });
/** Positive decimal string with at most two places, e.g. "12.50". */
const Amount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount like 12.50.')
  .refine((v) => Number(v) > 0, 'Enter an amount more than 0.');

/** Trimmed text; empty becomes null. */
const Optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const Required = (max: number, message: string) => z.string().trim().min(1, message).max(max);

/** The domain Address, as the merchant types it. Spree needs a name, street, city and country. */
export const AddressInput = z.object({
  firstName: Required(255, 'Enter a first name.'),
  lastName: Required(255, 'Enter a last name.'),
  company: Optional(255),
  address1: Required(255, 'Enter a street address.'),
  address2: Optional(255),
  city: Required(255, 'Enter a city.'),
  zipcode: Optional(20),
  phone: Optional(40),
  /** The state's abbreviation (`OR`). */
  stateCode: Optional(10).transform((v) => v?.toUpperCase() ?? null),
  stateName: Optional(255),
  countryIso: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Use a two-letter country code like US.')
    .transform((v) => v.toUpperCase()),
});

export const DraftInput = z.object({
  customerId: z.string().min(1).nullable(),
  email: z.string().trim().pipe(z.email('Enter an email address like name@example.com.')),
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int('Enter a whole number.').min(1, 'At least 1.').max(10_000),
      }),
    )
    .min(1, 'Add at least one item.')
    .max(100)
    .refine(
      (items) => new Set(items.map((i) => i.variantId)).size === items.length,
      'Each item appears once.',
    ),
  shipAddress: AddressInput,
  /** null bills the shipping address. */
  billAddress: AddressInput.nullable(),
});

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

  // --- Creating an order: a server-side draft, then placed. ---------------------------------
  createDraft: createOrders
    .input(DraftInput)
    .mutation(({ ctx, input }) => ctx.session.adapter.orders.createDraft(input)),
  updateDraft: createOrders
    .input(DraftInput.extend({ order: OrderRef }))
    .mutation(({ ctx, input: { order, ...draft } }) => ctx.session.adapter.orders.updateDraft(order, draft)),
  selectShippingRate: createOrders
    .input(z.object({ order: OrderRef, fulfillment: Ref, rateId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.session.adapter.orders.selectShippingRate(input.order, input.fulfillment, input.rateId),
    ),
  paymentMethods: createOrders
    .input(z.object({ order: OrderRef }))
    .query(({ ctx, input }) => ctx.session.adapter.orders.paymentMethods(input.order)),
  place: createOrders
    .input(
      z.object({
        order: OrderRef,
        payment: z.object({ methodId: z.string().min(1), markPaid: z.boolean() }).nullable(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.session.adapter.orders.place(input.order, { payment: input.payment })),
  discardDraft: createOrders.input(z.object({ order: OrderRef })).mutation(async ({ ctx, input }) => {
    await ctx.session.adapter.orders.discardDraft(input.order);
    return { discarded: input.order.number };
  }),
});
