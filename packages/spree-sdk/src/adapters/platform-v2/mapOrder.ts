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
import { type Document, JsonApiGraph, num, type Resource, str } from '../jsonapi';

/** Spree 4.x checkout steps are all "draft" to a merchant. */
const ORDER_STATUS: Record<string, OrderStatus> = {
  cart: 'draft',
  address: 'draft',
  delivery: 'draft',
  payment: 'draft',
  confirm: 'draft',
  complete: 'placed',
  resumed: 'placed',
  awaiting_return: 'placed',
  canceled: 'canceled',
  returned: 'returned',
};

const SHIPMENT_STATE: Record<string, OrderFulfillmentStatus> = {
  pending: 'unfulfilled',
  ready: 'unfulfilled',
  partial: 'partial',
  backorder: 'backorder',
  shipped: 'fulfilled',
  canceled: 'canceled',
};

const SHIPMENT_ITEM_STATE: Record<string, Fulfillment['status']> = {
  pending: 'pending',
  ready: 'ready',
  shipped: 'fulfilled',
  canceled: 'canceled',
};

function paymentStatus(order: Resource): OrderPaymentStatus {
  const state = str(order, 'payment_state');
  switch (state) {
    case null:
      return 'none';
    case 'balance_due':
      return (num(order, 'payment_total') ?? 0) > 0 ? 'partially_paid' : 'unpaid';
    case 'paid':
      return 'paid';
    case 'credit_owed':
      return 'overcharged';
    case 'failed':
      return 'failed';
    case 'void':
      return 'voided';
    default:
      return state as OrderPaymentStatus;
  }
}

function mapAddress(a: Resource | null): Address | null {
  if (!a) return null;
  return {
    firstName: str(a, 'firstname'),
    lastName: str(a, 'lastname'),
    company: str(a, 'company'),
    address1: str(a, 'address1') ?? '',
    address2: str(a, 'address2'),
    city: str(a, 'city') ?? '',
    zipcode: str(a, 'zipcode'),
    phone: str(a, 'phone'),
    stateCode: str(a, 'state_abbr') ?? str(a, 'state_code'),
    stateName: str(a, 'state_name'),
    countryIso: str(a, 'country_iso') ?? str(a, 'country_iso2') ?? 'US',
  };
}

const iso = (r: Resource | null, key: string): string | null => {
  const v = str(r, key);
  return v ? new Date(v).toISOString() : null;
};

export function mapOrderResource(g: JsonApiGraph, o: Resource): Order {
  const currency = str(o, 'currency') ?? 'USD';
  const m = (key: string) => money(str(o, key) ?? '0', currency);
  const state = str(o, 'state');
  const shipmentState = str(o, 'shipment_state');
  const total = m('total');
  const paymentTotal = m('payment_total');

  const lineItems: LineItem[] = g.many(o, 'line_items').map((li) => {
    const variant = g.one(li, 'variant');
    const product = g.one(variant, 'product');
    const price = money(str(li, 'price') ?? '0', currency);
    const qty = num(li, 'quantity') ?? 0;
    return {
      id: li.id,
      variantId: g.oneId(li, 'variant') ?? li.id,
      name: str(li, 'name') ?? str(product, 'name') ?? str(variant, 'name') ?? 'Item',
      sku: str(li, 'sku') ?? str(variant, 'sku'),
      optionsText: str(li, 'options_text') ?? str(variant, 'options_text'),
      quantity: qty,
      price,
      total: money(str(li, 'total') ?? str(li, 'amount') ?? String(Number(price.amount) * qty), currency),
      imageUrl: null,
    };
  });

  const fulfillments: Fulfillment[] = g.many(o, 'shipments').map((s) => {
    const rate =
      g.many(s, 'shipping_rates').find((r) => r.attributes.selected === true) ??
      g.one(s, 'selected_shipping_rate');
    const units = g.many(s, 'inventory_units');
    const counts = new Map<string, number>();
    for (const u of units) {
      const li = g.oneId(u, 'line_item');
      if (li) counts.set(li, (counts.get(li) ?? 0) + (num(u, 'quantity') ?? 1));
    }
    return {
      id: s.id,
      number: str(s, 'number') ?? `H${s.id}`,
      status: SHIPMENT_ITEM_STATE[str(s, 'state') ?? ''] ?? 'unknown',
      trackingNumber: str(s, 'tracking'),
      trackingUrl: str(s, 'tracking_url'),
      fulfilledAt: iso(s, 'shipped_at'),
      methodName: str(rate, 'name') ?? str(g.one(rate, 'shipping_method'), 'name'),
      stockLocationName: str(g.one(s, 'stock_location'), 'name'),
      cost: money(str(s, 'cost') ?? '0', currency),
      items: [...counts].map(([lineItemId, quantity]) => ({ lineItemId, quantity })),
    };
  });

  const payments: Payment[] = g.many(o, 'payments').map((p) => {
    const source = g.one(p, 'source');
    const last4 = str(source, 'last_digits');
    const brand = str(source, 'cc_type');
    return {
      id: p.id,
      number: str(p, 'number') ?? `P${p.id}`,
      status: (str(p, 'state') ?? 'unknown') as Payment['status'],
      amount: money(str(p, 'amount') ?? '0', currency),
      methodName: str(g.one(p, 'payment_method'), 'name'),
      sourceSummary: last4
        ? `${brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Card'} •••• ${last4}`
        : null,
      createdAt: iso(p, 'created_at') ?? new Date(0).toISOString(),
      canCapture: null,
      canVoid: null,
    };
  });

  const user = g.one(o, 'user');
  const userId = g.oneId(o, 'user');
  return Order.parse({
    id: o.id,
    number: str(o, 'number'),
    status: ORDER_STATUS[state ?? ''] ?? state,
    paymentStatus: paymentStatus(o),
    fulfillmentStatus: shipmentState ? (SHIPMENT_STATE[shipmentState] ?? shipmentState) : 'none',
    rawState: state,
    email: str(o, 'email'),
    customer: userId ? { id: userId, email: str(user, 'email') ?? str(o, 'email') ?? '' } : null,
    currency,
    itemCount: num(o, 'item_count') ?? lineItems.reduce((n, li) => n + li.quantity, 0),
    itemTotal: m('item_total'),
    shipTotal: money(str(o, 'shipment_total') ?? str(o, 'ship_total') ?? '0', currency),
    taxTotal: money(
      String((num(o, 'additional_tax_total') ?? 0) + (num(o, 'included_tax_total') ?? 0)),
      currency,
    ),
    discountTotal: money(String(Math.abs(num(o, 'promo_total') ?? 0)), currency),
    total,
    paymentTotal,
    amountDue: money(String(Math.max(0, Number(total.amount) - Number(paymentTotal.amount))), currency),
    completedAt: iso(o, 'completed_at'),
    createdAt: iso(o, 'created_at'),
    updatedAt: iso(o, 'updated_at'),
    billAddress: mapAddress(g.one(o, 'bill_address')),
    shipAddress: mapAddress(g.one(o, 'ship_address')),
    lineItems,
    fulfillments,
    payments,
  });
}

/** Map a Platform v2 list or show document. */
export function mapOrderDocument(doc: Document): Order[] {
  const g = new JsonApiGraph(doc);
  return (Array.isArray(doc.data) ? doc.data : [doc.data]).map((o) => mapOrderResource(g, o));
}
