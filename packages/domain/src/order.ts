import { z } from 'zod';
import { Address } from './address';
import { Id, IsoDateTime, SpreeNumber, tolerantEnum } from './common';
import { Money } from './money';

/**
 * Version-neutral order vocabulary, modelled on Spree 6's Admin API. Adapters map older
 * APIs into it (e.g. Spree 4 `state: complete` → `placed`, `payment_state: balance_due` → `unpaid`).
 */
export const OrderStatus = tolerantEnum(['draft', 'placed', 'canceled', 'returned'] as const);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const OrderPaymentStatus = tolerantEnum([
  'none',
  'unpaid',
  'authorized',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
  'overcharged',
  'voided',
  'failed',
] as const);
export type OrderPaymentStatus = z.infer<typeof OrderPaymentStatus>;

export const OrderFulfillmentStatus = tolerantEnum([
  'none',
  'unfulfilled',
  'partial',
  'backorder',
  'fulfilled',
  'delivered',
  'canceled',
] as const);
export type OrderFulfillmentStatus = z.infer<typeof OrderFulfillmentStatus>;

/** A shipment (Spree 4/5) or fulfillment (Spree 6). */
export const FulfillmentStatus = tolerantEnum([
  'pending',
  'ready',
  'fulfilled',
  'delivered',
  'canceled',
] as const);
/** Same values in Spree 4 and 6. */
export const PaymentStatus = tolerantEnum([
  'checkout',
  'pending',
  'processing',
  'requested',
  'completed',
  'failed',
  'void',
  'invalid',
] as const);

export const LineItem = z.object({
  id: Id,
  variantId: Id,
  name: z.string(),
  sku: z.string().nullable(),
  optionsText: z.string().nullable(),
  quantity: z.number().int().nonnegative(),
  price: Money,
  total: Money,
  imageUrl: z.string().nullable(),
});
export type LineItem = z.infer<typeof LineItem>;

/** A delivery option the store quotes for a shipment (Spree 4 shipping rate, Spree 6 delivery rate). */
export const ShippingRate = z.object({
  id: Id,
  name: z.string(),
  cost: Money,
  selected: z.boolean(),
});
export type ShippingRate = z.infer<typeof ShippingRate>;

export const Fulfillment = z.object({
  id: Id,
  number: SpreeNumber,
  status: FulfillmentStatus,
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  fulfilledAt: IsoDateTime.nullable(),
  methodName: z.string().nullable(),
  stockLocationName: z.string().nullable(),
  cost: Money,
  items: z.array(z.object({ lineItemId: Id, quantity: z.number().int().nonnegative() })),
  /** The rates the merchant can choose between while the order is a draft; empty when not read. */
  rates: z.array(ShippingRate).default([]),
});
export type Fulfillment = z.infer<typeof Fulfillment>;

export const Payment = z.object({
  id: Id,
  number: SpreeNumber,
  status: PaymentStatus,
  amount: Money,
  methodName: z.string().nullable(),
  /** e.g. "Visa •••• 4242". */
  sourceSummary: z.string().nullable(),
  createdAt: IsoDateTime,
  /** null when the API doesn't say (Spree 4). */
  canCapture: z.boolean().nullable(),
  canVoid: z.boolean().nullable(),
});
export type Payment = z.infer<typeof Payment>;

/**
 * A payment method the merchant can record without card details (Check, cash, bank transfer):
 * what an order created in the app can be paid with.
 */
export const ManualPaymentMethod = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
});
export type ManualPaymentMethod = z.infer<typeof ManualPaymentMethod>;

export const OrderCustomer = z.object({ id: Id, email: z.string() });

export const Order = z.object({
  id: Id,
  number: SpreeNumber,
  status: OrderStatus,
  paymentStatus: OrderPaymentStatus,
  fulfillmentStatus: OrderFulfillmentStatus,
  /** The API's own state value, for support and debugging. */
  rawState: z.string().nullable(),
  email: z.string().nullable(),
  customer: OrderCustomer.nullable(),
  currency: z.string().length(3),
  itemCount: z.number().int().nonnegative(),
  itemTotal: Money,
  shipTotal: Money,
  taxTotal: Money,
  discountTotal: Money,
  total: Money,
  paymentTotal: Money,
  amountDue: Money,
  completedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  billAddress: Address.nullable(),
  shipAddress: Address.nullable(),
  lineItems: z.array(LineItem),
  fulfillments: z.array(Fulfillment),
  payments: z.array(Payment),
});
export type Order = z.infer<typeof Order>;

/** The order list filters both adapters must support. */
export const OrderListFilter = z.enum(['unfulfilled', 'unpaid', 'open', 'all']);
export type OrderListFilter = z.infer<typeof OrderListFilter>;

const PAYMENT_ACTION: ReadonlySet<OrderPaymentStatus> = new Set([
  'unpaid',
  'partially_paid',
  'authorized',
  'failed',
]);
const FULFILLMENT_ACTION: ReadonlySet<OrderFulfillmentStatus> = new Set([
  'unfulfilled',
  'partial',
  'backorder',
]);

/** True when a placed order is waiting on the merchant: payment to collect or items to ship. */
export function needsAction(order: Pick<Order, 'status' | 'paymentStatus' | 'fulfillmentStatus'>): boolean {
  if (order.status !== 'placed') return false;
  return PAYMENT_ACTION.has(order.paymentStatus) || FULFILLMENT_ACTION.has(order.fulfillmentStatus);
}
