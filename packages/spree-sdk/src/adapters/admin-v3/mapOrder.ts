import {
  type Address,
  type Fulfillment,
  type LineItem,
  money,
  Order,
  type OrderFulfillmentStatus,
  type OrderPaymentStatus,
  type OrderStatus,
  type Payment,
} from '@instincts/spree-domain';
import type {
  Address as V3Address,
  Fulfillment as V3Fulfillment,
  LineItem as V3LineItem,
  Order as V3Order,
  Payment as V3Payment,
} from '@spree/admin-sdk';

const ORDER_STATUS: Record<string, OrderStatus> = { draft: 'draft', placed: 'placed', canceled: 'canceled' };

/** Spree 6 keeps a few Spree 4 shipment-state values in this enum; fold them into ours. */
const FULFILLMENT_STATUS: Record<string, OrderFulfillmentStatus> = {
  pending: 'unfulfilled',
  ready: 'unfulfilled',
  unfulfilled: 'unfulfilled',
  partial: 'partial',
  backorder: 'backorder',
  shipped: 'fulfilled',
  fulfilled: 'fulfilled',
  delivered: 'delivered',
  canceled: 'canceled',
};

function paymentStatus(o: Pick<V3Order, 'payment_status' | 'status' | 'total'>): OrderPaymentStatus {
  const s = o.payment_status;
  // Spree 6 says "none" for a placed order nobody has paid yet; merchants call that unpaid.
  if (s === null || s === 'none') return o.status === 'placed' && Number(o.total) > 0 ? 'unpaid' : 'none';
  return s;
}

const FULFILLMENT_ITEM_STATUS: Record<string, Fulfillment['status']> = {
  unfulfilled: 'ready',
  pending: 'pending',
  ready: 'ready',
  fulfilled: 'fulfilled',
  shipped: 'fulfilled',
  delivered: 'delivered',
  canceled: 'canceled',
};

function mapAddress(a: V3Address | null | undefined): Address | null {
  if (!a) return null;
  return {
    firstName: a.first_name,
    lastName: a.last_name,
    company: a.company,
    address1: a.address1 ?? '',
    address2: a.address2,
    city: a.city ?? '',
    zipcode: a.postal_code,
    phone: a.phone,
    stateCode: a.state_code,
    stateName: a.state_name ?? a.state_text,
    countryIso: a.country_code,
  };
}

function mapLineItem(li: V3LineItem): LineItem {
  return {
    id: li.id,
    variantId: li.variant_id,
    name: li.name,
    sku: null,
    optionsText: li.options_text || null,
    quantity: li.quantity,
    price: money(li.price, li.currency),
    total: money(li.total, li.currency),
    imageUrl: li.thumbnail_url,
  };
}

function mapFulfillment(f: V3Fulfillment, currency: string): Fulfillment {
  return {
    id: f.id,
    number: f.number,
    status: FULFILLMENT_ITEM_STATUS[f.status] ?? 'unknown',
    trackingNumber: f.tracking,
    trackingUrl: f.tracking_url,
    fulfilledAt: f.fulfilled_at,
    methodName: f.delivery_method?.name ?? null,
    stockLocationName: f.stock_location?.name ?? null,
    cost: money(f.cost, currency),
    items: f.items.map((i) => ({ lineItemId: i.item_id, quantity: i.quantity })),
  };
}

function sourceSummary(p: V3Payment): string | null {
  const s = p.source as { brand?: string; last4?: string } | null;
  if (s?.last4)
    return `${s.brand ? s.brand.charAt(0).toUpperCase() + s.brand.slice(1) : 'Card'} •••• ${s.last4}`;
  return null;
}

function mapPayment(p: V3Payment, currency: string): Payment {
  return {
    id: p.id,
    number: p.number,
    status: p.status as Payment['status'],
    amount: money(p.amount, currency),
    methodName: p.payment_method?.name ?? null,
    sourceSummary: sourceSummary(p),
    createdAt: p.created_at,
    canCapture: p.can_capture,
    canVoid: p.can_void,
  };
}

/** Admin API v3 order (with items, fulfillments, payments and addresses expanded) → domain Order. */
export function mapOrder(o: V3Order): Order {
  const c = o.currency;
  return Order.parse({
    id: o.id,
    number: o.number,
    status: ORDER_STATUS[o.status] ?? o.status,
    paymentStatus: paymentStatus(o),
    fulfillmentStatus: o.fulfillment_status
      ? (FULFILLMENT_STATUS[o.fulfillment_status] ?? o.fulfillment_status)
      : 'none',
    rawState: o.status,
    email: o.email,
    customer: o.customer_id ? { id: o.customer_id, email: o.customer?.email ?? o.email } : null,
    currency: c,
    itemCount: o.total_quantity,
    itemTotal: money(o.item_total, c),
    shipTotal: money(o.delivery_total, c),
    taxTotal: money(o.tax_total, c),
    discountTotal: money(o.discount_total, c),
    total: money(o.total, c),
    paymentTotal: money(o.payment_total, c),
    amountDue: money(o.amount_due, c),
    completedAt: o.completed_at,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    billAddress: mapAddress(o.billing_address),
    shipAddress: mapAddress(o.shipping_address),
    lineItems: (o.items ?? []).map(mapLineItem),
    fulfillments: (o.fulfillments ?? []).map((f) => mapFulfillment(f, c)),
    payments: (o.payments ?? []).map((p) => mapPayment(p, c)),
  });
}
