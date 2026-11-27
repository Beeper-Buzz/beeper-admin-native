import { type Address, type ManualPaymentMethod, money, type Order } from '@instincts/spree-domain';
import type { CompanionPort } from '../../companion';
import { isSpreeError, SpreeError } from '../../errors';
import type { DraftOrderInput, OrdersPort } from '../../ports';
import type { Transport } from '../../transport';
import { mapV1Order, type V1Order } from './mapOrder';

const ORDERS = '/api/v1/orders';
const CHECKOUTS = '/api/v1/checkouts';
const enc = encodeURIComponent;
/** Checkout states before Spree has quoted shipping rates. */
const BEFORE_DELIVERY = new Set(['cart', 'address']);
/** cart → address → delivery → payment → confirm → complete, with room to spare. */
const MAX_STEPS = 6;

export type DraftOrdersPort = Pick<
  OrdersPort,
  'createDraft' | 'updateDraft' | 'selectShippingRate' | 'paymentMethods' | 'place' | 'discardDraft'
>;

const invalid = (message: string) => new SpreeError({ kind: 'invalid', status: 422, message });

/**
 * A refused checkout step answers `{ error: "…could not be transitioned…", errors: { base: [...] } }`;
 * the reason is in `errors`.
 */
function explain(e: unknown): unknown {
  if (!isSpreeError(e) || e.kind !== 'invalid' || !e.body || typeof e.body !== 'object') return e;
  const errors = (e.body as { errors?: Record<string, unknown> }).errors;
  if (!errors || typeof errors !== 'object') return e;
  const messages = Object.values(errors)
    .flat()
    .filter((m): m is string => typeof m === 'string');
  if (messages.length === 0) return e;
  return new SpreeError({ kind: 'invalid', status: e.status, body: e.body, message: messages.join(' ') });
}

/**
 * Order creation on API v1 (Spree 4.2–4.3), proven in packages/spree-sdk/contract/order-create.contract.ts
 * and infra/spree/FINDINGS.md §i:
 * - `POST /orders` as an admin runs Spree's order importer (line items, addresses). It gives the
 *   order to the API user (the admin), who stays its creator; `PUT /orders/:number` with `user_id`
 *   then hands it to the customer, or detaches it for a guest.
 * - `PUT /checkouts/:number/next` walks cart → address → delivery, where shipments carry rates.
 * - A rate is chosen through `PUT /checkouts/:number` with `state: delivery`, which re-runs the
 *   delivery → payment transition so shipping promotions and totals are recalculated.
 * - Placing adds a payment, then `next` completes the order; `markPaid` captures the payment.
 */
