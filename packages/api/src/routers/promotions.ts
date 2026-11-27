import { PromotionListFilter } from '@instincts/spree-domain';
import type { PromotionDiscountInput } from '@instincts/spree-sdk';
import { z } from 'zod';
import { requireCapability, router } from '../trpc';

const read = requireCapability('promotions.read');
const write = requireCapability('promotions.write');

const Decimal = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Enter a number like 10 or 12.50.')
  .refine((v) => Number(v) > 0, 'Enter a number more than 0.');

const Discount = z
  .object({ type: z.enum(['percent', 'fixed']), amount: Decimal })
  .refine((d) => d.type !== 'percent' || Number(d.amount) <= 100, {
    message: 'A percentage can be at most 100.',
    path: ['amount'],
  });

const IsoDate = z.iso.datetime({ offset: true });
/** Letters, digits, dashes and underscores; empty means automatic (no code). */
const Code = z
  .string()
  .trim()
  .max(64)
  .regex(/^[A-Za-z0-9_-]*$/, 'Use letters, numbers, dashes or underscores.');

const Fields = z.object({
  name: z.string().trim().min(1, 'Give it a name.').max(255),
  description: z.string().trim().max(255).nullish(),
  code: Code.nullish(),
  startsAt: IsoDate.nullish(),
  expiresAt: IsoDate.nullish(),
  usageLimit: z.number().int().positive().nullish(),
});

/** Fixed discounts are in the store's currency. */
const withCurrency = (
  d: { type: 'percent' | 'fixed'; amount: string },
  currency: string | null,
): PromotionDiscountInput => (d.type === 'fixed' ? { ...d, currency } : d);

/** zod's optional/nullish become undefined/null; the port distinguishes "unchanged" from "cleared". */
function defined<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

export const promotionsRouter = router({
  list: read
    .input(
      z.object({
        query: z.string().trim().max(120).optional(),
        filter: PromotionListFilter.default('all'),
        cursor: z.string().nullish(),
        perPage: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.session.adapter.promotions.list(
        defined({
          query: input.query || undefined,
          filter: input.filter,
          cursor: input.cursor ?? null,
          perPage: input.perPage,
        }),
      ),
    ),
  get: read
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.session.adapter.promotions.get(input.id)),
  create: write.input(Fields.extend({ discount: Discount })).mutation(({ ctx, input }) => {
    const { discount, ...fields } = input;
    return ctx.session.adapter.promotions.create({
      ...defined(fields),
      discount: withCurrency(discount, ctx.session.probe.currency),
    });
  }),
  update: write
    .input(Fields.partial().extend({ id: z.string().min(1), discount: Discount.optional() }))
    .mutation(({ ctx, input }) => {
      const { id, discount, ...fields } = input;
      return ctx.session.adapter.promotions.update(
        { id },
        {
          ...defined(fields),
          ...(discount ? { discount: withCurrency(discount, ctx.session.probe.currency) } : {}),
        },
      );
    }),
});
