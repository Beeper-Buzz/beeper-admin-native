import { Customer, type Image, type Money, money, Product, type Variant } from '@instincts/spree-domain';
import type {
  Customer as V3Customer,
  Media as V3Media,
  Price as V3Price,
  Product as V3Product,
  Variant as V3Variant,
} from '@spree/admin-sdk';
import { mapV3Address } from './mapOrder';

function price(p: Pick<V3Price, 'amount' | 'currency'> | null | undefined): Money | null {
  return p?.amount != null && p.currency ? money(p.amount, p.currency) : null;
}

/** Spree 6 stores "no compare-at price" as 0.00 as often as null. */
function compareAt(p: V3Price | null | undefined): Money | null {
  if (!p?.compare_at_amount || !p.currency || Number(p.compare_at_amount) === 0) return null;
  return money(p.compare_at_amount, p.currency);
}

function mapMedia(media: V3Media[] | undefined): Image[] {
  return (media ?? []).flatMap((m) => {
    const url = m.large_url ?? m.original_url ?? m.medium_url ?? m.small_url;
    return url ? [{ url, alt: m.alt }] : [];
  });
}

export function mapV3Variant(v: V3Variant): Variant {
  return {
    id: v.id,
    sku: v.sku || null,
    optionsText: v.options_text || null,
    // Spree 6 has no master variant: every variant, including a simple product's only one, is sellable.
    isMaster: false,
    price: price(v.price),
    compareAtPrice: compareAt(v.price),
    totalOnHand: v.track_inventory ? v.total_on_hand : null,
    imageUrl: v.thumbnail_url,
    optionValues: (v.option_values ?? []).map((ov) => ({
      id: ov.id,
      optionTypeId: ov.option_type_id,
      name: ov.name,
      presentation: ov.label,
      position: ov.position,
      color: ov.color_code,
    })),
    images: mapMedia(v.media),
    purchasable: v.purchasable,
  };
}

/** Admin API v3 product with `variants` and `option_types` (and optionally `media`) expanded. */
export function mapV3Product(p: V3Product): Product {
  const variants = (p.variants ?? (p.default_variant ? [p.default_variant] : [])).map(mapV3Variant);
  return Product.parse({
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.deleted_at ? 'archived' : p.status,
    // The stored rich text, so an edit round-trips; `description` is its plain-text rendering.
    description: p.description_html ?? p.description ?? null,
    imageUrl: p.thumbnail_url ?? variants.find((v) => v.imageUrl !== null)?.imageUrl ?? null,
    variants,
    optionTypes: (p.option_types ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      presentation: t.label,
      position: t.position,
    })),
    images: mapMedia(p.media),
    updatedAt: p.updated_at,
  });
}

/** Admin API v3 customer, with default addresses expanded when present. `currency` prices total_spent. */
export function mapV3Customer(c: V3Customer, currency: string): Customer {
  return Customer.parse({
    id: c.id,
    email: c.email,
    firstName: c.first_name,
    lastName: c.last_name,
    phone: c.phone,
    ordersCount: c.orders_count ?? null,
    totalSpent: c.total_spent != null ? money(c.total_spent, currency) : null,
    createdAt: c.created_at,
    defaultAddress: mapV3Address(c.default_shipping_address ?? c.default_billing_address ?? null),
  });
}
