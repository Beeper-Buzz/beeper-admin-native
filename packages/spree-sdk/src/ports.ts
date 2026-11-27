import type {
  Customer,
  Fulfillment,
  Order,
  OrderListFilter,
  Page,
  Payment,
  Product,
  Promotion,
  PromotionListFilter,
} from '@instincts/spree-domain';
import type { ApiFamily } from './capabilities/types';
import type { CompanionPort } from './companion';

export interface ListOrdersParams {
  filter: OrderListFilter;
  /** Free-text search: order number, email or name. */
  query?: string;
  cursor?: string | null;
  perPage?: number;
}

export type OrderRef = Pick<Order, 'id' | 'number'>;
export type FulfillmentRef = Pick<Fulfillment, 'id' | 'number'>;
export type PaymentRef = Pick<Payment, 'id' | 'number'>;

export interface RefundReason {
  id: string;
  name: string;
}

export interface RefundInput {
  payment: PaymentRef;
  /** Decimal string in the order's currency, e.g. "12.50". */
  amount: string;
  /** Defaults to the store's return-processing (or first) reason. */
  reasonId?: string | null;
}

/**
 * Orders: reads, plus the merchant's actions. Each action returns the order as it now is.
 * An action the store's API can't do throws a `capability` SpreeError; screens gate on the
 * store's capabilities (`orders.capture`, `shipments.ship`, `orders.cancel`, `orders.refund`).
 */
export interface OrdersPort {
  list(params: ListOrdersParams): Promise<Page<Order>>;
  /** By id or order number (`R123456789`). */
  get(idOrNumber: string): Promise<Order>;
  /** Mark a fulfillment (shipment) shipped, with an optional tracking number or link. */
  ship(order: OrderRef, fulfillment: FulfillmentRef, input?: { tracking?: string | null }): Promise<Order>;
  /** Capture an authorized payment in full. */
  capture(order: OrderRef, payment: PaymentRef): Promise<Order>;
  cancel(order: OrderRef): Promise<Order>;
  refund(order: OrderRef, input: RefundInput): Promise<Order>;
  refundReasons(): Promise<RefundReason[]>;
}

// --- Products ------------------------------------------------------------------------------

export type ProductStatusFilter = 'all' | 'active' | 'draft' | 'archived';

export interface ListProductsParams {
  /** Name or SKU. */
  query?: string;
  status?: ProductStatusFilter;
  cursor?: string | null;
  perPage?: number;
}

export interface ProductUpdate {
  name?: string;
  description?: string | null;
  /** draft hides it from the storefront, archived retires it. */
  status?: 'active' | 'draft' | 'archived';
}

export interface VariantUpdate {
  /** Decimal string in the store's currency. */
  price?: string;
  compareAtPrice?: string | null;
  sku?: string | null;
}

/** `products.read`, `products.write`, `inventory.adjust`. Every write returns the product as it now is. */
export interface ProductsPort {
  list(params: ListProductsParams): Promise<Page<Product>>;
  /** By id (or slug where the API accepts one). */
  get(id: string): Promise<Product>;
  update(product: Pick<Product, 'id'>, patch: ProductUpdate): Promise<Product>;
  updateVariant(product: Pick<Product, 'id'>, variantId: string, patch: VariantUpdate): Promise<Product>;
  /** Sets the on-hand count at the store's default stock location. */
  setStock(product: Pick<Product, 'id'>, variantId: string, countOnHand: number): Promise<Product>;
}

// --- Customers -----------------------------------------------------------------------------

export interface ListCustomersParams {
  /** Email or name. */
  query?: string;
  cursor?: string | null;
  perPage?: number;
}

/** `customers.read`. A customer's orders come from OrdersPort.list with their email as the query. */
export interface CustomersPort {
  list(params: ListCustomersParams): Promise<Page<Customer>>;
  get(id: string): Promise<Customer>;
}

// --- Promotions ----------------------------------------------------------------------------

export interface ListPromotionsParams {
  /** Name or code. */
  query?: string;
  filter?: PromotionListFilter;
  cursor?: string | null;
  perPage?: number;
}

export interface PromotionDiscountInput {
  type: 'percent' | 'fixed';
  /** Decimal string: a percentage (max 100) or an amount in the store's currency. */
  amount: string;
  /** For `fixed`: the store's currency (Spree 6 needs it; the gem uses the store default). */
  currency?: string | null;
}

export interface PromotionInput {
  name: string;
  description?: string | null;
  /** Coupon code; null or empty for an automatic promotion. */
  code?: string | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  usageLimit?: number | null;
  discount: PromotionDiscountInput;
}

export type PromotionUpdate = Partial<Omit<PromotionInput, 'discount'>> & {
  discount?: PromotionDiscountInput;
};

/** `promotions.read`, `promotions.write`. */
export interface PromotionsPort {
  list(params: ListPromotionsParams): Promise<Page<Promotion>>;
  get(id: string): Promise<Promotion>;
  create(input: PromotionInput): Promise<Promotion>;
  update(promotion: Pick<Promotion, 'id'>, patch: PromotionUpdate): Promise<Promotion>;
}

/** One Spree API family behind domain-typed ports. Screens and the router only see this. */
export interface SpreeAdapter {
  readonly family: ApiFamily;
  readonly orders: OrdersPort;
  readonly products: ProductsPort;
  readonly customers: CustomersPort;
  readonly promotions: PromotionsPort;
  /** Present when the store runs the spree_admin_native gem. */
  readonly companion?: CompanionPort;
}
