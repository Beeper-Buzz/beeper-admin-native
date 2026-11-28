import {
  Conversation,
  type ConversationDetail,
  CustomerContext,
  InboxSummary,
  Message,
} from '@instincts/spree-domain';
import { isSpreeError, SpreeError } from '../errors';
import type { InboxPort } from '../ports';
import type { Transport } from '../transport';
import { absoluteUrl, idOf, list, obj, pageMeta, parsed, str, toMoney } from './shapes';

/**
 * The customer inbox through the companion gem 0.7 (capability `inbox`), in the shapes of
 * docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md §2. Every reader is tolerant: an entry
 * that can't be read is dropped from a list rather than failing it.
 */
const BASE = '/api/admin_native/v1/inbox';
const MESSAGE_LIMIT_MAX = 200;
export const MESSAGE_MAX_LENGTH = 4000;

const person = (v: unknown, base: string | null) => {
  const c = obj(v) ?? {};
  return {
    name: str(c.name),
    email: str(c.email),
    avatarUrl: absoluteUrl(c.avatar_url, base),
    contactId: idOf(c.contact_id),
    userId: idOf(c.user_id),
  };
};

/** The last part of a URL's path, for an attachment the store sent without a name. */
function fileName(url: string): string {
  const last = url.split('?')[0]?.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last) || 'Attachment';
  } catch {
    return last || 'Attachment';
  }
}

/**
 * A conversation as the gem sends it, or null when it has no id. `base` (the store's URL) makes
 * relative avatar and attachment URLs absolute.
 */
export function mapGemConversation(raw: unknown, base: string | null = null): Conversation | null {
  const c = obj(raw);
  if (!c) return null;
  const assignee = obj(c.assignee);
  const last = obj(c.last_message);
  const result = Conversation.safeParse({
    id: idOf(c.id),
    status: c.status,
    channel: str(c.channel) ?? undefined,
    subject: str(c.subject),
    customer: person(c.customer, base),
    assignee: assignee && idOf(assignee.id) ? { id: idOf(assignee.id), email: str(assignee.email) } : null,
    unread: c.unread,
    lastMessage: last
      ? { body: typeof last.body === 'string' ? last.body : '', direction: last.direction, at: str(last.at) }
      : null,
    updatedAt: str(c.updated_at),
    snoozedUntil: str(c.snoozed_until),
  });
  return result.success ? result.data : null;
}

export function mapGemMessage(raw: unknown, base: string | null = null): Message | null {
  const m = obj(raw);
  if (!m) return null;
  const author = obj(m.author) ?? {};
  const result = Message.safeParse({
    id: idOf(m.id),
    direction: m.direction,
    body: typeof m.body === 'string' ? m.body : '',
    channel: str(m.channel),
    author: { kind: author.kind, name: str(author.name) },
    attachments: parsed(list(m.attachments), (a) => {
      const o = obj(a);
      const url = o && absoluteUrl(o.url, base);
      return o && url
        ? { url, filename: str(o.filename) ?? fileName(url), contentType: str(o.content_type) }
        : null;
    }),
    createdAt: str(m.created_at),
    readAt: str(m.read_at),
    delivery: m.delivery ?? null,
  });
  return result.success ? result.data : null;
}

export function mapGemCustomerContext(raw: unknown, base: string | null = null): CustomerContext | null {
  const c = obj(raw);
  if (!c) return null;
  const contact = obj(c.contact);
  const user = obj(c.user);
  const session = obj(c.session);
  const cart = obj(c.cart);
  const result = CustomerContext.safeParse({
    contact: contact
      ? {
          id: idOf(contact.id),
          name: str(contact.name),
          email: str(contact.email),
          phone: str(contact.phone),
        }
      : null,
    user: user && idOf(user.id) ? { id: idOf(user.id), email: str(user.email) } : null,
    session:
      session && idOf(session.id)
        ? {
            id: idOf(session.id),
            currentUrl: str(session.current_url),
            lastSeenAt: str(session.last_seen_at),
            online: session.online === true,
          }
        : null,
    cart:
      cart && str(cart.order_number)
        ? {
            orderNumber: str(cart.order_number),
            itemCount: cart.item_count,
            total: toMoney(cart.total, cart.currency),
            items: parsed(list(cart.items), (i) => {
              const o = obj(i);
              return o
                ? {
                    name: str(o.name) ?? 'Item',
                    quantity: o.quantity,
                    imageUrl: absoluteUrl(o.image_url, base),
                  }
                : null;
            }),
          }
        : null,
    recentOrders: parsed(list(c.recent_orders), (o) => {
      const r = obj(o);
      const number = r && str(r.number);
      return r && number
        ? {
            number,
            state: str(r.state),
            // The gem sends no currency for recent orders; the cart's is the store's.
            total: toMoney(r.total, r.currency ?? cart?.currency),
            completedAt: str(r.completed_at),
          }
        : null;
    }),
  });
  return result.success ? result.data : null;
}

