import type { Customer, Page } from '@instincts/spree-domain';
import type { PaginatedResponse, Customer as V3Customer } from '@spree/admin-sdk';
import { isSpreeError } from '../../errors';
import type { CustomersPort, ListCustomersParams } from '../../ports';
import type { Transport } from '../../transport';
import { mapV3Customer } from './mapProduct';

const BASE = '/api/v3/admin/customers';
const EXPAND = 'default_billing_address,default_shipping_address';

/** Admin API v3 (Spree 5.4+/6): customers (`cust_…`) carry orders_count and total_spent. */
export function adminV3Customers(transport: Transport): CustomersPort {
  // total_spent is a bare decimal in the store's currency.
  let currency: Promise<string> | undefined;
  const storeCurrency = () => {
    currency ??= transport
      .request<{ default_currency?: string | null }>({ path: '/api/v3/admin/store' })
      .then(({ data }) => data.default_currency || 'USD')
      .catch((e: unknown) => {
        if (isSpreeError(e) && (e.kind === 'forbidden' || e.kind === 'notFound')) return 'USD';
        currency = undefined;
        throw e;
      });
    return currency;
  };

  return {
    async list(params: ListCustomersParams): Promise<Page<Customer>> {
      const [res, cur] = await Promise.all([
        transport.request<PaginatedResponse<V3Customer>>({
          path: BASE,
          query: {
            // `search` matches email and first/last name.
            q: params.query ? { search: params.query } : null,
            page: params.cursor ? Number(params.cursor) || 1 : 1,
            limit: params.perPage ?? 25,
            sort: '-created_at',
            expand: EXPAND,
          },
        }),
        storeCurrency(),
      ]);
      const { data, meta } = res.data;
      return {
        items: data.map((c) => mapV3Customer(c, cur)),
        nextCursor: meta.next ? String(meta.next) : null,
        totalCount: meta.count,
      };
    },

    async get(id: string) {
      const [res, cur] = await Promise.all([
        transport.request<V3Customer>({
          path: `${BASE}/${encodeURIComponent(id)}`,
          query: { expand: EXPAND },
        }),
        storeCurrency(),
      ]);
      return mapV3Customer(res.data, cur);
    },
  };
}
