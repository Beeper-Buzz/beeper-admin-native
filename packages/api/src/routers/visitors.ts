import { z } from 'zod';
import { requireCapability, router } from '../trpc';

/**
 * Carts (companion gem 0.7, `carts`) and storefront visitors (`visitors`);
 * docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md §3.
 */
const Id = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Not a valid id.');

export const cartsRouter = router({
  list: requireCapability('carts')
    .input(
      z.object({
        /** Only carts changed within this many minutes. */
        activeWithin: z
          .number()
          .int()
          .min(1)
          .max(60 * 24 * 90)
          .nullish(),
        withEmail: z.boolean().nullish(),
        abandoned: z.boolean().nullish(),
        cursor: z.string().nullish(),
        perPage: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(({ ctx, input }) => {
      const params: Parameters<typeof ctx.session.adapter.carts.list>[0] = {
        perPage: input.perPage,
        cursor: input.cursor ?? null,
      };
      if (input.activeWithin) params.activeWithin = input.activeWithin;
      if (input.withEmail !== undefined && input.withEmail !== null) params.withEmail = input.withEmail;
      if (input.abandoned !== undefined && input.abandoned !== null) params.abandoned = input.abandoned;
      return ctx.session.adapter.carts.list(params);
    }),

  get: requireCapability('carts')
    .input(z.object({ number: Id }))
    .query(({ ctx, input }) => ctx.session.adapter.carts.get(input.number)),
});

export const visitorsRouter = router({
  list: requireCapability('visitors')
    .input(
      z.object({
        online: z.boolean().optional(),
        cursor: z.string().nullish(),
        perPage: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(({ ctx, input }) => {
      const params: Parameters<typeof ctx.session.adapter.visitors.list>[0] = {
        perPage: input.perPage,
        cursor: input.cursor ?? null,
      };
      if (input.online !== undefined) params.online = input.online;
      return ctx.session.adapter.visitors.list(params);
    }),

  /** A session with its last 50 page views. */
  get: requireCapability('visitors')
    .input(z.object({ id: Id }))
    .query(({ ctx, input }) => ctx.session.adapter.visitors.get(input.id)),

  /** Starts (or returns) the conversation with a visitor; staff then write in the inbox. */
  startConversation: requireCapability('visitors')
    .input(z.object({ id: Id }))
    .mutation(({ ctx, input }) => ctx.session.adapter.visitors.startConversation(input.id)),
});
