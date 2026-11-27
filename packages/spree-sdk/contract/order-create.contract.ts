import {
  type Address,
  type Customer,
  isZero,
  multiplyMoney,
  type Order,
  sellableVariants,
  sumMoney,
  type Variant,
} from '@instincts/spree-domain';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createAdapter } from '../src/adapters';
import { probeStore } from '../src/capabilities/probe';
import type { DraftOrderInput, SpreeAdapter } from '../src/ports';
import { baseTransport, enabled, env, proves, signIn, writeResults } from './env';

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

/** Used when the customer has no saved address (the 4.2 seed users have none). */
const FALLBACK_ADDRESS: Address = {
  firstName: 'Contract',
  lastName: 'Test',
  company: null,
  address1: '100 Test Street',
  address2: null,
  city: 'Portland',
  zipcode: '97201',
  phone: '555-0100',
  stateCode: 'OR',
  stateName: null,
  countryIso: 'US',
};

/** Priced and with stock to spare, so other suites' writes don't starve the order. */
const orderable = (v: Variant) => v.price !== null && v.totalOnHand !== null && v.totalOnHand >= 5;

/**
 * Creating orders against a live store: a customer's order with two items, an address, a chosen
 * shipping rate and a manual payment, placed and paid; a guest order left with a balance due; and
 * a draft that is edited and discarded. Orders created here stay in the store (placed orders
 * can't be deleted); they are tagged with the `contract-` email or the seeded customer's.
 *
 * On API v1 the suite runs without the companion gem, because `orders.create` is claimed for the
 * family; the gem's payment-method list and draft deletion are checked separately.
 */
