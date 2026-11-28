import { Cart, VisitorPage, VisitorSession, type VisitorSessionDetail } from '@instincts/spree-domain';
import { SpreeError } from '../errors';
import type { CartsPort, VisitorsPort } from '../ports';
import type { Transport } from '../transport';
import { absoluteUrl, idOf, list, obj, pageMeta, parsed, str, toMoney } from './shapes';

/**
 * Carts (built into the companion gem 0.7, `carts`) and storefront sessions (a host adapter,
 * `visitors`), in the shapes of docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md §3.
 */
const BASE = '/api/admin_native/v1';

/** A cart; `base` (the store's URL) makes relative image URLs absolute. */
export function mapGemCart(raw: unknown, base: string | null = null): Cart | null {
  const c = obj(raw);
  if (!c) return null;
  const result = Cart.safeParse({
    number: str(c.number),
    state: str(c.state) ?? undefined,
    email: str(c.email),
    userId: idOf(c.user_id),
    itemCount: c.item_count,
    total: toMoney(c.total, c.currency),
    updatedAt: str(c.updated_at),
    abandoned: typeof c.abandoned === 'boolean' ? c.abandoned : null,
    items: parsed(list(c.items), (i) => {
      const o = obj(i);
      return o
        ? {
            name: str(o.name) ?? 'Item',
            variantSku: str(o.variant_sku),
            quantity: o.quantity,
            imageUrl: absoluteUrl(o.image_url, base),
          }
        : null;
    }),
  });
  return result.success ? result.data : null;
}

export function mapGemSession(raw: unknown): VisitorSession | null {
  const s = obj(raw);
  if (!s) return null;
  const contact = obj(s.contact);
  const utm = obj(s.utm);
  const cart = obj(s.cart);
  const result = VisitorSession.safeParse({
    id: idOf(s.id),
    contact: contact ? { id: idOf(contact.id), name: str(contact.name), email: str(contact.email) } : null,
    userId: idOf(s.user_id),
    currentUrl: str(s.current_url),
    currentTitle: str(s.current_title),
    referrer: str(s.referrer),
    utm: utm ? { source: str(utm.source), medium: str(utm.medium), campaign: str(utm.campaign) } : null,
    device: s.device ?? null,
    country: str(s.country),
    startedAt: str(s.started_at),
    lastSeenAt: str(s.last_seen_at),
    online: s.online === true,
    pageViews: s.page_views,
    cart:
      cart && str(cart.order_number)
        ? {
            orderNumber: str(cart.order_number),
            itemCount: cart.item_count,
            total: toMoney(cart.total, cart.currency),
          }
        : null,
    conversationId: idOf(s.conversation_id),
  });
  return result.success ? result.data : null;
}

export function mapGemSessionDetail(raw: unknown): VisitorSessionDetail | null {
  const session = mapGemSession(raw);
  if (!session) return null;
  const pages = parsed(list(obj(raw)?.pages), (p) => {
    const o = obj(p);
    if (!o) return null;
    const page = VisitorPage.safeParse({ url: str(o.url) ?? '', title: str(o.title), at: str(o.at) });
    return page.success ? page.data : null;
  });
  return { ...session, pages };
}

const unreadable = (what: string) =>
  new SpreeError({ kind: 'parse', status: 200, message: `The store sent ${what} the app could not read.` });

export function companionCarts(transport: Transport): CartsPort {
  return {
    async list(params) {
      const page = params.cursor ? Math.max(1, Number(params.cursor) || 1) : 1;
      const perPage = params.perPage ?? 25;
      const query: Record<string, string | number | boolean | undefined> = { page, per_page: perPage };
      if (params.activeWithin) query.active_within = params.activeWithin;
      if (params.withEmail !== undefined && params.withEmail !== null) query.with_email = params.withEmail;
      if (params.abandoned !== undefined && params.abandoned !== null) query.abandoned = params.abandoned;
      const { data } = await transport.request<{ data?: unknown; meta?: unknown }>({
        path: `${BASE}/carts`,
        query,
      });
      const rows = list(data.data);
      return {
        items: parsed(rows, (r) => mapGemCart(r, transport.baseUrl || null)),
        ...pageMeta(data.meta, page, perPage, rows.length),
      };
    },
    async get(number) {
      const { data } = await transport.request<{ data?: unknown }>({
        path: `${BASE}/carts/${encodeURIComponent(number)}`,
      });
      const cart = mapGemCart(data.data, transport.baseUrl || null);
      if (!cart) throw unreadable('a cart');
      return cart;
    },
  };
}

export function companionVisitors(transport: Transport): VisitorsPort {
  return {
    async list(params) {
      const page = params.cursor ? Math.max(1, Number(params.cursor) || 1) : 1;
      const perPage = params.perPage ?? 25;
      const query: Record<string, string | number | boolean | undefined> = { page, per_page: perPage };
      if (params.online !== undefined) query.online = params.online;
      const { data } = await transport.request<{ data?: unknown; meta?: unknown }>({
        path: `${BASE}/visitors`,
        query,
      });
      const rows = list(data.data);
      return { items: parsed(rows, mapGemSession), ...pageMeta(data.meta, page, perPage, rows.length) };
    },
    async get(id) {
      const { data } = await transport.request<{ data?: unknown }>({
        path: `${BASE}/visitors/${encodeURIComponent(id)}`,
      });
      const session = mapGemSessionDetail(data.data);
      if (!session) throw unreadable('a visitor');
      return session;
    },
    async startConversation(id) {
      const { data } = await transport.request<unknown>({
        method: 'POST',
        path: `${BASE}/visitors/${encodeURIComponent(id)}/conversation`,
      });
      // `{ conversation_id }`, bare or under `data`.
      const o = obj(data);
      const conversationId = idOf((obj(o?.data) ?? o)?.conversation_id);
      if (!conversationId) throw unreadable('a conversation');
      return { conversationId };
    },
  };
}
