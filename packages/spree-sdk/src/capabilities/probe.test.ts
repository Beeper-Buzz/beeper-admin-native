import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../transport';
import { probeStore } from './probe';

type Routes = Record<string, { status: number; body?: unknown } | 'hang' | 'throw'>;

function routes(map: Routes) {
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const r = map[path] ?? { status: 404, body: { error: 'Not found' } };
    if (r === 'throw') throw new TypeError('Network request failed');
    if (r === 'hang')
      return new Promise((_res, rej) =>
        init.signal?.addEventListener('abort', () => rej(new Error('aborted'))),
      );
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch };
}

/** Exactly what Spree 4.2.7 and 6.0.6 answered (infra/spree/FINDINGS.md §c), after redirects. */
const SPREE_42: Routes = {
  '/api/v1/orders': { status: 401, body: { error: 'You must specify an API key.' } },
};
const SPREE_60: Routes = {
  '/api/v3/admin/orders': {
    status: 401,
    body: { error: { code: 'authentication_required', message: 'Authentication required' } },
  },
};

describe('probeStore', () => {
  it('trusts the companion gem over API probes when present', async () => {
    const { fetch } = routes({
      ...SPREE_42,
      '/api/admin_native/v1/capabilities': {
        status: 200,
        body: {
          spree_version: '4.2.5',
          gem_version: '0.1.0',
          api_families: ['api-v1'],
          capabilities: ['notifications.push', 'analytics.summary', 'beeper.moderation'],
          auth_methods: ['pairing'],
          store: { name: 'Beeper', currency: 'USD' },
        },
      },
    });
    const probe = await probeStore({ baseUrl: 'admin.beeper.test', fetch });
    expect(probe).toMatchObject({
      baseUrl: 'https://admin.beeper.test',
      preferredApi: 'api-v1',
      spreeVersion: '4.2.5',
      gem: { version: '0.1.0' },
      storeName: 'Beeper',
      authMethods: ['pairing', 'spreeToken'],
    });
    // Family defaults plus the gem's extras.
    expect(probe.capabilities).toEqual(
      expect.arrayContaining(['orders.read', 'analytics.summary', 'beeper.moderation']),
    );
  });

  it('detects Spree 4.2 from API v1 and asks for an API key', async () => {
    const probe = await probeStore({ baseUrl: 'http://localhost:3042', fetch: routes(SPREE_42).fetch });
    expect(probe.apiFamilies).toEqual(['api-v1']);
    expect(probe.authMethods).toEqual(['spreeToken']);
    expect(probe.capabilities).toContain('orders.read');
    expect(probe.capabilities).not.toContain('orders.refund');
  });

  it('prefers Platform v2 on Spree 4.4–5.x, where API v1 also answers', async () => {
    const { fetch } = routes({
      ...SPREE_42,
      '/api/v2/platform/orders': { status: 401, body: { error: 'invalid_token' } },
    });
    const probe = await probeStore({ baseUrl: 'https://shop.test', fetch });
    expect(probe.apiFamilies).toEqual(['platform-v2', 'api-v1']);
    expect(probe.preferredApi).toBe('platform-v2');
    expect(probe.authMethods).toEqual(['oauthClient']);
  });

  it('detects Spree 6 from Admin API v3', async () => {
    const probe = await probeStore({ baseUrl: 'http://localhost:3060', fetch: routes(SPREE_60).fetch });
    expect(probe.apiFamilies).toEqual(['admin-v3']);
    expect(probe.capabilities).toEqual(
      expect.arrayContaining(['orders.read', 'orders.refund', 'webhooks.manage']),
    );
    expect(probe.authMethods).toEqual(['password', 'apiKey']);
  });

  it('ignores a 401 from an app that is not Spree', async () => {
    const { fetch } = routes({ '/api/v1/orders': { status: 401, body: { message: 'Unauthorized' } } });
    await expect(probeStore({ baseUrl: 'https://other.test', fetch })).rejects.toMatchObject({
      kind: 'notSpree',
    });
  });

  it('says "not Spree" when no API answers', async () => {
    await expect(
      probeStore({ baseUrl: 'https://example.com', fetch: routes({}).fetch }),
    ).rejects.toMatchObject({ kind: 'notSpree' });
  });

  it('reports network failures as network errors, not "not Spree"', async () => {
    const all: Routes = Object.fromEntries(
      [
        '/api/admin_native/v1/capabilities',
        '/api/v3/admin/orders',
        '/api/v2/platform/orders',
        '/api/v1/orders',
        '/api/v2/storefront/store',
      ].map((p) => [p, 'throw' as const]),
    );
    await expect(
      probeStore({ baseUrl: 'https://offline.test', fetch: routes(all).fetch }),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('finishes within the time budget when a probe hangs', async () => {
    const { fetch } = routes({
      ...SPREE_42,
      '/api/admin_native/v1/capabilities': 'hang',
      '/api/v3/admin/orders': 'hang',
    });
    const started = Date.now();
    const probe = await probeStore({ baseUrl: 'https://slow.test', fetch, timeoutMs: 100 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(probe.preferredApi).toBe('api-v1');
  });
});
