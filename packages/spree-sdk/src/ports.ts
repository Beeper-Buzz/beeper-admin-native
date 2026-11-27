import type {
  Address,
  Customer,
  Fulfillment,
  LibraryImage,
  ManualPaymentMethod,
  Order,
  OrderListFilter,
  Page,
  Payment,
  Product,
  ProductImage,
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

export interface DraftItemInput {
  variantId: string;
  /** At least 1. */
  quantity: number;
}

/**
 * What a draft order holds. `updateDraft` replaces it whole: items left out are removed.
 * Addresses use the domain shape; `stateCode` is the state's abbreviation (`OR`).
 */
export interface DraftOrderInput {
  /** An existing customer, or null for a guest order under `email`. */
  customerId: string | null;
  email: string;
  items: DraftItemInput[];
  shipAddress: Address;
  /** null bills the shipping address. */
  billAddress: Address | null;
}

export interface PlaceOrderInput {
  /**
   * A manual payment method from `paymentMethods`, for the order total. `markPaid` captures it
   * (the money is in hand); otherwise it stays pending and the order shows a balance due.
   * null places the order with no payment recorded, which only Spree 5.4+ allows.
   */
  payment: { methodId: string; markPaid: boolean } | null;
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

  // Creating an order (`orders.create`): a draft on the server, then placed.
  /** Returns the draft with its shipments' rates once the address allows quoting them. */
  createDraft(input: DraftOrderInput): Promise<Order>;
  updateDraft(order: OrderRef, input: DraftOrderInput): Promise<Order>;
  selectShippingRate(order: OrderRef, fulfillment: FulfillmentRef, rateId: string): Promise<Order>;
  /** Payment methods that need no card details, for this draft. */
  paymentMethods(order: OrderRef): Promise<ManualPaymentMethod[]>;
  /** Completes the draft; the order is then `placed`. */
  place(order: OrderRef, input: PlaceOrderInput): Promise<Order>;
  /** Abandons a draft. Placed orders are canceled instead, never discarded. */
  discardDraft(order: OrderRef): Promise<void>;
}

// --- Products ------------------------------------------------------------------------------

export type ProductStatusFilter = 'all' | 'active' | 'draft' | 'archived';

export interface ListProductsParams {
  /** Name or SKU. */
  query?: string;
  status?: ProductStatusFilter;
  /**
   * Only products with sellable, tracked variants at or under the low-stock threshold, lowest
   * stock first (`inventory.lowStock`). Ignores `status` and `query`.
   */
  lowStock?: boolean;
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

// --- Media ---------------------------------------------------------------------------------

/**
 * A picked photo. In React Native, `uri` is a local file (`file://…`) that fetch uploads from;
 * elsewhere (Node, tests) pass its bytes as `blob`. `type` must be an image type the store
 * accepts: Spree 4.2 takes JPEG, PNG and GIF only.
 */
export type MediaFile = { name: string; type: string } & ({ uri: string } | { blob: Blob });

export interface MediaUploadInput {
  file: MediaFile;
  alt?: string | null;
  /** Show it for these variants only; empty or absent shows it for every variant. */
  variantIds?: string[];
}

export interface MediaUpdate {
  /** Empty or null clears it. */
  alt?: string | null;
  /** Empty shows it for every variant. Spree 4.x takes at most one. */
  variantIds?: string[];
}

export interface ListLibraryParams {
  /** Product name (or SKU where the store can search it). */
  query?: string;
  /** Only images without alt text. */
  missingAlt?: boolean;
  cursor?: string | null;
  perPage?: number;
}

/**
 * `products.media`: a product's gallery. Every write returns the gallery as it now is, in display
 * order. `media.library`: every product image in the store.
 */
export interface MediaPort {
  list(product: Pick<Product, 'id'>): Promise<ProductImage[]>;
  upload(product: Pick<Product, 'id'>, input: MediaUploadInput): Promise<ProductImage[]>;
  update(product: Pick<Product, 'id'>, imageId: string, patch: MediaUpdate): Promise<ProductImage[]>;
  /** Moves an image to `toIndex` (0 = the main image) of the gallery as `list` orders it. */
  move(product: Pick<Product, 'id'>, imageId: string, toIndex: number): Promise<ProductImage[]>;
  remove(product: Pick<Product, 'id'>, imageId: string): Promise<ProductImage[]>;
  library(params: ListLibraryParams): Promise<Page<LibraryImage>>;
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
  readonly media: MediaPort;
  /** Present when the store runs the spree_admin_native gem. */
  readonly companion?: CompanionPort;
}
