import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createAdapter } from '../src/adapters';
import { probeStore } from '../src/capabilities/probe';
import type { StoreProbe } from '../src/capabilities/types';
import { companion } from '../src/companion';
import type { SpreeAdapter } from '../src/ports';
import type { Transport } from '../src/transport';
import { baseTransport, enabled, env, proves, signIn, writeResults } from './env';
import { rails, railsJson } from './rails';

/**
 * Carts (built into the companion gem 0.7) and visitors (the Spree 4.2 store's demo visitors
 * adapter), docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md §3. Carts and visits are
 * made with `bin/rails runner` and deleted afterwards. Each part skips without its capability.
 */
describe.runIf(enabled)(`carts and visitors contract: Spree ${env.label}`, () => {
  let probe: StoreProbe;
  let adapter: SpreeAdapter;
  let api: Transport;
  const tag = `ct${Date.now().toString(36)}`;
  let carts: { active: string; abandoned: string } | null = null;
  let cartError = '';
  let visit: string | null = null;
  let visitError = '';

  beforeAll(async () => {
    probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
    const caps = probe.capabilities;
    if (!caps.includes('carts') && !caps.includes('visitors')) return;
    const transport = baseTransport();
    api = transport.withAuth(await signIn(transport));
    adapter = createAdapter(env.family ?? probe.preferredApi, api, { companion: probe.gem !== null });
    if (caps.includes('carts')) {
      // Two guest carts with an item: one just touched, one left for two hours.
      const made = railsJson<{ active: string; abandoned: string }>(
        [
          'v = Spree::Variant.joins(:product).merge(Spree::Product.available).where(is_master: false).first || Spree::Variant.first',
          'mk = ->(email) { o = Spree::Order.create!(email: email, store: Spree::Store.default, currency: Spree::Store.default.default_currency); Spree::Dependencies.cart_add_item_service.constantize.call(order: o, variant: v, quantity: 2); o.reload }',
          `a = mk.call('${tag}-active@example.com')`,
          `b = mk.call('${tag}-gone@example.com'); b.update_columns(updated_at: 2.hours.ago)`,
          '{ active: a.number, abandoned: b.number }',
        ].join('; '),
      );
      if ('value' in made) carts = made.value;
      else cartError = made.error;
    }
    if (caps.includes('visitors')) {
      const seeded = railsJson<{ session_id: string }>(
        [
          `s = AdminNativeDemo.visit!(url: '/', title: 'Home', name: 'Ada ${tag}', email: '${tag}@example.com', device: 'mobile', country: 'NL', referrer: 'https://search.example.com', utm: { source: 'news', medium: 'email', campaign: 'fall' }${carts ? `, order_number: '${carts.active}'` : ''}, at: 3.minutes.ago)`,
          `AdminNativeDemo.visit!(url: '/t/bags', title: 'Bags', session_id: s[:session_id])`,
        ].join('; '),
      );
      if ('value' in seeded) visit = seeded.value.session_id;
      else visitError = seeded.error;
    }
  });

  afterAll(() => {
    if (carts) rails(`Spree::Order.where(number: ['${carts.active}', '${carts.abandoned}']).destroy_all`);
    if (visit) rails('AdminNativeDemo.clear!');
    writeResults();
  });

  const cartsReady = (skip: (why: string) => never) => {
    if (!probe.capabilities.includes('carts')) skip('no carts (needs the companion gem 0.7)');
    if (!carts) skip(`can't make carts through docker compose exec: ${cartError}`);
    return carts as { active: string; abandoned: string };
  };
  const visitorsReady = (skip: (why: string) => never) => {
    if (!probe.capabilities.includes('visitors'))
      skip('no visitors (needs the companion gem 0.7 with a visitors adapter)');
    if (!visit) skip(`can't record a visit through docker compose exec: ${visitError}`);
    return visit as string;
  };

  proves('carts', 'lists carts newest first, with items, and gets one', async (skip) => {
    const c = cartsReady(skip);
    const all = await adapter.carts.list({ perPage: 100 });
    const numbers = all.items.map((x) => x.number);
    expect(numbers).toEqual(expect.arrayContaining([c.active, c.abandoned]));
    expect(numbers.indexOf(c.active)).toBeLessThan(numbers.indexOf(c.abandoned));
    const active = all.items.find((x) => x.number === c.active);
    expect(active).toMatchObject({ email: `${tag}-active@example.com`, itemCount: 2, abandoned: false });
    expect(active?.total?.currency).toMatch(/^[A-Z]{3}$/);
    expect(active?.items[0]).toMatchObject({ quantity: 2, name: expect.any(String) });
    expect((await adapter.carts.get(c.active)).number).toBe(c.active);
    await expect(adapter.carts.get('R000000000')).rejects.toMatchObject({ kind: 'notFound' });
  });

  proves('carts', 'filters active and abandoned carts as the Carts segment does', async (skip) => {
    const c = cartsReady(skip);
    const active = (await adapter.carts.list({ activeWithin: 60, perPage: 100 })).items.map((x) => x.number);
    expect(active).toContain(c.active);
    expect(active).not.toContain(c.abandoned);
    const abandoned = await adapter.carts.list({ abandoned: true, perPage: 100 });
    expect(abandoned.items.map((x) => x.number)).toContain(c.abandoned);
    expect(abandoned.items.map((x) => x.number)).not.toContain(c.active);
    expect(abandoned.items.every((x) => x.abandoned === true)).toBe(true);
    const withEmail = (await adapter.carts.list({ withEmail: false, perPage: 100 })).items.map(
      (x) => x.number,
    );
    expect(withEmail).not.toContain(c.active);
  });

  proves('carts', 'counts active carts on the Home summary', async (skip) => {
    cartsReady(skip);
    if (!probe.capabilities.includes('analytics.summary')) skip('no analytics.summary');
    const summary = await companion(api).summary();
    expect(summary.activeCarts).toBeGreaterThanOrEqual(1);
    if (probe.capabilities.includes('visitors')) expect(summary.visitorsOnline).toEqual(expect.any(Number));
  });

  proves('visitors', 'lists online sessions with their page, device and cart', async (skip) => {
    const id = visitorsReady(skip);
    const online = await adapter.visitors.list({ online: true, perPage: 100 });
    const s = online.items.find((x) => x.id === id);
    expect(s).toMatchObject({
      online: true,
      contact: { name: `Ada ${tag}`, email: `${tag}@example.com` },
      currentUrl: '/t/bags',
      currentTitle: 'Bags',
      device: 'mobile',
      country: 'NL',
      pageViews: 2,
      utm: { source: 'news', medium: 'email', campaign: 'fall' },
    });
    if (carts) expect(s?.cart).toMatchObject({ orderNumber: carts.active, itemCount: 2 });
  });

  proves('visitors', 'gets a session with its pages and starts a conversation once', async (skip) => {
    const id = visitorsReady(skip);
    const s = await adapter.visitors.get(id);
    expect(s.pages.map((p) => p.url).sort()).toEqual(['/', '/t/bags']);
    const first = await adapter.visitors.startConversation(id);
    expect(first.conversationId).toMatch(/^\w+$/);
    expect(await adapter.visitors.startConversation(id)).toEqual(first);
    expect((await adapter.visitors.get(id)).conversationId).toBe(first.conversationId);
    if (probe.capabilities.includes('inbox'))
      expect((await adapter.inbox.get(first.conversationId)).id).toBe(first.conversationId);
    await expect(adapter.visitors.get('999999999')).rejects.toMatchObject({ kind: 'notFound' });
  });
});
