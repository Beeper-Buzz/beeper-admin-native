import { z } from 'zod';
import { requireCapability, router } from '../trpc';

/**
 * Host-described admin types (companion gem 0.4+). The router checks the shape of keys, ids and
 * names; values go through as they are, since the store knows the fields and validates them.
 * Gem 0.5 inputs (a version, action input, date ranges, uploads) are optional, so a 0.4 store gets
 * the same calls as before.
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
/** An ISO day; empty or null leaves that end of a range open. */
const Day = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use YYYY-MM-DD.')
  .nullish();
const DateRange = z.object({ from: Day, to: Day });
const FilterValue = z.union([z.string().max(255), z.number(), z.boolean(), z.null(), DateRange]);
/** `lock_version` or `updated_at`, sent back as the store gave it. */
const Version = z.union([z.string().max(64), z.number().int()]).nullish();
/**
 * A file on the device, as the image or document picker returns it. The router runs in the app
 * (localLink), so the SDK uploads straight from this file URI.
 */
const PickedFile = z.object({
  uri: z.string().min(1),
  name: z.string().trim().min(1).max(255),
  type: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/, 'Not a file type.'),
});

const Type = z.object({ key: Name });
const One = Type.extend({ id: RecordId });

type Filter = z.infer<typeof FilterValue>;
const isSet = (v: Filter) => v !== null && v !== '' && (typeof v !== 'object' || !!v.from || !!v.to);
/** A date range with only the ends that are set. */
const clean = (v: Filter) => {
  if (typeof v !== 'object' || v === null) return v;
  const range: { from?: string; to?: string } = {};
  if (v.from) range.from = v.from;
  if (v.to) range.to = v.to;
  return range;
};

export const resourcesRouter = router({
  /** The store's admin types, in its order, hidden ones included, and the gem's version. */
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
      const filters = Object.entries(input.filters ?? {})
        .filter(([, v]) => isSet(v))
        .map(([k, v]) => [k, clean(v)] as const);
      if (filters.length) params.filters = Object.fromEntries(filters);
      return ctx.session.adapter.resources.list(input.key, params);
    }),

  get: can.input(One).query(({ ctx, input }) => ctx.session.adapter.resources.get(input.key, input.id)),

  create: can
    .input(Type.extend({ values: Values }))
    .mutation(({ ctx, input }) => ctx.session.adapter.resources.create(input.key, input.values)),

  /**
   * Send only the fields that changed, with the record's `version` when it has one: the store
   * then refuses a stale save as CONFLICT (`spreeKind: 'conflict'`).
   */
  update: can
    .input(One.extend({ values: Values, version: Version }))
    .mutation(({ ctx, input }) =>
      input.version === null || input.version === undefined
        ? ctx.session.adapter.resources.update(input.key, input.id, input.values)
        : ctx.session.adapter.resources.update(input.key, input.id, input.values, input.version),
    ),

  remove: can
    .input(One)
    .mutation(({ ctx, input }) => ctx.session.adapter.resources.remove(input.key, input.id)),

  /** Runs a member action the record lists in its `actions`, with its inputs' values. */
  perform: can
    .input(One.extend({ action: Name, input: Values.optional() }))
    .mutation(({ ctx, input }) =>
      input.input && Object.keys(input.input).length
        ? ctx.session.adapter.resources.perform(input.key, input.id, input.action, input.input)
        : ctx.session.adapter.resources.perform(input.key, input.id, input.action),
    ),

  /** Uploads a file for an image or file field; the field then takes the blob's `signedId`. */
  upload: can
    .input(z.object({ file: PickedFile }))
    .mutation(({ ctx, input }) => ctx.session.adapter.resources.upload(input.file)),

  /** Gem 0.7: the whole tree of one group of a tree-view type (null for the whole table). */
  tree: can
    .input(Type.extend({ group: RecordId.nullable().default(null) }))
    .query(({ ctx, input }) => ctx.session.adapter.resources.tree(input.key, input.group)),

  /**
   * Gem 0.7: every node's new parent and position, applied in one transaction; returns the new
   * tree. A cycle or a node outside the group is refused by the store, and nothing moves.
   */
  moveTree: can
    .input(
      Type.extend({
        group: RecordId.nullable().default(null),
        nodes: z
          .array(
            z.object({
              id: RecordId,
              parentId: RecordId.nullable(),
              position: z.number().int().min(0).max(100_000),
            }),
          )
          .min(1)
          .max(2000)
          .refine((nodes) => new Set(nodes.map((n) => n.id)).size === nodes.length, 'A node moves once.')
          .refine((nodes) => nodes.every((n) => n.id !== n.parentId), 'A node can’t be its own parent.'),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.session.adapter.resources.moveTree(input.key, input.group, input.nodes),
    ),
});