export function apiV1DraftOrders(transport: Transport, companion?: CompanionPort): DraftOrdersPort {
  let countries: Promise<Map<string, number>> | undefined;
  async function countryId(iso: string): Promise<number> {
    // Address writes take country_id; the importer's `country: {iso}` only works on create.
    countries ??= transport
      .request<{ countries: { id: number; iso: string }[] }>({
        path: '/api/v1/countries',
        query: { per_page: 500 },
      })
      .then(({ data }) => new Map(data.countries.map((c) => [c.iso.toUpperCase(), c.id])))
      .catch((e: unknown) => {
        countries = undefined;
        throw e;
      });
    const id = (await countries).get(iso.toUpperCase());
    if (id === undefined) throw invalid(`This store has no country with the code ${iso}.`);
    return id;
  }

  async function address(a: Address) {
    return {
      firstname: a.firstName,
      lastname: a.lastName,
      company: a.company,
      address1: a.address1,
      address2: a.address2,
      city: a.city,
      zipcode: a.zipcode,
      phone: a.phone,
      country_id: await countryId(a.countryIso),
      // Spree matches state_name against the country's states by name or abbreviation.
      state_name: a.stateCode ?? a.stateName,
    };
  }

  async function addresses(input: DraftOrderInput) {
    const ship = await address(input.shipAddress);
    return {
      ship_address_attributes: ship,
      bill_address_attributes: input.billAddress ? await address(input.billAddress) : ship,
    };
  }

  async function raw(number: string): Promise<V1Order> {
    return (await transport.request<V1Order>({ path: `${ORDERS}/${enc(number)}` })).data;
  }

  async function step(number: string): Promise<V1Order> {
    try {
      return (await transport.request<V1Order>({ method: 'PUT', path: `${CHECKOUTS}/${enc(number)}/next` }))
        .data;
    } catch (e) {
      throw explain(e);
    }
  }

  /** Walk the checkout until shipments have rates (or as far as the order goes). */
  async function toDelivery(order: V1Order): Promise<V1Order> {
    let o = order;
    for (let i = 0; i < MAX_STEPS && BEFORE_DELIVERY.has(o.state); i++) o = await step(o.number);
    return o;
  }

  async function draft(number: string): Promise<V1Order> {
    const o = await raw(number);
    if (o.completed_at) throw invalid(`Order ${number} has already been placed.`);
    return o;
  }

  const read = async (number: string): Promise<Order> => mapV1Order(await raw(number));

  return {
    async createDraft(input) {
      // No user_id here: the importer would make the customer the order's creator. Created by the
      // API user (the admin), the order is then handed to the customer, or detached for a guest.
      const body = {
        email: input.email,
        line_items_attributes: input.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
        ...(await addresses(input)),
      };
      const created = (
        await transport.request<V1Order>({ method: 'POST', path: ORDERS, body: { order: body } })
      ).data;
      const o = (
        await transport.request<V1Order>({
          method: 'PUT',
          path: `${ORDERS}/${enc(created.number)}`,
          body: { order: { user_id: input.customerId } },
        })
      ).data;
      await toDelivery(o);
      return read(o.number);
    },

    async updateDraft(order, input) {
      const o = await draft(order.number);
      const path = `${ORDERS}/${enc(o.number)}/line_items`;
      const wanted = new Map(input.items.map((i) => [i.variantId, i.quantity]));
      for (const li of o.line_items ?? []) {
        const quantity = wanted.get(String(li.variant_id));
        wanted.delete(String(li.variant_id));
        if (quantity === undefined) await transport.request({ method: 'DELETE', path: `${path}/${li.id}` });
        else if (quantity !== li.quantity)
          await transport.request({
            method: 'PUT',
            path: `${path}/${li.id}`,
            body: { line_item: { quantity } },
          });
      }
      for (const [variantId, quantity] of wanted)
        await transport.request({
          method: 'POST',
          path,
          body: { line_item: { variant_id: variantId, quantity } },
        });

      // Cart::Update restarts the checkout when shipments exist, so rates are quoted again.
      const updated = (
        await transport.request<V1Order>({
          method: 'PUT',
          path: `${ORDERS}/${enc(o.number)}`,
          body: {
            order: { email: input.email, user_id: input.customerId ?? null, ...(await addresses(input)) },
          },
        })
      ).data;
      await toDelivery(updated);
      return read(o.number);
    },

    async selectShippingRate(order, fulfillment, rateId) {
      await toDelivery(await draft(order.number));
      try {
        // `state: delivery` re-enters the delivery step, so leaving it recalculates shipping
        // promotions and totals (a plain shipments#update leaves a stale free-shipping credit).
        await transport.request({
          method: 'PUT',
          path: `${CHECKOUTS}/${enc(order.number)}`,
          body: {
            state: 'delivery',
            order: {
              shipments_attributes: [{ id: fulfillment.id, selected_shipping_rate_id: rateId }],
            },
          },
        });
      } catch (e) {
        throw explain(e);
      }
      return read(order.number);
    },

    async paymentMethods(order) {
      if (companion) {
        try {
          return await companion.manualPaymentMethods();
        } catch (e) {
          // Gem 0.2 and older don't have the endpoint.
          if (!isSpreeError(e) || e.kind !== 'notFound') throw e;
        }
      }
      return storefrontCheckMethods(transport, await raw(order.number));
    },

    async place(order, input) {
      let o = await toDelivery(await draft(order.number));
      if (o.state === 'delivery') o = await step(o.number);
      let paymentNumber: string | null = null;
      if (o.state === 'payment') {
        if (!input.payment)
          throw invalid('Spree 4 needs a payment to place an order. Choose how the customer pays.');
        const { methodId } = input.payment;
        const total = money(o.total, o.currency).amount;
        // A failed earlier attempt can leave a payment behind: reuse it, or void what doesn't match.
        const open = (o.payments ?? []).filter((p) => p.state === 'checkout');
        const reuse = open.find(
          (p) => String(p.payment_method_id) === methodId && money(p.amount, o.currency).amount === total,
        );
        for (const p of open) {
          if (p === reuse) continue;
          await transport.request({
            method: 'PUT',
            path: `${ORDERS}/${enc(o.number)}/payments/${enc(p.number)}/void`,
          });
        }
        paymentNumber =
          reuse?.number ??
          (
            await transport.request<{ number: string }>({
              method: 'POST',
              path: `${ORDERS}/${enc(o.number)}/payments`,
              body: { payment: { payment_method_id: methodId, amount: o.total } },
            })
          ).data.number;
      }
      for (let i = 0; i < MAX_STEPS && o.state !== 'complete'; i++) o = await step(o.number);
      if (o.state !== 'complete') throw invalid(`Spree stopped at the ${o.state} step.`);
      // Source-less payments (Check) stay in `checkout` after completion until captured.
      if (paymentNumber && input.payment?.markPaid)
        await transport.request({
          method: 'PUT',
          path: `${ORDERS}/${enc(o.number)}/payments/${enc(paymentNumber)}/capture`,
        });
      return read(o.number);
    },

    async discardDraft(order) {
      const o = await draft(order.number);
      if (companion) {
        try {
          await companion.discardDraft(o.number);
          return;
        } catch (e) {
          // Gem 0.2: Spree 4 redirects unknown /api paths to /api/v1/…json, so a DELETE there
          // ends in a redirect loop (network) rather than a 404.
          if (!isSpreeError(e) || (e.kind !== 'notFound' && e.kind !== 'network')) throw e;
        }
      }
      // API v1 can't delete an order: empty it and detach it from any account, like an abandoned cart.
      await transport.request({ method: 'PUT', path: `${ORDERS}/${enc(o.number)}/empty` });
      if (o.user_id !== null)
        await transport.request({
          method: 'PUT',
          path: `${ORDERS}/${enc(o.number)}`,
          body: { order: { user_id: null } },
        });
    },
  };
}

interface StorefrontPaymentMethods {
  data: { id: string; attributes: { type: string; name: string; description: string | null } }[];
}

/**
 * Without the gem, API v1 lists payment methods by name only. The Storefront API v2 names their
 * type for the order's guest token; Check is the only built-in type that needs no source.
 * Methods shown in the back office only don't appear there.
 */
async function storefrontCheckMethods(transport: Transport, order: V1Order): Promise<ManualPaymentMethod[]> {
  if (!order.token) return [];
  const res = await transport.request<StorefrontPaymentMethods>({
    path: '/api/v2/storefront/checkout/payment_methods',
    auth: 'none',
    headers: { 'X-Spree-Order-Token': order.token },
  });
  return res.data.data
    .filter((m) => m.attributes.type === 'Spree::PaymentMethod::Check')
    .map((m) => ({ id: m.id, name: m.attributes.name, description: m.attributes.description || null }));
}