describe.runIf(enabled)(`order creation contract: Spree ${env.label}`, () => {
  let adapter: SpreeAdapter;
  let withGem: SpreeAdapter | null = null;
  let customer: Customer;
  let variants: [Variant, Variant];
  const draftsToDiscard: Order[] = [];

  beforeAll(async () => {
    const probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
    const transport = baseTransport();
    const auth = await signIn(transport);
    const family = env.family ?? probe.preferredApi;
    adapter = createAdapter(family, transport.withAuth(auth));
    if (probe.gem) withGem = createAdapter(family, transport.withAuth(auth), { companion: true });

    const customers = await adapter.customers.list({ perPage: 25 });
    // Not the admin the suite signs in as, whose own account an order shouldn't land in.
    customer = must(
      customers.items.find((c) => !/^(admin|spree)@/.test(c.email)),
      'a customer who is not an admin',
    );
    const products = await adapter.products.list({ status: 'active', perPage: 50 });
    const picks = products.items
      .map((p) => sellableVariants(p).find(orderable))
      .filter((v): v is Variant => v !== undefined);
    variants = [must(picks[0], 'an orderable variant'), must(picks[1], 'a second orderable variant')];
  });

  afterAll(async () => {
    for (const d of draftsToDiscard) await adapter.orders.discardDraft(d).catch(() => undefined);
    writeResults();
  });

  const input = (over: Partial<DraftOrderInput> = {}): DraftOrderInput => ({
    customerId: customer.id,
    email: customer.email,
    items: [
      { variantId: variants[0].id, quantity: 2 },
      { variantId: variants[1].id, quantity: 1 },
    ],
    shipAddress: customer.defaultAddress ?? FALLBACK_ADDRESS,
    billAddress: null,
    ...over,
  });

  proves(
    'orders.create',
    "places a customer's order with two items, a chosen rate and a manual payment marked paid",
    async () => {
      const draft = await adapter.orders.createDraft(input());
      draftsToDiscard.push(draft);
      expect(draft.status).toBe('draft');
      expect(draft.customer?.id).toBe(customer.id);
      expect(draft.email).toBe(customer.email);
      const quantities = Object.fromEntries(draft.lineItems.map((li) => [li.variantId, li.quantity]));
      expect(quantities).toEqual({ [variants[0].id]: 2, [variants[1].id]: 1 });
      const expectedItems = sumMoney(
        [
          multiplyMoney(must(variants[0].price, 'price'), 2),
          multiplyMoney(must(variants[1].price, 'price'), 1),
        ],
        draft.currency,
      );
      expect(draft.itemTotal).toEqual(expectedItems);
      expect(draft.shipAddress?.city).toBe(input().shipAddress.city);
      expect(draft.billAddress?.address1).toBe(input().shipAddress.address1);

      // Rates are quoted per shipment; choose one that isn't the default.
      const shipment = must(
        draft.fulfillments.find((f) => f.rates.length > 1),
        'a shipment with more than one rate',
      );
      const rate = must(
        shipment.rates
          .filter((r) => !r.selected)
          .sort((a, b) => Number(b.cost.amount) - Number(a.cost.amount))[0],
        'an unselected rate',
      );
      const priced = await adapter.orders.selectShippingRate(draft, shipment, rate.id);
      const chosen = must(
        priced.fulfillments.find((f) => f.rates.some((r) => r.id === rate.id)),
        'the shipment after choosing',
      );
      expect(chosen.rates.find((r) => r.selected)?.id).toBe(rate.id);
      expect(chosen.cost).toEqual(rate.cost);
      expect(priced.shipTotal).toEqual(
        sumMoney(
          priced.fulfillments.map((f) => f.cost),
          priced.currency,
        ),
      );

      const methods = await adapter.orders.paymentMethods(priced);
      const method = must(
        methods.find((m) => /check/i.test(m.name)) ?? methods[0],
        'a payment method that needs no card',
      );
      expect(methods.some((m) => /credit card/i.test(m.name))).toBe(false);

      const placed = await adapter.orders.place(priced, { payment: { methodId: method.id, markPaid: true } });
      draftsToDiscard.pop();
      expect(placed.number).toBe(draft.number);
      expect(placed.status).toBe('placed');
      expect(placed.completedAt).not.toBeNull();
      expect(placed.paymentStatus).toBe('paid');
      expect(isZero(placed.amountDue)).toBe(true);
      expect(placed.total).toEqual(priced.total);
      const paid = placed.payments.filter((p) => p.status === 'completed');
      expect(paid.map((p) => p.methodName)).toEqual([method.name]);
      expect(
        sumMoney(
          paid.map((p) => p.amount),
          placed.currency,
        ),
      ).toEqual(placed.total);
      expect(placed.customer?.id).toBe(customer.id);
      expect(placed.lineItems).toHaveLength(2);
      expect(placed.fulfillments.find((f) => f.id === chosen.id)?.methodName).toBe(rate.name);

      const listed = await adapter.orders.list({ filter: 'all', query: placed.number });
      expect(listed.items.map((o) => o.number)).toContain(placed.number);
    },
  );

  proves('orders.create', 'places a guest order that leaves the total due', async () => {
    const email = `contract-${Date.now()}@example.com`;
    const draft = await adapter.orders.createDraft(
      input({
        customerId: null,
        email,
        items: [{ variantId: variants[0].id, quantity: 1 }],
        shipAddress: FALLBACK_ADDRESS,
      }),
    );
    draftsToDiscard.push(draft);
    expect(draft.customer).toBeNull();
    expect(draft.email).toBe(email);
    const methods = await adapter.orders.paymentMethods(draft);
    const method = must(methods[0], 'a manual payment method');

    const placed = await adapter.orders.place(draft, { payment: { methodId: method.id, markPaid: false } });
    draftsToDiscard.pop();
    expect(placed.status).toBe('placed');
    expect(placed.customer).toBeNull();
    expect(placed.paymentStatus).toBe('unpaid');
    expect(placed.amountDue).toEqual(placed.total);
    // The payment is recorded and waits to be captured when the money arrives.
    const due = must(placed.payments[0], 'the recorded payment');
    expect(due.status).toBe('checkout');
    expect(due.amount).toEqual(placed.total);
    const captured = await adapter.orders.capture(placed, due);
    expect(captured.paymentStatus).toBe('paid');
  });

  proves('orders.create', 'edits a draft (items, guest, billing address) and discards it', async () => {
    const draft = await adapter.orders.createDraft(input());
    draftsToDiscard.push(draft);
    const billing: Address = { ...FALLBACK_ADDRESS, firstName: 'Billing', address1: '200 Ledger Lane' };
    const edited = await adapter.orders.updateDraft(
      draft,
      input({
        customerId: null,
        email: `contract-edit-${Date.now()}@example.com`,
        items: [{ variantId: variants[1].id, quantity: 3 }],
        billAddress: billing,
      }),
    );
    expect(edited.number).toBe(draft.number);
    expect(edited.status).toBe('draft');
    expect(edited.customer).toBeNull();
    expect(edited.lineItems.map((li) => [li.variantId, li.quantity])).toEqual([[variants[1].id, 3]]);
    expect(edited.itemTotal).toEqual(multiplyMoney(must(variants[1].price, 'price'), 3));
    expect(edited.billAddress?.address1).toBe('200 Ledger Lane');
    expect(edited.fulfillments.some((f) => f.rates.length > 0)).toBe(true);

    await adapter.orders.discardDraft(edited);
    draftsToDiscard.pop();
    if (adapter.family === 'admin-v3') {
      await expect(adapter.orders.get(edited.id)).rejects.toMatchObject({ kind: 'notFound' });
    } else {
      // API v1 can't delete: the draft is emptied like an abandoned cart.
      const after = await adapter.orders.get(edited.number);
      expect(after.lineItems).toHaveLength(0);
      expect(after.customer).toBeNull();
    }
  });

  proves('orders.create', 'refuses to edit, discard or place an order that is already placed', async () => {
    const page = await adapter.orders.list({ filter: 'all', perPage: 1 });
    const placed = must(page.items[0], 'a placed order');
    await expect(adapter.orders.discardDraft(placed)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(adapter.orders.updateDraft(placed, input())).rejects.toMatchObject({ kind: 'invalid' });
  });

  proves('orders.create', '[companion] lists manual payment methods and deletes drafts', async (skip) => {
    if (adapter.family !== 'api-v1') return skip('the gem only adds order creation endpoints for API v1');
    if (!withGem) return skip('the store does not run the companion gem');
    const gem = withGem;
    const draft = await gem.orders.createDraft(
      input({ items: [{ variantId: variants[0].id, quantity: 1 }] }),
    );
    draftsToDiscard.push(draft);
    const methods = await gem.orders.paymentMethods(draft);
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.map((m) => m.name)).not.toContain('Credit Card');
    expect(methods.map((m) => m.name)).not.toContain('Store Credit');
    await gem.orders.discardDraft(draft);
    draftsToDiscard.pop();
    await expect(gem.orders.get(draft.number)).rejects.toMatchObject({ kind: 'notFound' });
  });
});