const errorCode = (body: unknown) => {
  const error = obj(obj(body)?.error);
  return error ? str(error.code) : null;
};

/**
 * The gem's errors in plain words: an unknown conversation (404 `not_found`) is gone; a store
 * whose inbox isn't set up (404 `unsupported`) lacks the capability.
 */
const gone = (e: unknown) => {
  if (!isSpreeError(e) || e.kind !== 'notFound') return e;
  const unsupported = errorCode(e.body) === 'unsupported';
  return new SpreeError({
    kind: unsupported ? 'capability' : 'notFound',
    status: 404,
    message: unsupported ? "This store's inbox isn't set up." : 'This conversation is gone.',
    body: e.body,
    cause: e,
  });
};

const one = <T>(value: T | null, what: string): T => {
  if (value === null)
    throw new SpreeError({
      kind: 'parse',
      status: 200,
      message: `The store sent ${what} the app could not read.`,
    });
  return value;
};

export function companionInbox(transport: Transport): InboxPort {
  const base = transport.baseUrl || null;
  const conversation = (r: unknown) => mapGemConversation(r, base);
  const message = (r: unknown) => mapGemMessage(r, base);
  const conv = (id: string, ...rest: string[]) =>
    [`${BASE}/conversations/${encodeURIComponent(id)}`, ...rest].join('/');
  const call = async <T>(req: Parameters<Transport['request']>[0]) => {
    try {
      return (await transport.request<T>(req)).data;
    } catch (e) {
      throw gone(e);
    }
  };

  return {
    async list(params) {
      const page = params.cursor ? Math.max(1, Number(params.cursor) || 1) : 1;
      const perPage = params.perPage ?? 25;
      const body = await call<{ data?: unknown; meta?: unknown }>({
        path: `${BASE}/conversations`,
        query: {
          status: params.status ?? 'open',
          assignee: params.assignee ?? 'any',
          q: params.query?.trim() || undefined,
          updated_since: params.updatedSince || undefined,
          page,
          per_page: perPage,
        },
      });
      const items = parsed(list(body.data), conversation);
      return { items, ...pageMeta(body.meta, page, perPage, list(body.data).length) };
    },
    async get(id): Promise<ConversationDetail> {
      const body = await call<{ data?: unknown }>({ path: conv(id) });
      const data = obj(body.data);
      return {
        ...one(conversation(data), 'a conversation'),
        customerContext: mapGemCustomerContext(data?.customer_context, base),
      };
    },
    async messages(id, params = {}) {
      const limit = Math.min(MESSAGE_LIMIT_MAX, Math.max(1, params.limit ?? 50));
      const body = await call<{ data?: unknown }>({
        path: conv(id, 'messages'),
        query: {
          before: params.before || undefined,
          after: params.after || undefined,
          limit: params.limit === undefined ? undefined : limit,
        },
      });
      return parsed(list(body.data), message);
    },
    async reply(id, input) {
      const payload: Record<string, unknown> = { body: input.body };
      if (input.note) payload.note = true;
      if (input.attachments?.length) payload.attachments = input.attachments;
      const body = await call<{ data?: unknown }>({
        method: 'POST',
        path: conv(id, 'messages'),
        body: payload,
      });
      return one(message(body.data), 'a message');
    },
    async update(id, patch) {
      const payload: Record<string, unknown> = {};
      if (patch.status !== undefined) payload.status = patch.status;
      if (patch.assigneeId !== undefined) payload.assignee_id = patch.assigneeId;
      if (patch.snoozedUntil !== undefined) payload.snoozed_until = patch.snoozedUntil;
      const body = await call<{ data?: unknown }>({ method: 'PATCH', path: conv(id), body: payload });
      return one(conversation(body.data), 'a conversation');
    },
    async markRead(id) {
      await call({ method: 'POST', path: conv(id, 'read') });
    },
    async summary() {
      const body = await call<unknown>({ path: `${BASE}/summary` });
      // `{ open, unassigned, unread }`, bare or under `data`.
      const o = obj(body);
      return InboxSummary.parse(obj(o?.data) ?? o ?? {});
    },
  };
}
