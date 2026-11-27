import type { Order } from '@instincts/spree-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdapter } from '../src/adapters';
import type { SessionAuth } from '../src/auth';
import { probeStore } from '../src/capabilities/probe';
import type { SpreeAdapter } from '../src/ports';
import { baseTransport, enabled, env, proves, results, signIn, writeResults } from './env';

describe.runIf(enabled)(`contract: Spree ${env.label}`, () => {
  let adapter: SpreeAdapter;
  let auth: SessionAuth;
  let hasGem = false;
  let all: Order[] = [];

  beforeAll(async () => {
    const probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
    const transport = baseTransport();
    auth = await signIn(transport);
    hasGem = probe.gem !== null;
    adapter = createAdapter(env.family ?? probe.preferredApi, transport.withAuth(auth), {
      companion: hasGem,
    });
  });

  afterAll(writeResults);

  proves('store.probe', 'detects the expected API family', async () => {
    const probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
    if (env.family) expect(probe.preferredApi).toBe(env.family);
  });

  proves(
    `auth.${process.env.SPREE_PAIRING_CODE ? 'pairing' : process.env.SPREE_EMAIL ? 'password' : 'key'}`,
    'signs in and refreshes',
    async () => {
      expect(auth.serialize().method).toBeTruthy();
      if (auth.refresh) {
        await auth.refresh();
        await adapter.orders.list({ filter: 'all', perPage: 1 });
      }
    },
  );

  it.runIf(process.env.SPREE_PAIRING_CODE)('[companion] the gem announces itself and pairing', async () => {
    const probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
    expect(probe.gem).not.toBeNull();
    expect(probe.authMethods).toContain('pairing');
    expect(probe.capabilities).toEqual(
      expect.arrayContaining(['orders.read', 'notifications.push', 'analytics.summary']),
    );
    results['auth.pairing'] = 'pass';
  });

  it.runIf(process.env.SPREE_PAIRING_CODE)(
    '[analytics.summary] serves Home numbers that agree with the order list',
    async () => {
      try {
        const summary = await adapter.companion?.summary();
        const unfulfilled = await adapter.orders.list({ filter: 'unfulfilled', perPage: 1 });
        expect(summary?.ordersToFulfill).toBe(unfulfilled.totalCount);
        expect(summary?.lowStockVariants).toBeGreaterThanOrEqual(1);
        results['analytics.summary'] = 'pass';
      } catch (e) {
        results['analytics.summary'] = 'fail';
        throw e;
      }
    },
  );

  proves('orders.read', 'lists placed orders as valid domain orders', async () => {
    const page = await adapter.orders.list({ filter: 'all', perPage: 50 });
    all = page.items;
    expect(all.length).toBeGreaterThan(0);
    for (const o of all) expect(o.status).not.toBe('draft');
  });

  proves('orders.read', 'pages with a cursor', async () => {
    const first = await adapter.orders.list({ filter: 'all', perPage: 5 });
    expect(first.nextCursor).not.toBeNull();
    const second = await adapter.orders.list({ filter: 'all', perPage: 5, cursor: first.nextCursor });
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  proves('orders.read', 'filters unfulfilled orders', async (skip) => {
    const page = await adapter.orders.list({ filter: 'unfulfilled', perPage: 50 });
    if (page.items.length === 0) return skip('no unfulfilled orders left (the action tests ship them)');
    for (const o of page.items)
      expect(['unfulfilled', 'partial', 'backorder']).toContain(o.fulfillmentStatus);
  });

  proves('orders.read', 'filters unpaid orders', async (skip) => {
    const page = await adapter.orders.list({ filter: 'unpaid', perPage: 50 });
    if (page.items.length === 0) return skip('no unpaid orders left (the action tests capture them)');
    for (const o of page.items)
      expect(['unpaid', 'partially_paid', 'failed', 'authorized']).toContain(o.paymentStatus);
  });

  proves('orders.read', 'gets an order by number with line items', async () => {
    const sample = all.find((o) => o.lineItems.length > 0) ?? all[0];
    if (!sample) throw new Error('no orders');
    const order = await adapter.orders.get(sample.number);
    expect(order.number).toBe(sample.number);
    expect(order.lineItems.length).toBeGreaterThan(0);
    expect(order.lineItems[0]?.name).not.toBe('Item');
  });

  proves('orders.read', 'searches by order number', async () => {
    const sample = all[0];
    if (!sample) throw new Error('no orders');
    const page = await adapter.orders.list({ filter: 'all', query: sample.number });
    expect(page.items.map((o) => o.number)).toContain(sample.number);
  });

  // --- Actions. These change the store's data (reset with `spree-up --reset`). ---------------

  /** Placed orders, newest first, with full detail (lists can omit payments or fulfillments). */
  async function candidates(filter: 'all' | 'unfulfilled' | 'unpaid', n = 40): Promise<Order[]> {
    const page = await adapter.orders.list({ filter, perPage: n });
    return Promise.all(page.items.map((o) => adapter.orders.get(o.number)));
  }

  proves('shipments.ship', 'ships a ready fulfillment with a tracking number', async (skip) => {
    const orders = await candidates('unfulfilled');
    const order = orders.find(
      (o) => o.paymentStatus === 'paid' && o.fulfillments.some((f) => f.status === 'ready'),
    );
    if (!order) return skip('no paid order with a ready fulfillment');
    const fulfillment = order.fulfillments.find((f) => f.status === 'ready');
    if (!fulfillment) return skip('no ready fulfillment');
    const tracking = `CT${Date.now()}`;
    const after = await adapter.orders.ship(order, fulfillment, { tracking });
    const shipped = after.fulfillments.find((f) => f.id === fulfillment.id);
    expect(shipped?.status).toBe('fulfilled');
    expect(shipped?.trackingNumber ?? shipped?.trackingUrl).toContain(tracking);
  });

  proves('orders.capture', 'captures a pending payment', async (skip) => {
    const orders = await candidates('unpaid');
    const order = orders.find((o) => o.status === 'placed' && o.payments.some((p) => p.status === 'pending'));
    if (!order) return skip('no order with a pending payment');
    const payment = order.payments.find((p) => p.status === 'pending');
    if (!payment) return skip('no pending payment');
    const after = await adapter.orders.capture(order, payment);
    expect(after.payments.find((p) => p.id === payment.id)?.status).toBe('completed');
  });

  proves('orders.refund', 'lists refund reasons and refunds part of a payment', async (skip) => {
    const reasons = await adapter.orders.refundReasons();
    expect(reasons.length).toBeGreaterThan(0);
    const orders = await candidates('all');
    const order = orders.find(
      (o) =>
        o.status === 'placed' &&
        o.payments.some((p) => p.status === 'completed' && Number(p.amount.amount) >= 2),
    );
    if (!order) return skip('no order with a completed payment');
    const payment = order.payments.find((p) => p.status === 'completed' && Number(p.amount.amount) >= 2);
    if (!payment) return skip('no completed payment');
    const after = await adapter.orders.refund(order, {
      payment,
      amount: '1.00',
      reasonId: reasons[0]?.id ?? null,
    });
    expect(after.number).toBe(order.number);
    expect(Number(after.paymentTotal.amount)).toBeLessThan(Number(order.paymentTotal.amount));
  });

  proves('orders.cancel', 'cancels an open order', async (skip) => {
    const orders = await candidates('unfulfilled');
    const order = orders.find(
      (o) => o.status === 'placed' && o.fulfillments.every((f) => f.status !== 'fulfilled'),
    );
    if (!order) return skip('no open order to cancel');
    const after = await adapter.orders.cancel(order);
    expect(after.status).toBe('canceled');
  });
});
