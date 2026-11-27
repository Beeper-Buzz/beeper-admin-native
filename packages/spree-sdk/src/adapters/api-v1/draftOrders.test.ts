import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Address } from '@instincts/spree-domain';
import { describe, expect, it } from 'vitest';
import type { CompanionPort } from '../../companion';
import { SpreeError } from '../../errors';
import type { DraftOrderInput } from '../../ports';
import { fakeTransport } from '../fakeTransport.test-helper';
import type { V1Order } from './mapOrder';
import { apiV1Orders } from './orders';

const recorded: V1Order = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../infra/spree/recordings/4.2/orders.show.json'), 'utf8'),
);

const N = 'R100200300';
/** The recorded order, reshaped as a draft at `state`. */
const draft = (state: string, over: Partial<V1Order> = {}): V1Order => ({
  ...recorded,
  number: N,
  state,
  completed_at: null,
  payment_state: null,
  shipment_state: null,
  user_id: null,
  token: 'guest-token',
  payments: [],
  ...over,
});

const address: Address = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  company: null,
  address1: '1 Main St',
  address2: null,
  city: 'Portland',
  zipcode: '97201',
  phone: '555-0100',
  stateCode: 'OR',
  stateName: null,
  countryIso: 'US',
};

const input = (over: Partial<DraftOrderInput> = {}): DraftOrderInput => ({
  customerId: '3',
  email: 'ada@example.com',
  items: [
    { variantId: '117', quantity: 2 },
    { variantId: '118', quantity: 1 },
  ],
  shipAddress: address,
  billAddress: null,
  ...over,
});

const countries = { countries: [{ id: 224, iso: 'US' }] };
const v1Address = {
  firstname: 'Ada',
  lastname: 'Lovelace',
  company: null,
  address1: '1 Main St',
  address2: null,
  city: 'Portland',
  zipcode: '97201',
  phone: '555-0100',
  country_id: 224,
  state_name: 'OR',
};

/** A store whose order walks the checkout one state per `next`. */
function store(start: V1Order, extra?: (method: string, url: string, body: unknown) => unknown) {
  const order = { ...start };
  const steps = ['cart', 'address', 'delivery', 'payment', 'complete'];
  const fake = fakeTransport((method, url, body) => {
    const own = extra?.(method, url, body);
    if (own !== undefined) return own;
    if (url.startsWith('/api/v1/countries')) return countries;
    if (method === 'POST' && url === '/api/v1/orders') return { ...order, user_id: 2 };
    if (url === `/api/v1/checkouts/${N}/next`) {
      order.state = steps[steps.indexOf(order.state) + 1] ?? order.state;
      if (order.state === 'complete') order.completed_at = '2026-11-27T10:00:00Z';
      return { ...order };
    }
    if (method === 'POST' && url === `/api/v1/orders/${N}/payments`) return { number: 'PNEW' };
    if (url === `/api/v1/orders/${N}`) return { ...order };
    if (method !== 'GET') return {};
    return undefined;
  });
  return { ...fake, order };
}

const writes = (calls: { method: string; url: string; body: unknown }[]) =>
  calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url, c.body]);

