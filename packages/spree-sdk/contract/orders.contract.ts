import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Order } from '@spree-native/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdapter } from '../src/adapters';
import type { SessionAuth } from '../src/auth';
import { probeStore } from '../src/capabilities/probe';
import type { SpreeAdapter } from '../src/ports';
import { baseTransport, enabled, env, results, signIn } from './env';

/** Wrap a test so its outcome is recorded against a capability. */
function proves(capability: string, name: string, fn: () => Promise<void>) {
  it(`[${capability}] ${name}`, async () => {
    try {
      await fn();
      if (results[capability] !== 'fail') results[capability] = 'pass';
    } catch (e) {
      results[capability] = 'fail';
      throw e;
    }
  });
}

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

  afterAll(() => {
    const dir = resolve(__dirname, '../../../contract-results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, `${env.label}.json`),
      `${JSON.stringify({ label: env.label, family: env.family, results }, null, 2)}\n`,
    );
  });

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

  proves('orders.read', 'filters unfulfilled orders', async () => {
    const page = await adapter.orders.list({ filter: 'unfulfilled', perPage: 50 });
    expect(page.items.length).toBeGreaterThan(0);
    for (const o of page.items)
      expect(['unfulfilled', 'partial', 'backorder']).toContain(o.fulfillmentStatus);
  });

  proves('orders.read', 'filters unpaid orders', async () => {
    const page = await adapter.orders.list({ filter: 'unpaid', perPage: 50 });
    expect(page.items.length).toBeGreaterThan(0);
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
});
