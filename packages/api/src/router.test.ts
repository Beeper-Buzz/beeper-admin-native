import { Order } from '@spree-native/domain';
import { type SpreeAdapter, SpreeError, type StoreProbe } from '@spree-native/spree-sdk';
import { createTRPCClient, unstable_localLink } from '@trpc/client';
import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../domain/test/fixtures/order.json';
import { type AppRouter, appRouter, createCaller } from './router';
import type { Context } from './trpc';

const order = Order.parse(fixture);

const probe = (capabilities: string[]): StoreProbe => ({
  baseUrl: 'https://shop.test',
  apiFamilies: ['platform-v2'],
  preferredApi: 'platform-v2',
  capabilities: capabilities as StoreProbe['capabilities'],
  authMethods: ['password'],
  storeName: 'Northwind',
  currency: 'USD',
  spreeVersion: null,
  gem: null,
  probedAt: '2026-11-26T00:00:00Z',
});

function adapter(overrides: Partial<SpreeAdapter['orders']> = {}): SpreeAdapter {
  return {
    family: 'platform-v2',
    orders: {
      list: vi.fn(async () => ({ items: [order], nextCursor: null, totalCount: 1 })),
      get: vi.fn(async () => order),
      ...overrides,
    },
  };
}

const ctx = (capabilities = ['orders.read'], a = adapter()): Context => ({
  session: { probe: probe(capabilities), adapter: a },
});

