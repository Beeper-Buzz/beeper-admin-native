import { Customer, Order, Product } from '@instincts/spree-domain';
import {
  type SpreeAdapter,
  SpreeError,
  type StoreProbe,
  unsupportedCustomers,
  unsupportedMedia,
  unsupportedProducts,
  unsupportedPromotions,
  unsupportedResources,
} from '@instincts/spree-sdk';
import { createTRPCClient, localLink } from '@trpc/client';
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

function adapter(
  overrides: Partial<SpreeAdapter['orders']> = {},
  promotions: Partial<SpreeAdapter['promotions']> = {},
): SpreeAdapter {
  return {
    family: 'platform-v2',
    orders: {
      list: vi.fn(async () => ({ items: [order], nextCursor: null, totalCount: 1 })),
      get: vi.fn(async () => order),
      ship: vi.fn(async () => order),
      capture: vi.fn(async () => order),
      cancel: vi.fn(async () => order),
      refund: vi.fn(async () => order),
      refundReasons: vi.fn(async () => [{ id: '1', name: 'Return processing' }]),
      createDraft: vi.fn(async () => order),
      updateDraft: vi.fn(async () => order),
      selectShippingRate: vi.fn(async () => order),
      paymentMethods: vi.fn(async () => [{ id: '3', name: 'Check', description: null }]),
      place: vi.fn(async () => order),
      discardDraft: vi.fn(async () => undefined),
      ...overrides,
    },
    products: unsupportedProducts,
    customers: unsupportedCustomers,
    promotions: { ...unsupportedPromotions, ...promotions },
    media: unsupportedMedia,
    resources: unsupportedResources,
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

  it('runs in-process through localLink, with spreeKind in error data', async () => {
    const a = adapter({
      list: async () => {
        throw new SpreeError({ kind: 'auth', status: 401 });
      },
    });
    const client = createTRPCClient<AppRouter>({
      links: [localLink({ router: appRouter, createContext: async () => ctx(['orders.read'], a) })],
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

  describe('order actions', () => {
    const ref = { id: order.id, number: order.number };
    const payment = { id: '7', number: 'PABC1234' };

    it('ships a fulfillment with a trimmed tracking number', async () => {
      const a = adapter();
      const res = await createCaller(ctx(['orders.read', 'shipments.ship'], a)).orders.ship({
        order: ref,
        fulfillment: { id: '3', number: 'H123456' },
        tracking: ' 1Z999 ',
      });
      expect(res.number).toBe(order.number);
      expect(a.orders.ship).toHaveBeenCalledWith(ref, { id: '3', number: 'H123456' }, { tracking: '1Z999' });
    });

    it('refuses actions the store lacks', async () => {
      const a = adapter();
      await expect(
        createCaller(ctx(['orders.read'], a)).orders.capture({ order: ref, payment }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect(a.orders.capture).not.toHaveBeenCalled();
    });

    it('captures and cancels', async () => {
      const a = adapter();
      const caller = createCaller(ctx(['orders.read', 'orders.capture', 'orders.cancel'], a));
      await caller.orders.capture({ order: ref, payment });
      await caller.orders.cancel({ order: ref });
      expect(a.orders.capture).toHaveBeenCalledWith(ref, payment);
      expect(a.orders.cancel).toHaveBeenCalledWith(ref);
    });

    it('refunds a positive decimal amount with an optional reason', async () => {
      const a = adapter();
      const caller = createCaller(ctx(['orders.read', 'orders.refund'], a));
      await caller.orders.refund({ order: ref, payment, amount: '12.50', reasonId: '1' });
      expect(a.orders.refund).toHaveBeenCalledWith(ref, { payment, amount: '12.50', reasonId: '1' });
      await expect(caller.orders.refund({ order: ref, payment, amount: '0' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      await expect(caller.orders.refund({ order: ref, payment, amount: '1,5' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(await caller.orders.refundReasons()).toEqual([{ id: '1', name: 'Return processing' }]);
    });
  });

  describe('promotions', () => {
    const promo = {
      id: '1',
      name: 'Spring',
      description: null,
      code: 'SPRING',
      status: 'active' as const,
      startsAt: null,
      expiresAt: null,
      usageLimit: null,
      usageCount: 0,
      discount: { type: 'percent' as const, amount: '20' },
      editableDiscount: true,
      createdAt: null,
      updatedAt: null,
    };

    it('creates with the store currency on fixed discounts', async () => {
      const create = vi.fn(async () => promo);
      const caller = createCaller(ctx(['promotions.write'], adapter({}, { create })));
      await caller.promotions.create({
        name: ' Spring ',
        code: 'SPRING',
        discount: { type: 'fixed', amount: '5' },
      });
      expect(create).toHaveBeenCalledWith({
        name: 'Spring',
        code: 'SPRING',
        discount: { type: 'fixed', amount: '5', currency: 'USD' },
      });
    });

    it('validates discounts, codes and dates', async () => {
      const caller = createCaller(
        ctx(['promotions.write'], adapter({}, { create: vi.fn(async () => promo) })),
      );
      for (const bad of [
        { name: 'X', discount: { type: 'percent' as const, amount: '120' } },
        { name: 'X', discount: { type: 'fixed' as const, amount: '0' } },
        { name: 'X', code: 'has space', discount: { type: 'fixed' as const, amount: '1' } },
        { name: '', discount: { type: 'fixed' as const, amount: '1' } },
        { name: 'X', expiresAt: 'tomorrow', discount: { type: 'fixed' as const, amount: '1' } },
      ]) {
        await expect(caller.promotions.create(bad)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
    });

    it('updates only the fields sent, and clears with null', async () => {
      const update = vi.fn(async () => promo);
      const caller = createCaller(ctx(['promotions.write'], adapter({}, { update })));
      await caller.promotions.update({
        id: '1',
        expiresAt: null,
        discount: { type: 'percent', amount: '10' },
      });
      expect(update).toHaveBeenCalledWith(
        { id: '1' },
        { expiresAt: null, discount: { type: 'percent', amount: '10' } },
      );
    });

    it('lists behind promotions.read', async () => {
      const list = vi.fn(async () => ({ items: [promo], nextCursor: null }));
      await expect(
        createCaller(ctx(['orders.read'], adapter({}, { list }))).promotions.list({}),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
      await createCaller(ctx(['promotions.read'], adapter({}, { list }))).promotions.list({
        filter: 'active',
      });
      expect(list).toHaveBeenCalledWith({ filter: 'active', cursor: null, perPage: 25 });
    });
  });
});

describe('products and customers', () => {
  const product = Product.parse({
    id: 'prod_1',
    name: 'Denim Shirt',
    slug: 'denim-shirt',
    status: 'active',
    description: null,
    imageUrl: null,
    variants: [
      {
        id: 'variant_1',
        sku: 'SHIRT-S',
        optionsText: 'Size: S',
        isMaster: false,
        price: { amount: '19.99', currency: 'USD' },
        compareAtPrice: null,
        totalOnHand: 4,
        imageUrl: null,
      },
    ],
    updatedAt: null,
  });
  const customer = Customer.parse({
    id: 'cust_1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: null,
    ordersCount: 2,
    totalSpent: { amount: '40.00', currency: 'USD' },
    createdAt: '2026-11-26T00:00:00Z',
    defaultAddress: null,
  });

  function catalog() {
    const products = {
      list: vi.fn(async () => ({ items: [product], nextCursor: null, totalCount: 1 })),
      get: vi.fn(async () => product),
      update: vi.fn(async () => product),
      updateVariant: vi.fn(async () => product),
      setStock: vi.fn(async () => product),
    };
    const customers = {
      list: vi.fn(async () => ({ items: [customer], nextCursor: '2' })),
      get: vi.fn(async () => customer),
    };
    return { a: { ...adapter(), products, customers } as SpreeAdapter, products, customers };
  }
  const ALL = ['products.read', 'products.write', 'inventory.adjust', 'customers.read'];
  const ref = { id: product.id };

  it('lists products with defaults, search and status', async () => {
    const { a, products } = catalog();
    const caller = createCaller(ctx(['products.read'], a));
    expect((await caller.products.list({})).items[0]?.id).toBe('prod_1');
    expect(products.list).toHaveBeenCalledWith({ status: 'all', perPage: 25, cursor: null });
    await caller.products.list({ query: ' shirt ', status: 'draft', cursor: '2:5', perPage: 10 });
    expect(products.list).toHaveBeenLastCalledWith({
      status: 'draft',
      perPage: 10,
      cursor: '2:5',
      query: 'shirt',
    });
    expect((await caller.products.get({ id: 'prod_1' })).name).toBe('Denim Shirt');
  });

  it('lists low-stock products only on stores that can', async () => {
    const { a, products } = catalog();
    await expect(
      createCaller(ctx(['products.read'], a)).products.list({ lowStock: true }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await createCaller(ctx(['products.read', 'inventory.lowStock'], a)).products.list({ lowStock: true });
    expect(products.list).toHaveBeenLastCalledWith({
      status: 'all',
      perPage: 25,
      cursor: null,
      lowStock: true,
    });
  });

  it('gates reads, writes and stock on their own capabilities', async () => {
    const { a, products } = catalog();
    await expect(createCaller(ctx(['orders.read'], a)).products.list({})).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringMatching(/reading products/),
    });
    const reader = createCaller(ctx(['products.read'], a));
    await expect(reader.products.update({ product: ref, name: 'X' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    await expect(
      createCaller(ctx(['products.read', 'products.write'], a)).products.setStock({
        product: ref,
        variantId: 'variant_1',
        countOnHand: 3,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringMatching(/stock/) });
    expect(products.update).not.toHaveBeenCalled();
    expect(products.setStock).not.toHaveBeenCalled();
  });

  it('updates a product with only the fields given', async () => {
    const { a, products } = catalog();
    const caller = createCaller(ctx(ALL, a));
    await caller.products.update({ product: ref, name: ' Renamed ', status: 'archived' });
    expect(products.update).toHaveBeenCalledWith(ref, { name: 'Renamed', status: 'archived' });
    await caller.products.update({ product: ref, description: null });
    expect(products.update).toHaveBeenLastCalledWith(ref, { description: null });
    await expect(caller.products.update({ product: ref, name: '  ' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.products.update({ product: ref, status: 'deleted' as 'active' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('accepts prices as positive decimals with at most two places', async () => {
    const { a, products } = catalog();
    const caller = createCaller(ctx(ALL, a));
    await caller.products.updateVariant({
      product: ref,
      variantId: 'variant_1',
      price: '24.50',
      compareAtPrice: null,
      sku: ' ',
    });
    expect(products.updateVariant).toHaveBeenCalledWith(ref, 'variant_1', {
      price: '24.50',
      compareAtPrice: null,
      sku: null,
    });
    await caller.products.updateVariant({ product: ref, variantId: 'variant_1', compareAtPrice: '30' });
    expect(products.updateVariant).toHaveBeenLastCalledWith(ref, 'variant_1', { compareAtPrice: '30' });
    for (const price of ['0', '0.00', '1.999', '-1', '1,50', 'abc']) {
      await expect(
        caller.products.updateVariant({ product: ref, variantId: 'variant_1', price }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    await expect(
      caller.products.updateVariant({ product: ref, variantId: 'variant_1', compareAtPrice: '0' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(products.updateVariant).toHaveBeenCalledTimes(2);
  });

  it('sets stock to a non-negative whole number', async () => {
    const { a, products } = catalog();
    const caller = createCaller(ctx(ALL, a));
    await caller.products.setStock({ product: ref, variantId: 'variant_1', countOnHand: 0 });
    expect(products.setStock).toHaveBeenCalledWith(ref, 'variant_1', 0);
    for (const countOnHand of [-1, 2.5]) {
      await expect(
        caller.products.setStock({ product: ref, variantId: 'variant_1', countOnHand }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(products.setStock).toHaveBeenCalledTimes(1);
  });

  it('lists and gets customers behind customers.read', async () => {
    const { a, customers } = catalog();
    const caller = createCaller(ctx(['customers.read'], a));
    const page = await caller.customers.list({ query: ' ada ' });
    expect(page).toMatchObject({ nextCursor: '2', items: [{ email: 'ada@example.com' }] });
    expect(customers.list).toHaveBeenCalledWith({ perPage: 25, cursor: null, query: 'ada' });
    expect((await caller.customers.get({ id: 'cust_1' })).ordersCount).toBe(2);
    await expect(createCaller(ctx(['orders.read'], a)).customers.list({})).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it("turns an adapter's capability error into PRECONDITION_FAILED", async () => {
    const err = await createCaller(ctx(ALL, adapter()))
      .products.list({})
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect((err as TRPCError).cause).toMatchObject({ kind: 'capability' });
  });
});

describe('media', () => {
  const image = {
    id: 'media_1',
    url: 'https://shop.test/large/1.webp',
    thumbUrl: 'https://shop.test/small/1.webp',
    alt: null,
    position: 1,
    variantIds: [],
  };
  function withMedia() {
    const media = {
      list: vi.fn(async () => [image]),
      upload: vi.fn(async () => [image]),
      update: vi.fn(async () => [image]),
      move: vi.fn(async () => [image]),
      remove: vi.fn(async () => []),
      library: vi.fn(async () => ({
        items: [{ ...image, productId: 'prod_1', productName: 'Tote' }],
        nextCursor: null,
      })),
    };
    return { a: { ...adapter(), media } as SpreeAdapter, media };
  }
  const ref = { id: 'prod_1' };
  const file = { uri: 'file:///tmp/photo.jpg', name: 'photo.jpg', type: 'image/jpeg' };

  it('gates gallery procedures on products.media and the library on media.library', async () => {
    const { a, media } = withMedia();
    const reader = createCaller(ctx(['products.read', 'products.write'], a));
    await expect(reader.media.list({ product: ref })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringMatching(/product photos/),
    });
    await expect(reader.media.upload({ product: ref, file })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    await expect(createCaller(ctx(['products.media'], a)).media.library({})).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(media.upload).not.toHaveBeenCalled();
    expect(media.library).not.toHaveBeenCalled();
  });

  it('lists, uploads with trimmed alt text and only the variants given', async () => {
    const { a, media } = withMedia();
    const caller = createCaller(ctx(['products.media'], a));
    expect(await caller.media.list({ product: ref })).toEqual([image]);
    await caller.media.upload({ product: ref, file, alt: ' Front ' });
    expect(media.upload).toHaveBeenCalledWith(ref, { file, alt: 'Front' });
    await caller.media.upload({ product: ref, file, alt: '', variantIds: ['variant_1'] });
    expect(media.upload).toHaveBeenLastCalledWith(ref, { file, variantIds: ['variant_1'] });
    await expect(
      caller.media.upload({ product: ref, file: { ...file, type: 'application/pdf' } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('updates alt text and variants, moves and removes', async () => {
    const { a, media } = withMedia();
    const caller = createCaller(ctx(['products.media'], a));
    await caller.media.update({ product: ref, imageId: 'media_1', alt: '  ' });
    expect(media.update).toHaveBeenCalledWith(ref, 'media_1', { alt: null });
    await caller.media.update({ product: ref, imageId: 'media_1', variantIds: [] });
    expect(media.update).toHaveBeenLastCalledWith(ref, 'media_1', { variantIds: [] });
    await expect(
      caller.media.update({ product: ref, imageId: 'media_1', alt: 'x'.repeat(256) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await caller.media.move({ product: ref, imageId: 'media_1', toIndex: 0 });
    expect(media.move).toHaveBeenCalledWith(ref, 'media_1', 0);
    await expect(caller.media.move({ product: ref, imageId: 'media_1', toIndex: -1 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await caller.media.remove({ product: ref, imageId: 'media_1' })).toEqual([]);
  });

  it('pages the library with search and the missing-alt filter', async () => {
    const { a, media } = withMedia();
    const caller = createCaller(ctx(['media.library'], a));
    const page = await caller.media.library({});
    expect(page.items[0]?.productName).toBe('Tote');
    expect(media.library).toHaveBeenCalledWith({ missingAlt: false, perPage: 24, cursor: null });
    await caller.media.library({ query: ' tote ', missingAlt: true, cursor: '2' });
    expect(media.library).toHaveBeenLastCalledWith({
      missingAlt: true,
      perPage: 24,
      cursor: '2',
      query: 'tote',
    });
  });

  it('keeps the Spree error kind of a refused write', async () => {
    const { a } = withMedia();
    a.media.move = async () => {
      throw new SpreeError({ kind: 'invalid', status: 422, message: 'Change which variant first.' });
    };
    await expect(
      createCaller(ctx(['products.media'], a)).media.move({ product: ref, imageId: 'media_1', toIndex: 0 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Change which variant first.' });
  });
});

describe('order creation', () => {
  const ref = { id: order.id, number: order.number };
  const address = {
    firstName: ' Ada ',
    lastName: 'Lovelace',
    company: '',
    address1: '1 Main St',
    address2: null,
    city: 'Portland',
    zipcode: '97201',
    phone: '555-0100',
    stateCode: 'or',
    stateName: null,
    countryIso: 'us',
  };
  const draft = {
    customerId: null,
    email: ' ada@example.com ',
    items: [{ variantId: '117', quantity: 2 }],
    shipAddress: address,
    billAddress: null,
  };
  const can = (a = adapter()) => createCaller(ctx(['orders.read', 'orders.create'], a));

  it('needs orders.create, and says which Spree versions have it', async () => {
    const a = adapter();
    const err = await createCaller(ctx(['orders.read'], a))
      .orders.createDraft(draft)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect((err as Error).message).toMatch(/Creating orders/);
    expect(a.orders.createDraft).not.toHaveBeenCalled();
  });

  it('creates a draft with a tidy address: trimmed, empty as null, codes in capitals', async () => {
    const a = adapter();
    await can(a).orders.createDraft(draft);
    expect(a.orders.createDraft).toHaveBeenCalledWith({
      customerId: null,
      email: 'ada@example.com',
      items: [{ variantId: '117', quantity: 2 }],
      shipAddress: { ...address, firstName: 'Ada', company: null, stateCode: 'OR', countryIso: 'US' },
      billAddress: null,
    });
  });

  it('refuses drafts Spree would refuse, before calling the store', async () => {
    const a = adapter();
    const bad = [
      { ...draft, email: 'not-an-email' },
      { ...draft, items: [] },
      { ...draft, items: [{ variantId: '117', quantity: 0 }] },
      { ...draft, items: [{ variantId: '117', quantity: 1.5 }] },
      {
        ...draft,
        items: [
          { variantId: '117', quantity: 1 },
          { variantId: '117', quantity: 2 },
        ],
      },
      { ...draft, shipAddress: { ...address, city: ' ' } },
      { ...draft, shipAddress: { ...address, countryIso: 'USA' } },
    ];
    for (const input of bad)
      await expect(can(a).orders.createDraft(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(a.orders.createDraft).not.toHaveBeenCalled();
  });

  it('updates a draft by reference with its whole contents', async () => {
    const a = adapter();
    await can(a).orders.updateDraft({ ...draft, customerId: 'c1', order: ref });
    expect(a.orders.updateDraft).toHaveBeenCalledWith(
      ref,
      expect.objectContaining({ customerId: 'c1', email: 'ada@example.com' }),
    );
  });

  it('chooses a rate, lists payment methods, places and discards', async () => {
    const a = adapter();
    const caller = can(a);
    await caller.orders.selectShippingRate({
      order: ref,
      fulfillment: { id: '5', number: 'H1' },
      rateId: '267',
    });
    expect(a.orders.selectShippingRate).toHaveBeenCalledWith(ref, { id: '5', number: 'H1' }, '267');
    expect(await caller.orders.paymentMethods({ order: ref })).toEqual([
      { id: '3', name: 'Check', description: null },
    ]);
    await caller.orders.place({ order: ref, payment: { methodId: '3', markPaid: true } });
    expect(a.orders.place).toHaveBeenCalledWith(ref, { payment: { methodId: '3', markPaid: true } });
    await caller.orders.place({ order: ref, payment: null });
    expect(a.orders.place).toHaveBeenLastCalledWith(ref, { payment: null });
    expect(await caller.orders.discardDraft({ order: ref })).toEqual({ discarded: order.number });
    expect(a.orders.discardDraft).toHaveBeenCalledWith(ref);
  });

  it("passes the store's refusal through with its kind", async () => {
    const a = adapter({
      place: async () => {
        throw new SpreeError({ kind: 'invalid', status: 422, message: 'Denim Shirt is out of stock.' });
      },
    });
    await expect(can(a).orders.place({ order: ref, payment: null })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Denim Shirt is out of stock.',
    });
  });
});

describe('resources (host-described admin types)', () => {
  const reason = {
    id: '4',
    title: 'Damaged',
    subtitle: null,
    values: { name: 'Damaged' },
    actions: ['retire'],
  };
  function withResources() {
    const resources = {
      manifest: vi.fn(async () => []),
      list: vi.fn(async () => ({ items: [reason], nextCursor: null, totalCount: 1 })),
      get: vi.fn(async () => reason),
      create: vi.fn(async () => reason),
      update: vi.fn(async () => reason),
      remove: vi.fn(async () => undefined),
      perform: vi.fn(async () => ({ record: reason, message: 'Retired.' })),
    };
    return { a: { ...adapter(), resources } as SpreeAdapter, resources };
  }

  it('needs admin.resources, explained in plain words', async () => {
    const { a, resources } = withResources();
    const caller = createCaller(ctx(['orders.read'], a));
    await expect(caller.resources.manifest()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringMatching(/admin types/),
    });
    await expect(caller.resources.create({ key: 'menus', values: {} })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(resources.manifest).not.toHaveBeenCalled();
    expect(resources.create).not.toHaveBeenCalled();
  });

  it('lists with trimmed search, set filters and defaults', async () => {
    const { a, resources } = withResources();
    const caller = createCaller(ctx(['admin.resources'], a));
    await caller.resources.list({ key: 'refund_reasons' });
    expect(resources.list).toHaveBeenCalledWith('refund_reasons', { perPage: 25, cursor: null });
    await caller.resources.list({
      key: 'refund_reasons',
      query: '  zebra ',
      filters: { active: false, kind: null, status: '' },
      cursor: '2',
    });
    expect(resources.list).toHaveBeenLastCalledWith('refund_reasons', {
      perPage: 25,
      cursor: '2',
      query: 'zebra',
      filters: { active: false },
    });
  });

  it('passes values through and validates keys, ids and action names', async () => {
    const { a, resources } = withResources();
    const caller = createCaller(ctx(['admin.resources'], a));
    const values = { name: 'Wrong size', active: true, position: 3, meta: '{"a":1}', country_id: '12' };
    await caller.resources.create({ key: 'refund_reasons', values });
    expect(resources.create).toHaveBeenCalledWith('refund_reasons', values);
    await caller.resources.update({ key: 'refund_reasons', id: '4', values: { name: 'Damaged box' } });
    expect(resources.update).toHaveBeenCalledWith('refund_reasons', '4', { name: 'Damaged box' });
    expect(await caller.resources.perform({ key: 'refund_reasons', id: '4', action: 'retire' })).toEqual({
      record: reason,
      message: 'Retired.',
    });
    await caller.resources.remove({ key: 'refund_reasons', id: 'zone_12' });
    expect(resources.remove).toHaveBeenCalledWith('refund_reasons', 'zone_12');
    for (const bad of [
      caller.resources.get({ key: '../orders', id: '4' }),
      caller.resources.get({ key: 'refund_reasons', id: '4/../5' }),
      caller.resources.perform({ key: 'refund_reasons', id: '4', action: 'a b' }),
      caller.resources.update({ key: 'refund_reasons', id: '4', values: { 'bad key': 1 } }),
    ])
      await expect(bad).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(resources.get).not.toHaveBeenCalled();
  });

  it("keeps the store's per-field errors for the form", async () => {
    const { a, resources } = withResources();
    resources.update.mockRejectedValueOnce(
      new SpreeError({
        kind: 'invalid',
        status: 422,
        message: "Name can't be blank",
        fieldErrors: { name: ["can't be blank"] },
      }),
    );
    const client = createTRPCClient<AppRouter>({
      links: [localLink({ router: appRouter, createContext: async () => ctx(['admin.resources'], a) })],
    });
    const err = await client.resources.update
      .mutate({ key: 'refund_reasons', id: '4', values: { name: '' } })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      message: "Name can't be blank",
      data: { code: 'BAD_REQUEST', spreeKind: 'invalid', fieldErrors: { name: ["can't be blank"] } },
    });
  });
});
