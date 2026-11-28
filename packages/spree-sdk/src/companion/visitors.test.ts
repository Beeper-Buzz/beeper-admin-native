import { describe, expect, it } from 'vitest';
import { fakeTransport } from '../adapters/fakeTransport.test-helper';
import { companionCarts, companionVisitors, mapGemCart, mapGemSession } from './visitors';

/** The spec's shapes (docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md §3). */
const cart = {
  number: 'R100',
  state: 'address',
  email: 'ada@example.com',
  user_id: 3,
  item_count: 2,
  total: '49.00',
  currency: 'USD',
  updated_at: '2026-11-28T10:00:00Z',
  abandoned: true,
  items: [{ name: 'Tote', variant_sku: 'TOTE-1', quantity: 2, image_url: 'https://shop.test/t.jpg' }],
};
const session = {
  id: 55,
  contact: { id: '7', name: 'Ada', email: 'ada@example.com' },
  user_id: null,
  current_url: 'https://shop.test/t/bags',
  current_title: 'Bags',
  referrer: 'https://search.example.com',
  utm: { source: 'newsletter', medium: 'email', campaign: 'winter' },
  device: 'mobile',
  country: 'DE',
  started_at: '2026-11-28T09:50:00Z',
  last_seen_at: '2026-11-28T10:00:00Z',
  online: true,
  page_views: 4,
  cart: { order_number: 'R100', item_count: 2, total: 49, currency: 'USD' },
  conversation_id: null,
};

describe('carts', () => {
  it('maps a cart', () => {
    expect(mapGemCart(cart)).toEqual({
      number: 'R100',
      state: 'address',
      email: 'ada@example.com',
      userId: '3',
      itemCount: 2,
      total: { amount: '49.00', currency: 'USD' },
      updatedAt: '2026-11-28T10:00:00Z',
      abandoned: true,
      items: [{ name: 'Tote', variantSku: 'TOTE-1', quantity: 2, imageUrl: 'https://shop.test/t.jpg' }],
    });
    expect(mapGemCart({ total: '1' })).toBeNull();
    expect(mapGemCart({ ...cart, total: 'lots' })?.total).toBeNull();
  });

  it('lists active and abandoned carts and gets one', async () => {
    const { transport, calls } = fakeTransport((_m, url) =>
      url.includes('/carts/')
        ? { data: cart }
        : { data: [cart], meta: { page: 1, per_page: 25, total_count: 1 } },
    );
    const carts = companionCarts(transport);
    const page = await carts.list({ activeWithin: 60 });
    expect(page).toMatchObject({ nextCursor: null, totalCount: 1 });
    await carts.list({ withEmail: true, cursor: '2' });
    await carts.list({ abandoned: false });
    expect((await carts.get('R100')).number).toBe('R100');
    expect(calls.map((c) => c.url)).toEqual([
      '/api/admin_native/v1/carts?page=1&per_page=25&active_within=60',
      '/api/admin_native/v1/carts?page=2&per_page=25&with_email=true',
      '/api/admin_native/v1/carts?page=1&per_page=25&abandoned=false',
      '/api/admin_native/v1/carts/R100',
    ]);
  });
});

describe('visitors', () => {
  it('maps a session', () => {
    expect(mapGemSession(session)).toMatchObject({
      id: '55',
      device: 'mobile',
      online: true,
      pageViews: 4,
      utm: { source: 'newsletter', medium: 'email', campaign: 'winter' },
      cart: { orderNumber: 'R100', itemCount: 2, total: { amount: '49.00', currency: 'USD' } },
      conversationId: null,
    });
  });

  it('lists online sessions, gets one with its pages and starts a conversation', async () => {
    const { transport, calls } = fakeTransport((method, url) => {
      if (method === 'POST') return { conversation_id: 12 };
      if (url.startsWith('/api/admin_native/v1/visitors/55'))
        return {
          data: { ...session, pages: [{ url: 'https://shop.test/', title: 'Home', at: null }, 'bad'] },
        };
      return { data: [session], meta: { page: 1, per_page: 25, total_count: 1 } };
    });
    const visitors = companionVisitors(transport);
    expect((await visitors.list({ online: true })).items).toHaveLength(1);
    expect((await visitors.get('55')).pages).toEqual([
      { url: 'https://shop.test/', title: 'Home', at: null },
    ]);
    expect(await visitors.startConversation('55')).toEqual({ conversationId: '12' });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', '/api/admin_native/v1/visitors?page=1&per_page=25&online=true'],
      ['GET', '/api/admin_native/v1/visitors/55'],
      ['POST', '/api/admin_native/v1/visitors/55/conversation'],
    ]);
  });
});
