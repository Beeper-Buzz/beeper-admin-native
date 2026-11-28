import { z } from 'zod';
import { requireCapability, router } from '../trpc';

/**
 * The customer inbox (companion gem 0.7, `inbox`; docs/superpowers/specs/2026-11-28-menus-inbox-
 * visitors.md §2). Ids are checked for shape; the host's adapter decides the rest.
 */
const can = requireCapability('inbox');

const Id = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Not a valid id.');
const Iso = z.iso.datetime({ offset: true });
const One = z.object({ id: Id });
/** A photo or file on the device, uploaded through the gem's `resources/uploads`. */
const PickedFile = z.object({
  uri: z.string().min(1),
  name: z.string().trim().min(1).max(255),
  type: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/, 'Not a file type.'),
});

export const inboxRouter = router({
  list: can
    .input(
      z.object({
        status: z.enum(['open', 'snoozed', 'closed', 'all']).default('open'),
        assignee: z.enum(['me', 'unassigned', 'any']).default('any'),
        query: z.string().trim().max(120).optional(),
        updatedSince: Iso.nullish(),
        cursor: z.string().nullish(),
        perPage: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(({ ctx, input }) => {
      const params: Parameters<typeof ctx.session.adapter.inbox.list>[0] = {
        status: input.status,
        assignee: input.assignee,
        perPage: input.perPage,
        cursor: input.cursor ?? null,
      };
      if (input.query) params.query = input.query;
      if (input.updatedSince) params.updatedSince = input.updatedSince;
      return ctx.session.adapter.inbox.list(params);
    }),

  /** One conversation with the customer context. */
  get: can.input(One).query(({ ctx, input }) => ctx.session.adapter.inbox.get(input.id)),

  /** Oldest first: `after` for polling, `before` for scrolling back, else the latest. */
  messages: can
    .input(
      One.extend({
        before: Id.nullish(),
        after: Id.nullish(),
        limit: z.number().int().min(1).max(200).optional(),
      }).refine((v) => !(v.before && v.after), 'Ask for messages before or after one, not both.'),
    )
    .query(({ ctx, input }) => {
      const params: Parameters<typeof ctx.session.adapter.inbox.messages>[1] = {};
      if (input.before) params.before = input.before;
      if (input.after) params.after = input.after;
      if (input.limit !== undefined) params.limit = input.limit;
      return ctx.session.adapter.inbox.messages(input.id, params);
    }),

  /** A reply on the conversation's channel, or an internal note; attachments are upload signed ids. */
  reply: can
    .input(
      One.extend({
        body: z.string().trim().max(4000, 'Keep a message under 4000 characters.').default(''),
        note: z.boolean().default(false),
        attachments: z.array(z.string().min(1).max(1000)).max(10).default([]),
      }).refine((v) => v.body.length > 0 || v.attachments.length > 0, {
        message: 'Write a message or attach a photo.',
        path: ['body'],
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.session.adapter.inbox.reply(input.id, {
        body: input.body,
        ...(input.note ? { note: true } : {}),
        ...(input.attachments.length ? { attachments: input.attachments } : {}),
      }),
    ),

  /**
   * Status, assignee (`'me'` or null to unassign) and snooze. Snoozing needs a time in the future;
   * opening or closing clears the snooze.
   */
  update: can
    .input(
      One.extend({
        status: z.enum(['open', 'snoozed', 'closed']).optional(),
        assignee: z.union([z.literal('me'), z.null()]).optional(),
        snoozedUntil: Iso.nullish(),
      }).refine((v) => v.status !== 'snoozed' || !!v.snoozedUntil, 'Choose when to bring it back.'),
    )
    .mutation(({ ctx, input }) => {
      const patch: Parameters<typeof ctx.session.adapter.inbox.update>[1] = {};
      if (input.status) patch.status = input.status;
      if (input.assignee !== undefined) patch.assigneeId = input.assignee;
      if (input.snoozedUntil !== undefined) patch.snoozedUntil = input.snoozedUntil;
      else if (input.status === 'open' || input.status === 'closed') patch.snoozedUntil = null;
      return ctx.session.adapter.inbox.update(input.id, patch);
    }),

  read: can.input(One).mutation(async ({ ctx, input }) => {
    await ctx.session.adapter.inbox.markRead(input.id);
    return { ok: true };
  }),

  /** `{ open, unassigned, unread }` for the tab badge. */
  summary: can.query(({ ctx }) => ctx.session.adapter.inbox.summary()),

  /** A photo for a reply; send its `signedId` in `attachments`. */
  upload: can
    .input(z.object({ file: PickedFile }))
    .mutation(({ ctx, input }) => ctx.session.adapter.resources.upload(input.file)),
});
