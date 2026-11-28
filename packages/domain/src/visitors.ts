import { z } from 'zod';
import { Id, tolerantEnum } from './common';
import { Money } from './money';

/**
 * Carts (built into the companion gem 0.7, capability `carts`) and storefront visitor sessions
 * (a host adapter, capability `visitors`); docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md
 * §3. Tolerant like the rest of the domain: missing keys default, unknown devices are `unknown`.
 */

const Text = z.string().nullable().default(null);
const Count = z.number().int().nonnegative().catch(0).default(0);

export const CartItem = z.object({
  name: z.string().default('Item'),
  variantSku: Text,
  quantity: Count,
  imageUrl: Text,
});
export type CartItem = z.infer<typeof CartItem>;

/** An incomplete order with items (`cart`, `address`, `delivery` or `payment`). */
export const Cart = z.object({
  number: z.string().min(1),
  state: z.string().default('cart'),
  email: Text,
  userId: Id.nullable().default(null),
  itemCount: Count,
  /** null when the store sent no total, or one that isn't money. */
  total: Money.nullable().default(null),
  updatedAt: Text,
  /** The gem's own verdict (0.7 sends it); null when the store didn't say. */
  abandoned: z.boolean().nullable().catch(null).default(null),
  items: z.array(CartItem).default([]),
});
export type Cart = z.infer<typeof Cart>;

/** Carts untouched for this long, with an email to write to, count as abandoned. */
export const ABANDONED_AFTER_MS = 60 * 60 * 1000;

/**
 * A cart with an email that hasn't changed for an hour or more: the store's `abandoned` when it
 * sent one, else worked out from the email and `updatedAt`.
 */
export function isAbandoned(
  cart: Pick<Cart, 'email' | 'updatedAt'> & { abandoned?: boolean | null },
  now = Date.now(),
): boolean {
  if (typeof cart.abandoned === 'boolean') return cart.abandoned;
  if (!cart.email || !cart.updatedAt) return false;
  const at = Date.parse(cart.updatedAt);
  return Number.isFinite(at) && now - at >= ABANDONED_AFTER_MS;
}

export const VISITOR_DEVICES = ['mobile', 'desktop', 'tablet'] as const;
export const VisitorDevice = z.preprocess(
  (v) => (v === null || v === undefined || v === '' ? null : v),
  tolerantEnum(VISITOR_DEVICES).nullable(),
);
export type VisitorDevice = z.infer<typeof VisitorDevice>;

export const SessionCart = z.object({
  orderNumber: z.string().min(1),
  itemCount: Count,
  total: Money.nullable().default(null),
});
export type SessionCart = z.infer<typeof SessionCart>;

/** A storefront visit. `online` means seen within the last 2 minutes. */
export const VisitorSession = z.object({
  id: Id,
  contact: z
    .object({ id: Id.nullable().default(null), name: Text, email: Text })
    .nullable()
    .default(null),
  userId: Id.nullable().default(null),
  currentUrl: Text,
  currentTitle: Text,
  referrer: Text,
  utm: z.object({ source: Text, medium: Text, campaign: Text }).nullable().default(null),
  device: VisitorDevice.default(null),
  country: Text,
  startedAt: Text,
  lastSeenAt: Text,
  online: z.boolean().catch(false).default(false),
  pageViews: Count,
  cart: SessionCart.nullable().default(null),
  /** The conversation with this visitor, when there is one. */
  conversationId: Id.nullable().default(null),
});
export type VisitorSession = z.infer<typeof VisitorSession>;

export const VisitorPage = z.object({ url: z.string().default(''), title: Text, at: Text });
export type VisitorPage = z.infer<typeof VisitorPage>;

/** One session with its last 50 page views, newest first as the store sends them. */
export type VisitorSessionDetail = VisitorSession & { pages: VisitorPage[] };

/** A visitor's name for lists: contact name, email, else where they are from. */
export function visitorName(session: Pick<VisitorSession, 'contact' | 'country'>): string {
  return (
    session.contact?.name?.trim() ||
    session.contact?.email?.trim() ||
    (session.country ? `Visitor from ${session.country}` : 'Visitor')
  );
}
