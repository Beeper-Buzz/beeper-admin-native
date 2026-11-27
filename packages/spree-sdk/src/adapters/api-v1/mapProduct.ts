import {
  Customer,
  type Image,
  money,
  type OptionValue,
  Product,
  type Variant,
} from '@instincts/spree-domain';
import { mapV1Address, type V1Address } from './mapOrder';

/** Spree 4.2–4.3 API v1 catalog shapes (rabl views; see infra/spree/recordings/4.2). Only what we read. */
export interface V1Image {
  id: number;
  position?: number;
  alt: string | null;
  mini_url?: string | null;
  small_url?: string | null;
  product_url?: string | null;
  large_url?: string | null;
}

export interface V1OptionValue {
  id: number;
  name: string;
  presentation: string;
  option_type_id: number;
  option_type_name?: string;
  option_type_presentation?: string;
}

export interface V1Variant {
  id: number;
  sku: string | null;
  /** In Spree::Config[:currency]; v1 never sends the code. */
  price: string | null;
  is_master: boolean;
  options_text: string | null;
  track_inventory: boolean;
  /** Infinity (or a string) when inventory isn't tracked. */
  total_on_hand: number | string | null;
  is_orderable?: boolean;
  option_values?: V1OptionValue[];
  images?: V1Image[];
}

export interface V1Product {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  /** No discontinue_on or deleted_at in v1: archived products are only visible with `show_discontinued`. */
  available_on: string | null;
  master: V1Variant;
  variants?: V1Variant[];
  option_types?: { id: number; name: string; presentation: string; position: number }[];
}

export interface V1ProductList {
  products: V1Product[];
  count: number;
  total_count: number;
  current_page: number;
  per_page: number;
  pages: number;
}

/**
 * Spree 4.2 has no status column. `archived` comes from how the product was found (discontinued
 * or deleted products only appear with `show_discontinued` / `show_deleted`); otherwise a product
 * is a draft until its available_on date has passed.
 */
export function v1ProductStatus(
  availableOn: string | null,
  archived: boolean,
  now: number = Date.now(),
): 'active' | 'draft' | 'archived' {
  if (archived) return 'archived';
  return isAvailableOn(availableOn, now) ? 'active' : 'draft';
}

export function isAvailableOn(availableOn: string | null, now: number = Date.now()): boolean {
  if (!availableOn) return false;
  const at = Date.parse(availableOn);
  return !Number.isNaN(at) && at <= now;
}

const imageUrl = (i: V1Image): string | null => i.large_url ?? i.product_url ?? i.small_url ?? null;
const thumbUrl = (i: V1Image | undefined): string | null =>
  i ? (i.product_url ?? i.small_url ?? i.large_url ?? null) : null;

function mapImages(images: V1Image[] | undefined): Image[] {
  return (images ?? []).flatMap((i) => {
    const url = imageUrl(i);
    return url ? [{ url, alt: i.alt }] : [];
  });
}

/** Spree 4's sample color option keeps the hex swatch in `presentation`. */
const HEX = /^#[0-9a-f]{6}$/i;

function mapOptionValue(ov: V1OptionValue, position: number): OptionValue {
  return {
    id: String(ov.id),
    optionTypeId: String(ov.option_type_id),
    name: ov.name,
    presentation: HEX.test(ov.presentation) ? ov.name : ov.presentation,
    position,
    color: HEX.test(ov.presentation) ? ov.presentation : null,
  };
}

function onHand(v: V1Variant): number | null {
  if (!v.track_inventory) return null;
  const n = typeof v.total_on_hand === 'string' ? Number(v.total_on_hand) : v.total_on_hand;
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null;
}

export function mapV1Variant(v: V1Variant, currency: string): Variant {
  return {
    id: String(v.id),
    sku: v.sku || null,
    optionsText: v.options_text || null,
    isMaster: v.is_master,
    price: v.price != null ? money(v.price, currency) : null,
    // v1 accepts compare_at_price on writes but never renders it.
    compareAtPrice: null,
    totalOnHand: onHand(v),
    imageUrl: thumbUrl(v.images?.[0]),
    optionValues: (v.option_values ?? []).map(mapOptionValue),
    images: mapImages(v.images),
    purchasable: v.is_orderable ?? null,
  };
}

export interface V1ProductContext {
  /** The store's currency (v1 prices carry none). */
  currency: string;
  /** Found only with show_discontinued / show_deleted. */
  archived?: boolean;
  now?: number;
}

export function mapV1Product(p: V1Product, ctx: V1ProductContext): Product {
  const variants = [p.master, ...(p.variants ?? [])].map((v) => mapV1Variant(v, ctx.currency));
  const images = mapImages(p.master.images);
  return Product.parse({
    id: String(p.id),
    name: p.name,
    slug: p.slug,
    status: v1ProductStatus(p.available_on, ctx.archived ?? false, ctx.now),
    description: p.description || null,
    imageUrl: thumbUrl(p.master.images?.[0]) ?? variants.find((v) => v.imageUrl !== null)?.imageUrl ?? null,
    variants,
    optionTypes: (p.option_types ?? []).map((t) => ({
      id: String(t.id),
      name: t.name,
      presentation: t.presentation,
      position: t.position,
    })),
    images,
    updatedAt: null,
  });
}

// --- Users (customers) ------------------------------------------------------------------------

export interface V1User {
  id: number;
  email: string;
  created_at: string;
  updated_at: string;
  bill_address?: V1Address | null;
  ship_address?: V1Address | null;
}

export interface V1UserList {
  users: V1User[];
  count: number;
  current_page: number;
  pages: number;
}

/** Spree 4.2 users have no name or phone of their own; they come from the saved addresses. */
export function mapV1User(u: V1User, extras: { ordersCount?: number | null } = {}): Customer {
  const address = u.ship_address ?? u.bill_address ?? null;
  return Customer.parse({
    id: String(u.id),
    email: u.email,
    firstName: address?.firstname || null,
    lastName: address?.lastname || null,
    phone: address?.phone || null,
    ordersCount: extras.ordersCount ?? null,
    totalSpent: null,
    createdAt: u.created_at,
    defaultAddress: mapV1Address(address),
  });
}
