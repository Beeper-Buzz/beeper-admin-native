import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Address } from '@instincts/spree-domain';
import { describe, expect, it } from 'vitest';
import type { DraftOrderInput } from '../../ports';
import { fakeTransport } from '../fakeTransport.test-helper';
import { adminV3Orders } from './orders';

const recorded = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../infra/spree/recordings/6.0/orders.show.json'), 'utf8'),
);
const ID = 'or_draft1';
const rates = [
  { id: 'dr_std', name: 'Standard', cost: '5.00', selected: true },
  { id: 'dr_exp', name: 'Express', cost: '15.00', selected: false },
];
const draft = {
  ...recorded,
  id: ID,
  number: 'R2001',
  status: 'draft',
  completed_at: null,
  payments: [],
  fulfillments: recorded.fulfillments.map((f: object) => ({ ...f, delivery_rates: rates })),
};

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
const v3Address = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  company: null,
  address1: '1 Main St',
  address2: null,
  city: 'Portland',
  postal_code: '97201',
  phone: '555-0100',
  country_code: 'US',
  state_code: 'OR',
};
const input = (over: Partial<DraftOrderInput> = {}): DraftOrderInput => ({
  customerId: 'cust_1',
  email: 'ada@example.com',
  items: [{ variantId: 'variant_a', quantity: 2 }],
  shipAddress: address,
  billAddress: null,
  ...over,
});

function store(order: object = draft, payments: object[] = []) {
  return fakeTransport((method, url) => {
    if (method === 'POST' && url === '/api/v3/admin/orders') return { id: ID };
    if (url.startsWith(`/api/v3/admin/orders/${ID}/payments?`)) return { data: payments, meta: {} };
    if (method === 'POST' && url === `/api/v3/admin/orders/${ID}/payments`)
      return { id: 'py_new', number: 'R2001-P1', status: 'checkout', payment_method_id: 'pm_check' };
    if (url.startsWith(`/api/v3/admin/orders/${ID}?`)) return order;
    if (url.startsWith('/api/v3/admin/payment_methods'))
      return {
        data: [
          {
            id: 'pm_sc',
            name: 'Store Credit',
            description: null,
            active: true,
            source_required: true,
            session_required: false,
          },
          {
            id: 'pm_card',
            name: 'Credit Card',
            description: null,
            active: true,
            source_required: true,
            session_required: true,
          },
          {
            id: 'pm_check',
            name: 'Check',
            description: 'Pay by check.',
            active: true,
            source_required: false,
            session_required: false,
          },
          {
            id: 'pm_old',
            name: 'Old cash',
            description: null,
            active: false,
            source_required: false,
            session_required: false,
          },
        ],
        meta: {},
      };
    if (method !== 'GET') return {};
    return undefined;
  });
}

const writes = (calls: { method: string; url: string; body: unknown }[]) =>
  calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url, c.body]);

