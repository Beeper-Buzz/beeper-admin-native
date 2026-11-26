import type { Order, OrderListFilter, Page } from '@instincts/spree-domain';
import type { ApiFamily } from './capabilities/types';
import type { CompanionPort } from './companion';

export interface ListOrdersParams {
  filter: OrderListFilter;
  /** Free-text search: order number, email or name. */
  query?: string;
  cursor?: string | null;
  perPage?: number;
}

export interface OrdersPort {
  list(params: ListOrdersParams): Promise<Page<Order>>;
  /** By id or order number (`R123456789`). */
  get(idOrNumber: string): Promise<Order>;
}

/** One Spree API family behind domain-typed ports. Screens and the router only see this. */
export interface SpreeAdapter {
  readonly family: ApiFamily;
  readonly orders: OrdersPort;
  /** Present when the store runs the spree_admin_native gem. */
  readonly companion?: CompanionPort;
}
