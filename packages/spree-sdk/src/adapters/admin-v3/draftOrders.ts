import type { Address, Order } from '@instincts/spree-domain';
import type { PaginatedResponse } from '@spree/admin-sdk';
import { SpreeError } from '../../errors';
import type { DraftOrderInput, OrderRef, OrdersPort } from '../../ports';
import type { Transport } from '../../transport';

const BASE = '/api/v3/admin/orders';
const enc = encodeURIComponent;

export type DraftOrdersPort = Pick<
  OrdersPort,
  'createDraft' | 'updateDraft' | 'selectShippingRate' | 'paymentMethods' | 'place' | 'discardDraft'
>;

interface V3PaymentMethod {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  source_required: boolean;
  session_required: boolean;
}

interface V3Payment {
  id: string;
  number: string;
  status: string;
  payment_method_id: string;
}

function address(a: Address) {
  return {
    first_name: a.firstName,
    last_name: a.lastName,
    company: a.company,
    address1: a.address1,
    address2: a.address2,
    city: a.city,
    postal_code: a.zipcode,
    phone: a.phone,
    country_code: a.countryIso,
    ...(a.stateCode ? { state_code: a.stateCode } : a.stateName ? { state_name: a.stateName } : {}),
  };
}

function addresses(input: DraftOrderInput) {
  const shipping_address = address(input.shipAddress);
  return input.billAddress
    ? { shipping_address, billing_address: address(input.billAddress) }
    : { shipping_address, use_shipping: true };
}

/**
 * Order creation on the Admin API v3 (Spree 5.4+/6), proven in contract/order-create.contract.ts
 * and infra/spree/FINDINGS.md §i. Admin drafts are orders with `status: draft`: `POST /orders`
 * takes the customer, items and addresses and quotes delivery rates; `PATCH /orders/:id/complete`
 * places it. Payments are recorded with `payment_pending: true` and captured explicitly, so
 * "paid" doesn't depend on the payment method's capture setting.
 */
export function adminV3DraftOrders(
  transport: Transport,
  get: (id: string) => Promise<Order>,
  orderId: (order: OrderRef) => Promise<string>,
): DraftOrdersPort {
  async function currentDraft(order: OrderRef): Promise<Order> {
    const current = await get(await orderId(order));
    if (current.status !== 'draft')
      throw new SpreeError({
        kind: 'invalid',
        status: 422,
        message: `Order ${current.number} has already been placed.`,
      });
    return current;
  }
  const draftId = async (order: OrderRef) => (await currentDraft(order)).id;

  return {
    async createDraft(input) {
      const res = await transport.request<{ id: string }>({
        method: 'POST',
        path: BASE,
        body: {
          email: input.email,
          ...(input.customerId ? { customer_id: input.customerId } : {}),
          items: input.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
          ...addresses(input),
        },
      });
      return get(res.data.id);
    },

    async updateDraft(order, input) {
      const current = await currentDraft(order);
      const wanted = new Set(input.items.map((i) => i.variantId));
      // `items` upserts by variant; quantity 0 removes a line the merchant took out.
      const removed = current.lineItems
        .filter((li) => !wanted.has(li.variantId))
        .map((li) => ({ variant_id: li.variantId, quantity: 0 }));
      await transport.request({
        method: 'PATCH',
        path: `${BASE}/${enc(current.id)}`,
        body: {
          email: input.email,
          customer_id: input.customerId,
          items: [...input.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })), ...removed],
          ...addresses(input),
        },
      });
      return get(current.id);
    },

    async selectShippingRate(order, fulfillment, rateId) {
      const id = await draftId(order);
      await transport.request({
        method: 'PATCH',
        path: `${BASE}/${enc(id)}/fulfillments/${enc(fulfillment.id)}`,
        body: { selected_delivery_rate_id: rateId },
      });
      return get(id);
    },

    async paymentMethods() {
      const res = await transport.request<PaginatedResponse<V3PaymentMethod>>({
        path: '/api/v3/admin/payment_methods',
        query: { limit: 100 },
      });
      return res.data.data
        .filter((m) => m.active && !m.source_required && !m.session_required)
        .map((m) => ({ id: m.id, name: m.name, description: m.description || null }));
    },

    async place(order, input) {
      const id = await draftId(order);
      let payment: V3Payment | null = null;
      if (input.payment) {
        const { methodId } = input.payment;
        const existing = await transport.request<PaginatedResponse<V3Payment>>({
          path: `${BASE}/${enc(id)}/payments`,
          query: { limit: 100 },
        });
        // A failed earlier attempt can leave a payment behind: reuse it, or void what doesn't match.
        const open = existing.data.data.filter((p) => p.status === 'checkout');
        payment = open.find((p) => p.payment_method_id === methodId) ?? null;
        for (const p of open) {
          if (p === payment) continue;
          await transport.request({ method: 'PATCH', path: `${BASE}/${enc(id)}/payments/${enc(p.id)}/void` });
        }
        // The amount defaults to what the order still owes.
        payment ??= (
          await transport.request<V3Payment>({
            method: 'POST',
            path: `${BASE}/${enc(id)}/payments`,
            body: { payment_method_id: methodId },
          })
        ).data;
      }
      await transport.request({
        method: 'PATCH',
        path: `${BASE}/${enc(id)}/complete`,
        body: { payment_pending: true },
      });
      if (payment && input.payment?.markPaid)
        await transport.request({
          method: 'PATCH',
          path: `${BASE}/${enc(id)}/payments/${enc(payment.id)}/capture`,
        });
      return get(id);
    },

    async discardDraft(order) {
      const id = await draftId(order);
      await transport.request({ method: 'DELETE', path: `${BASE}/${enc(id)}` });
    },
  };
}