describe('adminV3Orders: order creation', () => {
  it('creates a draft with items and the shipping address as billing, and reads its delivery rates', async () => {
    const { transport, calls } = store();
    const order = await adminV3Orders(transport).createDraft(input());
    expect(writes(calls)).toEqual([
      [
        'POST',
        '/api/v3/admin/orders',
        {
          email: 'ada@example.com',
          customer_id: 'cust_1',
          items: [{ variant_id: 'variant_a', quantity: 2 }],
          shipping_address: v3Address,
          use_shipping: true,
        },
      ],
    ]);
    expect(calls.at(-1)?.url).toContain('fulfillments.delivery_rates');
    expect(order.status).toBe('draft');
    expect(order.fulfillments[0]?.rates).toEqual([
      { id: 'dr_std', name: 'Standard', cost: { amount: '5.00', currency: 'USD' }, selected: true },
      { id: 'dr_exp', name: 'Express', cost: { amount: '15.00', currency: 'USD' }, selected: false },
    ]);
  });

  it('replaces a draft: removed lines go to quantity 0, a guest detaches the customer', async () => {
    const { transport, calls } = store();
    const kept = draft.items[0];
    await adminV3Orders(transport).updateDraft(
      { id: ID, number: 'R2001' },
      input({
        customerId: null,
        items: [{ variantId: kept.variant_id, quantity: 5 }],
        billAddress: { ...address, stateCode: null, stateName: 'Oregon' },
      }),
    );
    const [patch] = writes(calls);
    expect(patch?.[1]).toBe(`/api/v3/admin/orders/${ID}`);
    expect(patch?.[2]).toEqual({
      email: 'ada@example.com',
      customer_id: null,
      items: [
        { variant_id: kept.variant_id, quantity: 5 },
        ...draft.items
          .slice(1)
          .map((li: { variant_id: string }) => ({ variant_id: li.variant_id, quantity: 0 })),
      ],
      shipping_address: v3Address,
      billing_address: { ...v3Address, state_code: undefined, state_name: 'Oregon' },
    });
  });

  it('chooses a delivery rate on the fulfillment', async () => {
    const { transport, calls } = store();
    await adminV3Orders(transport).selectShippingRate(
      { id: ID, number: 'R2001' },
      { id: 'ful_1', number: 'R2001-F1' },
      'dr_exp',
    );
    expect(writes(calls)).toEqual([
      ['PATCH', `/api/v3/admin/orders/${ID}/fulfillments/ful_1`, { selected_delivery_rate_id: 'dr_exp' }],
    ]);
  });

  it('offers only active methods that need no source or payment session', async () => {
    const { transport } = store();
    expect(await adminV3Orders(transport).paymentMethods({ id: ID, number: 'R2001' })).toEqual([
      { id: 'pm_check', name: 'Check', description: 'Pay by check.' },
    ]);
  });

  it('records the payment, completes with payment pending, and captures when paid', async () => {
    const { transport, calls } = store();
    await adminV3Orders(transport).place(
      { id: ID, number: 'R2001' },
      { payment: { methodId: 'pm_check', markPaid: true } },
    );
    expect(writes(calls)).toEqual([
      ['POST', `/api/v3/admin/orders/${ID}/payments`, { payment_method_id: 'pm_check' }],
      ['PATCH', `/api/v3/admin/orders/${ID}/complete`, { payment_pending: true }],
      ['PATCH', `/api/v3/admin/orders/${ID}/payments/py_new/capture`, undefined],
    ]);
  });

  it('reuses a leftover payment for the same method and voids others; no payment leaves it all due', async () => {
    const { transport, calls } = store(draft, [
      { id: 'py_keep', number: 'R2001-P1', status: 'checkout', payment_method_id: 'pm_check' },
      { id: 'py_other', number: 'R2001-P2', status: 'checkout', payment_method_id: 'pm_cash' },
      { id: 'py_void', number: 'R2001-P3', status: 'void', payment_method_id: 'pm_cash' },
    ]);
    const orders = adminV3Orders(transport);
    await orders.place({ id: ID, number: 'R2001' }, { payment: { methodId: 'pm_check', markPaid: false } });
    expect(writes(calls)).toEqual([
      ['PATCH', `/api/v3/admin/orders/${ID}/payments/py_other/void`, undefined],
      ['PATCH', `/api/v3/admin/orders/${ID}/complete`, { payment_pending: true }],
    ]);
    calls.length = 0;
    await orders.place({ id: ID, number: 'R2001' }, { payment: null });
    expect(writes(calls)).toEqual([
      ['PATCH', `/api/v3/admin/orders/${ID}/complete`, { payment_pending: true }],
    ]);
  });

  it('deletes a draft, and refuses to touch a placed order', async () => {
    const { transport, calls } = store();
    await adminV3Orders(transport).discardDraft({ id: ID, number: 'R2001' });
    expect(writes(calls)).toEqual([['DELETE', `/api/v3/admin/orders/${ID}`, undefined]]);

    const placed = store({ ...draft, status: 'placed' });
    await expect(
      adminV3Orders(placed.transport).discardDraft({ id: ID, number: 'R2001' }),
    ).rejects.toMatchObject({
      kind: 'invalid',
    });
    await expect(
      adminV3Orders(placed.transport).place({ id: ID, number: 'R2001' }, { payment: null }),
    ).rejects.toMatchObject({ kind: 'invalid' });
    expect(writes(placed.calls)).toEqual([]);
  });
});
