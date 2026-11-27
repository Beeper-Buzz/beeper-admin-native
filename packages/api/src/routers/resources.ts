import { z } from 'zod';
import { requireCapability, router } from '../trpc';

/**
 * Host-described admin types (companion gem 0.4+). The router checks the shape of keys, ids and
 * names; values go through as they are, since the store knows the fields and validates them.
 */
const can = requireCapability('admin.resources');

/** A registered type key, field, filter or action name (`menu_items`, `retire`). */
const Name = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/, 'Not a valid name.');
/** A record id: numeric on Spree 4, prefixed elsewhere; never a path. */
const RecordId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Not a valid id.');
const Values = z.record(Name, z.unknown()).refine((v) => Object.keys(v).length <= 200, 'Too many fields.');
const FilterValue = z.union([z.string().max(255), z.number(), z.boolean(), z.null()]);

const Type = z.object({ key: Name });
const One = Type.extend({ id: RecordId });

export const resourcesRouter = router({
  /** The store's admin types, in its order. */
  manifest: can.query(({ ctx }) => ctx.session.adapter.resources.manifest()),

  list: can
    .input(
      Type.extend({
        query: z.string().trim().max(120).optional(),
        filters: z.record(Name, FilterValue).optional(),
        cursor: z.string().nullish(),
        perPage: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(({ ctx, input }) => {
      const params: Parameters<typeof ctx.session.adapter.resources.list>[1] = {
        perPage: input.perPage,
        cursor: input.cursor ?? null,
      };
      if (input.query) params.query = input.query;
      const filters = Object.entries(input.filters ?? {}).filter(([, v]) => v !== null && v !== '');
      if (filters.length) params.filters = Object.fromEntries(filters);
      return ctx.session.adapter.resources.list(input.key, params);
    }),

  get: can.input(One).query(({ ctx, input }) => ctx.session.adapter.resources.get(input.key, input.id)),

  create: can
    .input(Type.extend({ values: Values }))
    .mutation(({ ctx, input }) => ctx.session.adapter.resources.create(input.key, input.values)),

  /** Send only the fields that changed. */
  update: can
    .input(One.extend({ values: Values }))
    .mutation(({ ctx, input }) => ctx.session.adapter.resources.update(input.key, input.id, input.values)),

  remove: can
    .input(One)
    .mutation(({ ctx, input }) => ctx.session.adapter.resources.remove(input.key, input.id)),

  /** Runs a member action the record lists in its `actions`. */
  perform: can
    .input(One.extend({ action: Name }))
    .mutation(({ ctx, input }) => ctx.session.adapter.resources.perform(input.key, input.id, input.action)),
});