describe('appRouter', () => {
  it('lists orders through the adapter with defaults', async () => {
    const a = adapter();
    const res = await createCaller(ctx(['orders.read'], a)).orders.list({});
    expect(res.items[0]?.number).toBe('R482913057');
    expect(a.orders.list).toHaveBeenCalledWith({ filter: 'all', perPage: 25, cursor: null });
  });

  it('passes search and filter through', async () => {
    const a = adapter();
    await createCaller(ctx(['orders.read'], a)).orders.list({ filter: 'unfulfilled', query: ' maya ' });
    expect(a.orders.list).toHaveBeenCalledWith({
      filter: 'unfulfilled',
      perPage: 25,
      cursor: null,
      query: 'maya',
    });
  });

  it('requires a connected store', async () => {
    await expect(createCaller({ session: null }).orders.list({})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('explains a missing capability in plain words', async () => {
    const err = await createCaller(ctx([]))
      .orders.list({})
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect((err as Error).message).toMatch(/reading orders/);
  });

  it('maps SpreeErrors to tRPC codes and keeps the kind', async () => {
    const a = adapter({
      get: async () => {
        throw new SpreeError({ kind: 'notFound', status: 404, message: 'Order not found' });
      },
    });
    const err = await createCaller(ctx(['orders.read'], a))
      .orders.get({ id: 'R1' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'NOT_FOUND', message: 'Order not found' });
    expect((err as TRPCError).cause).toMatchObject({ kind: 'notFound' });
  });

  it('probes a store through the injected fetch', async () => {
    const fetch = async () =>
      new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
    const res = await createCaller({ session: null, fetch }).store.probe({ url: 'shop.test' });
    expect(res.baseUrl).toBe('https://shop.test');
  });

  it('runs in-process through unstable_localLink, with spreeKind in error data', async () => {
    const a = adapter({
      list: async () => {
        throw new SpreeError({ kind: 'auth', status: 401 });
      },
    });
    const client = createTRPCClient<AppRouter>({
      links: [unstable_localLink({ router: appRouter, createContext: async () => ctx(['orders.read'], a) })],
    });
    expect((await client.orders.get.query({ id: 'R482913057' })).number).toBe('R482913057');
    const err = await client.orders.list.query({}).catch((e: unknown) => e);
    expect(err).toMatchObject({ data: { code: 'UNAUTHORIZED', spreeKind: 'auth' } });
  });
});

describe('store.signIn', () => {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  it('signs in to Spree 6 with email and password and keeps the refresh cookie', async () => {
    const fetch = async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/api/v3/admin/orders') return json(401, { error: { code: 'authentication_required' } });
      if (path === '/api/v3/admin/auth/login')
        return json(
          200,
          { token: 'jwt1' },
          { 'set-cookie': 'spree_admin_refresh_token=c1; path=/api/v3/admin/auth; httponly' },
        );
      return json(404, {});
    };
    const res = await createCaller({ session: null, fetch }).store.signIn({
      method: 'password',
      url: 'shop.test',
      email: 'a@b.c',
      password: 'x',
    });
    expect(res.probe.preferredApi).toBe('admin-v3');
    expect(res.credential).toEqual({ method: 'adminJwt', accessToken: 'jwt1', refreshCookie: 'c1' });
  });

  it('checks a Spree 4.2 API key with one authenticated read', async () => {
    const fetch = async (url: string, init: { headers: Record<string, string> }) => {
      const path = new URL(url).pathname;
      if (path === '/api/v1/orders')
        return init.headers['X-Spree-Token'] === 'good-key-123'
          ? json(200, { orders: [], count: 0, current_page: 1, pages: 0 })
          : json(401, { error: 'You must specify an API key.' });
      return json(404, {});
    };
    const caller = createCaller({ session: null, fetch });
    const ok = await caller.store.signIn({ method: 'spreeToken', url: 'shop.test', token: 'good-key-123' });
    expect(ok.credential).toEqual({ method: 'spreeToken', token: 'good-key-123' });
    await expect(
      caller.store.signIn({ method: 'spreeToken', url: 'shop.test', token: 'bad-key-123' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('explains which method a store needs', async () => {
    const fetch = async (url: string) =>
      new URL(url).pathname === '/api/v1/orders'
        ? json(401, { error: 'You must specify an API key.' })
        : json(404, {});
    await expect(
      createCaller({ session: null, fetch }).store.signIn({
        method: 'password',
        url: 'shop.test',
        email: 'a@b.c',
        password: 'x',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/admin API key/) });
  });
});

describe('pairing and companion procedures', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const gemStore = async (url: string) => {
    const path = new URL(url).pathname;
    if (path === '/api/admin_native/v1/capabilities')
      return json(200, {
        api_families: ['api-v1'],
        capabilities: ['notifications.push', 'analytics.summary'],
        auth_methods: ['pairing'],
      });
    if (path === '/api/admin_native/v1/pairings/exchange')
      return json(201, {
        token: 'san_devicetoken',
        device: { id: '1', name: 'iPhone', platform: 'ios' },
        user: { email: 'admin@example.com' },
      });
    return json(404, {});
  };

  it('pairs with a code and stores the device token as an API v1 key', async () => {
    const res = await createCaller({ session: null, fetch: gemStore }).store.pair({
      url: 'shop.test',
      code: 'ABCDEFGHJKMN',
      deviceName: 'iPhone',
    });
    expect(res.credential).toEqual({ method: 'spreeToken', token: 'san_devicetoken' });
    expect(res.probe.preferredApi).toBe('api-v1');
  });

  it('explains when a store has no gem', async () => {
    const fetch = async (url: string) =>
      new URL(url).pathname === '/api/v1/orders'
        ? json(401, { error: 'You must specify an API key.' })
        : json(404, {});
    await expect(
      createCaller({ session: null, fetch }).store.pair({
        url: 'shop.test',
        code: 'ABCDEFGHJKMN',
        deviceName: 'iPhone',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/spree_admin_native/) });
  });

  it('serves the summary from the companion when the store has it', async () => {
    const summary = vi.fn(async () => ({ currency: 'USD' }));
    const a = {
      ...adapter(),
      companion: { summary, updateCurrentDevice: vi.fn() },
    } as unknown as SpreeAdapter;
    await createCaller(ctx(['orders.read', 'analytics.summary'], a)).dashboard.summary();
    expect(summary).toHaveBeenCalled();
    await expect(createCaller(ctx(['orders.read'], a)).dashboard.summary()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });
});