describe('apiV1Orders: order creation', () => {
  it("creates a customer's draft through the importer and walks it to delivery", async () => {
    const { transport, calls } = store(draft('cart', { user_id: 3 }));
    const order = await apiV1Orders(transport).createDraft(input());
    expect(writes(calls)).toEqual([
      [
        'POST',
        '/api/v1/orders',
        {
          order: {
            email: 'ada@example.com',
            line_items_attributes: [
              { variant_id: '117', quantity: 2 },
              { variant_id: '118', quantity: 1 },
            ],
            ship_address_attributes: v1Address,
            bill_address_attributes: v1Address,
          },
        },
      ],
      // The importer gives the order to the admin, its creator; then it goes to the customer.
      ['PUT', `/api/v1/orders/${N}`, { order: { user_id: '3' } }],
      ['PUT', `/api/v1/checkouts/${N}/next`, undefined],
      ['PUT', `/api/v1/checkouts/${N}/next`, undefined],
    ]);
    expect(order.status).toBe('draft');
    expect(order.fulfillments[0]?.rates.map((r) => [r.id, r.cost.amount, r.selected])).toEqual([
      ['265', '5.00', true],
      ['266', '10.00', false],
      ['267', '15.00', false],
    ]);
  });

  it('detaches a guest draft from the admin the importer gave it to', async () => {
    const { transport, calls } = store(draft('cart'));
    await apiV1Orders(transport).createDraft(
      input({
        customerId: null,
        billAddress: { ...address, firstName: 'Bill', stateCode: null, stateName: 'Oregon' },
      }),
    );
    const [post, detach] = writes(calls);
    expect(post?.[2]).toMatchObject({
      order: { bill_address_attributes: { firstname: 'Bill', state_name: 'Oregon' } },
    });
    expect(detach).toEqual(['PUT', `/api/v1/orders/${N}`, { order: { user_id: null } }]);
  });

  it('refuses a country the store does not have', async () => {
    const { transport } = store(draft('cart'));
    await expect(
      apiV1Orders(transport).createDraft(input({ shipAddress: { ...address, countryIso: 'ZZ' } })),
    ).rejects.toMatchObject({ kind: 'invalid', message: 'This store has no country with the code ZZ.' });
  });

  it('edits a draft: changes, removes and adds lines, then updates the customer and addresses', async () => {
    const lines = recorded.line_items ?? [];
    const [first, second, third] = lines;
    const { transport, calls } = store(draft('payment'));
    await apiV1Orders(transport).updateDraft(
      { id: '1', number: N },
      input({
        customerId: null,
        items: [
          { variantId: String(first?.variant_id), quantity: (first?.quantity ?? 0) + 1 },
          { variantId: String(second?.variant_id), quantity: second?.quantity ?? 1 },
          { variantId: '999', quantity: 4 },
        ],
      }),
    );
    expect(writes(calls)).toEqual([
      [
        'PUT',
        `/api/v1/orders/${N}/line_items/${first?.id}`,
        { line_item: { quantity: (first?.quantity ?? 0) + 1 } },
      ],
      ['DELETE', `/api/v1/orders/${N}/line_items/${third?.id}`, undefined],
      ['POST', `/api/v1/orders/${N}/line_items`, { line_item: { variant_id: '999', quantity: 4 } }],
      [
        'PUT',
        `/api/v1/orders/${N}`,
        {
          order: {
            email: 'ada@example.com',
            user_id: null,
            ship_address_attributes: v1Address,
            bill_address_attributes: v1Address,
          },
        },
      ],
    ]);
  });

  it('refuses to edit a placed order', async () => {
    const { transport } = store({ ...recorded, number: N });
    await expect(apiV1Orders(transport).updateDraft({ id: '1', number: N }, input())).rejects.toMatchObject({
      kind: 'invalid',
    });
  });

  it('chooses a rate by re-entering the delivery step', async () => {
    const { transport, calls } = store(draft('delivery'));
    await apiV1Orders(transport).selectShippingRate(
      { id: '1', number: N },
      { id: '33', number: 'H1' },
      '267',
    );
    expect(writes(calls)).toEqual([
      [
        'PUT',
        `/api/v1/checkouts/${N}`,
        {
          state: 'delivery',
          order: { shipments_attributes: [{ id: '33', selected_shipping_rate_id: '267' }] },
        },
      ],
    ]);
  });

  it('places with a manual payment for the total and captures it when paid', async () => {
    const { transport, calls } = store(draft('delivery'));
    const placed = await apiV1Orders(transport).place(
      { id: '1', number: N },
      { payment: { methodId: '3', markPaid: true } },
    );
    expect(writes(calls)).toEqual([
      ['PUT', `/api/v1/checkouts/${N}/next`, undefined],
      [
        'POST',
        `/api/v1/orders/${N}/payments`,
        { payment: { payment_method_id: '3', amount: recorded.total } },
      ],
      ['PUT', `/api/v1/checkouts/${N}/next`, undefined],
      ['PUT', `/api/v1/orders/${N}/payments/PNEW/capture`, undefined],
    ]);
    expect(placed.status).toBe('placed');
  });

  it('reuses a payment left by a failed attempt and voids one that no longer matches', async () => {
    const leftover = recorded.payments?.[0];
    if (!leftover) throw new Error('recording has a payment');
    const payments = [
      { ...leftover, number: 'PKEEP', state: 'checkout', payment_method_id: 3, amount: recorded.total },
      { ...leftover, number: 'POLD', state: 'checkout', payment_method_id: 3, amount: '1.00' },
    ];
    const { transport, calls } = store(draft('payment', { payments }));
    await apiV1Orders(transport).place(
      { id: '1', number: N },
      { payment: { methodId: '3', markPaid: false } },
    );
    expect(writes(calls)).toEqual([
      ['PUT', `/api/v1/orders/${N}/payments/POLD/void`, undefined],
      ['PUT', `/api/v1/checkouts/${N}/next`, undefined],
    ]);
  });

  it('needs a payment to place an order that has a total', async () => {
    const { transport } = store(draft('payment'));
    await expect(
      apiV1Orders(transport).place({ id: '1', number: N }, { payment: null }),
    ).rejects.toMatchObject({
      kind: 'invalid',
      message: expect.stringContaining('needs a payment'),
    });
  });

  it("explains a refused checkout step with Spree's reasons", async () => {
    const { transport } = store(draft('payment'), (_method, url) => {
      if (url === `/api/v1/checkouts/${N}/next`)
        throw new SpreeError({
          kind: 'invalid',
          status: 422,
          message: 'The order could not be transitioned. Please fix the errors and try again.',
          body: { errors: { base: ['Denim Shirt is out of stock.'] } },
        });
      return undefined;
    });
    await expect(
      apiV1Orders(transport).place({ id: '1', number: N }, { payment: { methodId: '3', markPaid: false } }),
    ).rejects.toMatchObject({ message: 'Denim Shirt is out of stock.' });
  });

  it("lists the Storefront API's Check methods for the draft's token without the gem", async () => {
    const { transport, calls } = store(draft('delivery'), (_m, url) =>
      url === '/api/v2/storefront/checkout/payment_methods'
        ? {
            data: [
              {
                id: '2',
                attributes: { type: 'Spree::Gateway::Bogus', name: 'Credit Card', description: null },
              },
              {
                id: '3',
                attributes: { type: 'Spree::PaymentMethod::Check', name: 'Check', description: '' },
              },
            ],
          }
        : undefined,
    );
    const methods = await apiV1Orders(transport).paymentMethods({ id: '1', number: N });
    expect(methods).toEqual([{ id: '3', name: 'Check', description: null }]);
    expect(calls.at(-1)?.headers).toEqual({ 'X-Spree-Order-Token': 'guest-token' });
  });

  it('asks the companion gem for payment methods and draft deletion, falling back when it is older', async () => {
    const gem = {
      manualPaymentMethods: async () => [{ id: '9', name: 'Cash', description: null }],
      discardDraft: async () => {
        throw new SpreeError({ kind: 'notFound', status: 404 });
      },
    } as unknown as CompanionPort;
    const { transport, calls } = store(draft('delivery', { user_id: 2 }));
    const orders = apiV1Orders(transport, gem);
    expect(await orders.paymentMethods({ id: '1', number: N })).toEqual([
      { id: '9', name: 'Cash', description: null },
    ]);
    await orders.discardDraft({ id: '1', number: N });
    expect(writes(calls)).toEqual([
      ['PUT', `/api/v1/orders/${N}/empty`, undefined],
      ['PUT', `/api/v1/orders/${N}`, { order: { user_id: null } }],
    ]);
  });
});
