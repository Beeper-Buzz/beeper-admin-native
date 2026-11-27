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

/** Spree 4.2–4.x legacy REST API v1 shapes (see infra/spree/recordings/4.2). Only what we read. */
export interface V1Address {
  firstname: string | null;
  lastname: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  zipcode: string | null;
  phone: string | null;
  state_name: string | null;
  state_text: string | null;
  country?: { iso: string } | null;
  state?: { name: string; abbr: string } | null;
}

export interface V1Order {
  id: number;
  number: string;
  state: string;
  payment_state: string | null;
  shipment_state: string | null;
  email: string | null;
  user_id: number | null;
  currency: string;
  item_total: string;
  ship_total: string;
  tax_total: string;
  adjustment_total: string;
  payment_total: string;
  total: string;
  total_quantity?: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  bill_address?: V1Address | null;
  ship_address?: V1Address | null;
  line_items?: {
    id: number;
    quantity: number;
    price: string;
    total: string;
    variant_id: number;
    variant?: {
      name: string;
      sku: string | null;
      options_text: string | null;
      images?: { mini_url?: string; small_url?: string }[];
    };
  }[];
  shipments?: {
    id: number;
    number: string;
    state: string;
    tracking: string | null;
    cost: string;
    shipped_at: string | null;
    stock_location_name?: string | null;
    selected_shipping_rate?: { name: string } | null;
    manifest?: { variant_id: number; quantity: number }[];
  }[];
  payments?: {
    id: number;
    number: string;
    state: string;
    amount: string;
    created_at: string;
    payment_method?: { name: string } | null;
    source?: { last_digits?: string | null; cc_type?: string | null } | null;
  }[];
}

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

/** Spree 4 payment_state → our vocabulary. Shared with the Platform v2 adapter. */
export function v4PaymentStatus(state: string | null, paymentTotal: number): OrderPaymentStatus {
  switch (state) {
    case null:
      return 'none';
    case 'balance_due':
      return paymentTotal > 0 ? 'partially_paid' : 'unpaid';
    case 'credit_owed':
      return 'overcharged';
    case 'void':
      return 'voided';
    default:
      return state as OrderPaymentStatus;
  }
}

export function mapV1Address(a: V1Address | null | undefined): Address | null {
  if (!a) return null;
  return {
    firstName: a.firstname,
    lastName: a.lastname,
    company: a.company,
    address1: a.address1 ?? '',
    address2: a.address2,
    city: a.city ?? '',
    zipcode: a.zipcode,
    phone: a.phone,
    stateCode: a.state?.abbr ?? a.state_text,
    stateName: a.state?.name ?? a.state_name,
    countryIso: a.country?.iso ?? 'US',
  };
}

export function mapV1Order(o: V1Order): Order {
  const c = o.currency;
  const lineItems: LineItem[] = (o.line_items ?? []).map((li) => ({
    id: String(li.id),
    variantId: String(li.variant_id),
    name: li.variant?.name ?? 'Item',
    sku: li.variant?.sku || null,
    optionsText: li.variant?.options_text || null,
    quantity: li.quantity,
    price: money(li.price, c),
    total: money(li.total, c),
    imageUrl: li.variant?.images?.[0]?.small_url ?? null,
  }));
  const lineByVariant = new Map(lineItems.map((li) => [li.variantId, li.id]));

  const fulfillments: Fulfillment[] = (o.shipments ?? []).map((s) => ({
    id: String(s.id),
    number: s.number,
    status: SHIPMENT_ITEM_STATE[s.state] ?? 'unknown',
    trackingNumber: s.tracking,
    trackingUrl: null,
    fulfilledAt: s.shipped_at,
    methodName: s.selected_shipping_rate?.name ?? null,
    stockLocationName: s.stock_location_name ?? null,
    cost: money(s.cost, c),
    items: (s.manifest ?? []).map((m) => ({
      lineItemId: lineByVariant.get(String(m.variant_id)) ?? String(m.variant_id),
      quantity: m.quantity,
    })),
  }));

  const payments: Payment[] = (o.payments ?? []).map((p) => {
    const last4 = p.source?.last_digits;
    const brand = p.source?.cc_type;
    return {
      id: String(p.id),
      number: p.number,
      status: p.state as Payment['status'],
      amount: money(p.amount, c),
      methodName: p.payment_method?.name ?? null,
      sourceSummary: last4
        ? `${brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Card'} •••• ${last4}`
        : null,
      createdAt: p.created_at,
      canCapture: null,
      canVoid: null,
    };
  });

  const total = money(o.total, c);
  const paid = money(o.payment_total, c);
  const due = Math.max(0, Number(total.amount) - Number(paid.amount));
  const promo = Number(o.adjustment_total);
  return Order.parse({
    id: String(o.id),
    number: o.number,
    status: ORDER_STATUS[o.state] ?? o.state,
    paymentStatus: v4PaymentStatus(o.payment_state, Number(o.payment_total)),
    fulfillmentStatus: o.shipment_state ? (SHIPMENT_STATE[o.shipment_state] ?? o.shipment_state) : 'none',
    rawState: o.state,
    email: o.email,
    customer: o.user_id && o.email ? { id: String(o.user_id), email: o.email } : null,
    currency: c,
    itemCount: o.total_quantity ?? lineItems.reduce((n, li) => n + li.quantity, 0),
    itemTotal: money(o.item_total, c),
    shipTotal: money(o.ship_total, c),
    taxTotal: money(o.tax_total, c),
    discountTotal: money(String(promo < 0 ? -promo : 0), c),
    total,
    paymentTotal: paid,
    amountDue: money(due.toFixed(4), c),
    completedAt: o.completed_at,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    billAddress: mapV1Address(o.bill_address),
    shipAddress: mapV1Address(o.ship_address),
    lineItems,
    fulfillments,
    payments,
  });
}
