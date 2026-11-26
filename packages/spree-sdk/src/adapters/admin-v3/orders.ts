import type { OrderListFilter, Page } from '@instincts/spree-domain';
import type { PaginatedResponse, Order as V3Order } from '@spree/admin-sdk';
import { SpreeError } from '../../errors';
import type { ListOrdersParams, OrdersPort } from '../../ports';
import type { QueryObject } from '../../query';
import type { Transport } from '../../transport';
import { mapOrder } from './mapOrder';

const BASE = '/api/v3/admin/orders';
const EXPAND =
  'items,fulfillments,fulfillments.delivery_method,fulfillments.stock_location,payments,payments.payment_method,billing_address,shipping_address,customer';

/** List filters as Ransack `q[...]`. Only placed (complete) orders, newest first. */
export const V3_FILTERS: Record<OrderListFilter, QueryObject> = {
  all: { complete: true },
  unfulfilled: {
    complete: true,
    status_eq: 'placed',
    fulfillment_status_in: ['unfulfilled', 'partial', 'backorder', 'pending', 'ready'],
  },
  unpaid: {
    complete: true,
    status_eq: 'placed',
    payment_status_in: ['none', 'authorized', 'partially_paid'],
  },
  open: {
    complete: true,
    status_eq: 'placed',
    fulfillment_status_not_in: ['fulfilled', 'delivered', 'shipped', 'canceled'],
  },
};

export function adminV3Orders(transport: Transport): OrdersPort {
  return {
    async list(params: ListOrdersParams): Promise<Page<ReturnType<typeof mapOrder>>> {
      const q: Record<string, unknown> = { ...V3_FILTERS[params.filter] };
      if (params.query) q.search = params.query;
      const res = await transport.request<PaginatedResponse<V3Order>>({
        path: BASE,
        query: {
          q: q as QueryObject,
          page: params.cursor ? Number(params.cursor) : 1,
          limit: params.perPage ?? 25,
          sort: '-completed_at',
          expand: EXPAND,
        },
      });
      const { data, meta } = res.data;
      return {
        items: data.map(mapOrder),
        nextCursor: meta.next ? String(meta.next) : null,
        totalCount: meta.count,
      };
    },

    async get(idOrNumber: string) {
      // Spree 6 finds orders by prefixed id (`or_…`) only; look order numbers up through the list filter.
      if (!idOrNumber.includes('_')) {
        const res = await transport.request<PaginatedResponse<V3Order>>({
          path: BASE,
          query: { q: { number_eq: idOrNumber }, limit: 1, expand: EXPAND },
        });
        const [order] = res.data.data;
        if (!order)
          throw new SpreeError({ kind: 'notFound', status: 404, message: `Order ${idOrNumber} not found.` });
        return mapOrder(order);
      }
      const res = await transport.request<V3Order>({
        path: `${BASE}/${encodeURIComponent(idOrNumber)}`,
        query: { expand: EXPAND },
      });
      return mapOrder(res.data);
    },
  };
}
