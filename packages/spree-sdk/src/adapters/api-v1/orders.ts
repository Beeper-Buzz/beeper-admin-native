import type { Order, OrderListFilter, Page } from '@instincts/spree-domain';
import type { ListOrdersParams, OrdersPort } from '../../ports';
import type { QueryObject } from '../../query';
import type { Transport } from '../../transport';
import { mapV1Order, type V1Order } from './mapOrder';

const BASE = '/api/v1/orders';

/** Ransack `q[...]` filters for completed orders (verified live on 4.2.7; FINDINGS.md §a). */
export const V1_FILTERS: Record<OrderListFilter, QueryObject> = {
  all: { completed_at_not_null: 1 },
  unfulfilled: { state_eq: 'complete', shipment_state_in: ['pending', 'ready', 'partial', 'backorder'] },
  unpaid: { state_eq: 'complete', payment_state_in: ['balance_due', 'failed'] },
  open: { state_eq: 'complete', shipment_state_not_eq: 'shipped' },
};

interface V1List {
  orders: V1Order[];
  count: number;
  current_page: number;
  pages: number;
}

export function apiV1Orders(transport: Transport): OrdersPort {
  return {
    async list(params: ListOrdersParams): Promise<Page<Order>> {
      const q: Record<string, unknown> = { ...V1_FILTERS[params.filter], s: 'completed_at desc' };
      if (params.query) q.number_or_email_cont = params.query;
      const perPage = params.perPage ?? 25;
      const page = params.cursor ? Number(params.cursor) : 1;
      const res = await transport.request<V1List>({
        path: BASE,
        query: { q: q as QueryObject, page, per_page: perPage },
      });
      const { orders, pages } = res.data;
      const result: Page<Order> = {
        items: orders.map(mapV1Order),
        nextCursor: page < pages ? String(page + 1) : null,
      };
      // API v1 has no total; with one order per page, the page count is the total.
      if (perPage === 1) result.totalCount = pages;
      return result;
    },

    async get(idOrNumber: string): Promise<Order> {
      // v1 looks orders up by number.
      const res = await transport.request<V1Order>({ path: `${BASE}/${encodeURIComponent(idOrNumber)}` });
      return mapV1Order(res.data);
    },
  };
}
