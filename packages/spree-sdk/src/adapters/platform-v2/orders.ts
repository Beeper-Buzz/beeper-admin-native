import type { Order, OrderListFilter, Page } from '@instincts/spree-domain';
import { SpreeError, unsupported } from '../../errors';
import type { ListOrdersParams, OrdersPort } from '../../ports';
import type { QueryObject } from '../../query';
import type { Transport } from '../../transport';
import type { Document } from '../jsonapi';
import { unsupportedOrderCreation } from '../unsupported';
import { mapOrderDocument } from './mapOrder';

const BASE = '/api/v2/platform/orders';
export const V2_INCLUDE = [
  'line_items',
  'line_items.variant',
  'line_items.variant.product',
  'shipments',
  'shipments.stock_location',
  'shipments.shipping_rates',
  'shipments.inventory_units',
  'payments',
  'payments.payment_method',
  'payments.source',
  'bill_address',
  'ship_address',
  'user',
].join(',');

/** Ransack filters (`filter[...]`) for completed orders. */
export const V2_FILTERS: Record<OrderListFilter, QueryObject> = {
  all: { completed_at_not_null: 1 },
  unfulfilled: {
    completed_at_not_null: 1,
    state_eq: 'complete',
    shipment_state_in: ['pending', 'ready', 'partial', 'backorder'],
  },
  unpaid: { completed_at_not_null: 1, state_eq: 'complete', payment_state_in: ['balance_due', 'failed'] },
  open: { completed_at_not_null: 1, state_eq: 'complete', shipment_state_not_eq: 'shipped' },
};

export function platformV2Orders(transport: Transport): OrdersPort {
  return {
    async list(params: ListOrdersParams): Promise<Page<Order>> {
      const filter: Record<string, unknown> = { ...V2_FILTERS[params.filter] };
      if (params.query) filter.number_or_email_cont = params.query;
      const page = params.cursor ? Number(params.cursor) : 1;
      const res = await transport.request<Document>({
        path: BASE,
        query: {
          filter: filter as QueryObject,
          page,
          per_page: params.perPage ?? 25,
          sort: '-completed_at',
          include: V2_INCLUDE,
        },
      });
      const doc = res.data;
      const totalPages = doc.meta?.total_pages ?? 1;
      const result: Page<Order> = {
        items: mapOrderDocument(doc),
        nextCursor: page < totalPages ? String(page + 1) : null,
      };
      if (doc.meta?.total_count !== undefined) result.totalCount = doc.meta.total_count;
      return result;
    },

    async get(idOrNumber: string): Promise<Order> {
      // Platform v2 looks orders up by id; find by number through the list filter.
      if (/^[A-Z]/.test(idOrNumber)) {
        const res = await transport.request<Document>({
          path: BASE,
          query: { filter: { number_eq: idOrNumber }, include: V2_INCLUDE, per_page: 1 },
        });
        const [order] = mapOrderDocument(res.data);
        if (!order)
          throw new SpreeError({ kind: 'notFound', status: 404, message: `Order ${idOrNumber} not found.` });
        return order;
      }
      const res = await transport.request<Document>({
        path: `${BASE}/${encodeURIComponent(idOrNumber)}`,
        query: { include: V2_INCLUDE },
      });
      const [order] = mapOrderDocument(res.data);
      if (!order) throw new SpreeError({ kind: 'notFound', status: 404 });
      return order;
    },

    // Platform API v2 (Spree 4.4–5.x) has routes for these, but no store in the contract suite
    // proves them yet (FINDINGS.md); refuse rather than guess.
    async ship() {
      throw unsupported('shipments.ship');
    },
    async capture() {
      throw unsupported('orders.capture');
    },
    async cancel() {
      throw unsupported('orders.cancel');
    },
    async refund() {
      throw unsupported('orders.refund');
    },
    async refundReasons() {
      throw unsupported('orders.refund');
    },
    ...unsupportedOrderCreation,
  };
}
