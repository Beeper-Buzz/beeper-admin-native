import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createAdapter } from '../src/adapters';
import { probeStore } from '../src/capabilities/probe';
import type { SpreeAdapter } from '../src/ports';
import { baseTransport, enabled, env, proves, signIn, writeResults } from './env';

/** Creates promotions it leaves expired (there is no delete in the port); reset with `spree-up --reset`. */
describe.runIf(enabled)(`contract: promotions on Spree ${env.label}`, () => {
  let adapter: SpreeAdapter;
  let currency: string;
  const code = `CT${Date.now().toString(36).toUpperCase()}`;
  let id = '';

  beforeAll(async () => {
    const probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
    const transport = baseTransport();
    const auth = await signIn(transport);
    adapter = createAdapter(env.family ?? probe.preferredApi, transport.withAuth(auth), {
      companion: probe.gem !== null,
    });
    currency = probe.currency ?? 'USD';
  });

  afterAll(writeResults);

  proves('promotions.write', 'creates a percent coupon', async () => {
    const p = await adapter.promotions.create({
      name: `Contract ${code}`,
      code,
      discount: { type: 'percent', amount: '15' },
    });
    id = p.id;
    expect(p.code?.toUpperCase()).toBe(code);
    expect(p.status).toBe('active');
    expect(p.discount).toEqual({ type: 'percent', amount: '15' });
    expect(p.editableDiscount).toBe(true);
  });

  proves('promotions.read', 'finds it by code and by id', async () => {
    const page = await adapter.promotions.list({ query: code.toLowerCase(), perPage: 5 });
    expect(page.items.map((p) => p.id)).toContain(id);
    expect((await adapter.promotions.get(id)).name).toBe(`Contract ${code}`);
  });

  proves('promotions.write', 'switches to a fixed discount and expires it', async () => {
    const now = Date.now();
    const p = await adapter.promotions.update(
      { id },
      {
        discount: { type: 'fixed', amount: '5', currency },
        startsAt: new Date(now - 86_400_000).toISOString(),
        expiresAt: new Date(now - 60_000).toISOString(),
      },
    );
    expect(p.discount).toMatchObject({ type: 'fixed', amount: '5' });
    expect(p.status).toBe('expired');
  });

  proves('promotions.read', 'filters by status', async () => {
    const expired = await adapter.promotions.list({ filter: 'expired', query: code.toLowerCase() });
    expect(expired.items.map((p) => p.id)).toContain(id);
    const active = await adapter.promotions.list({ filter: 'active', query: code.toLowerCase() });
    expect(active.items.map((p) => p.id)).not.toContain(id);
  });

  proves('promotions.write', 'refuses an end before the start without sending it', async () => {
    await expect(
      adapter.promotions.update(
        { id },
        { startsAt: '2026-12-02T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z' },
      ),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });
});
