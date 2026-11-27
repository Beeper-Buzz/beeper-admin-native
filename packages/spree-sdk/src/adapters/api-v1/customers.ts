import type { Customer, Page } from '@instincts/spree-domain';
import { isSpreeError } from '../../errors';
import type { CustomersPort, ListCustomersParams } from '../../ports';
import type { Transport } from '../../transport';
import { mapV1User, type V1User, type V1UserList } from './mapProduct';
import { V1_NO_CACHE } from './products';

const BASE = '/api/v1/users';

/**
 * API v1 (Spree 4.2–4.3): customers are Spree users. v1 sends no order totals; `get` counts the
 * user's completed orders with one extra request, `list` leaves the count null.
 */
export function apiV1Customers(transport: Transport): CustomersPort {
  async function ordersCount(userId: string): Promise<number | null> {
    try {
      // One order per page, so the page count is the order count.
      const res = await transport.request<{ pages: number }>({
        path: '/api/v1/orders',
        query: { q: { user_id_eq: userId, completed_at_not_null: 1 }, per_page: 1 },
      });
      return res.data.pages;
    } catch (e) {
      if (isSpreeError(e) && (e.kind === 'forbidden' || e.kind === 'auth')) return null;
      throw e;
    }
  }

  return {
    async list(params: ListCustomersParams): Promise<Page<Customer>> {
      const page = params.cursor ? Number(params.cursor) || 1 : 1;
      // users#index takes no Ransack: `email_start` plus `ship_address_firstname_start` selects
      // Spree's with_email_or_address (case-sensitive LIKE on email and address names).
      const q = params.query
        ? { email_start: params.query, ship_address_firstname_start: params.query }
        : null;
      const res = await transport.request<V1UserList>({
        path: BASE,
        query: { q, page, per_page: params.perPage ?? 25 },
        headers: V1_NO_CACHE,
      });
      const { users, pages } = res.data;
      // The address join can repeat a user.
      const seen = new Set<number>();
      return {
        items: users.filter((u) => !seen.has(u.id) && seen.add(u.id)).map((u) => mapV1User(u)),
        nextCursor: page < pages ? String(page + 1) : null,
      };
    },

    async get(id: string): Promise<Customer> {
      const [user, count] = await Promise.all([
        transport.request<V1User>({ path: `${BASE}/${encodeURIComponent(id)}`, headers: V1_NO_CACHE }),
        ordersCount(id),
      ]);
      return mapV1User(user.data, { ordersCount: count });
    },
  };
}
