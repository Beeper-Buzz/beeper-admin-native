import { describe, expect, it } from 'vitest';
import { createTransport, type FetchLike } from '../transport';
import { companion, exchangePairingCode, parsePairingPayload } from './index';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('parsePairingPayload', () => {
  it('reads the store and code from a scanned QR', () => {
    expect(parsePairingPayload('http://localhost:3042/api/admin_native/v1/pair?code=ABCDEFGHJKMN')).toEqual({
      url: 'http://localhost:3042',
      code: 'ABCDEFGHJKMN',
    });
  });
  it('ignores other QR codes', () => {
    expect(parsePairingPayload('https://example.com/menu')).toBeNull();
    expect(parsePairingPayload('not a url')).toBeNull();
  });
});

describe('companion client', () => {
  it('exchanges a code for a device token', async () => {
    const calls: unknown[] = [];
    const fetch: FetchLike = async (_url, init) => {
      calls.push(JSON.parse(String(init.body ?? '{}')));
      return json(201, {
        token: 'san_x',
        device: { id: '1', name: 'iPhone', platform: 'ios' },
        user: { email: 'a@b.c' },
      });
    };
    const t = createTransport({ baseUrl: 'http://shop.test', fetch });
    const res = await exchangePairingCode(t, {
      code: 'ABCD-EFGH-JKMN',
      deviceName: 'iPhone',
      platform: 'ios',
    });
    expect(res.token).toBe('san_x');
    expect(calls[0]).toEqual({ code: 'ABCD-EFGH-JKMN', device_name: 'iPhone', platform: 'ios' });
  });

  it('passes on the gem message for a bad code', async () => {
    const fetch: FetchLike = async () =>
      json(422, {
        error: {
          code: 'invalid_code',
          message: 'This pairing code is wrong, used or expired. Create a new one in Spree admin.',
        },
      });
    const t = createTransport({ baseUrl: 'http://shop.test', fetch });
    await expect(exchangePairingCode(t, { code: 'X', deviceName: 'd' })).rejects.toMatchObject({
      kind: 'invalid',
      status: 422,
    });
  });

  it('maps the summary into domain money', async () => {
    const fetch: FetchLike = async () =>
      json(200, {
        currency: 'USD',
        time_zone: 'UTC',
        today: { orders: 3, sales: '412.5' },
        orders_to_fulfill: 9,
        payments_due: 6,
        low_stock_variants: 1,
        generated_at: '2026-11-26T15:00:00Z',
      });
    const s = await companion(createTransport({ baseUrl: 'http://shop.test', fetch })).summary();
    expect(s).toMatchObject({
      today: { orders: 3, sales: { amount: '412.50', currency: 'USD' } },
      ordersToFulfill: 9,
    });
  });

  it('lists manual payment methods and deletes a draft by number (gem 0.3)', async () => {
    const calls: [string, string][] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push([init.method ?? 'GET', String(url)]);
      return init.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : json(200, { data: [{ id: '3', name: 'Check', description: '' }] });
    };
    const gem = companion(createTransport({ baseUrl: 'http://shop.test', fetch }));
    expect(await gem.manualPaymentMethods()).toEqual([{ id: '3', name: 'Check', description: null }]);
    await gem.discardDraft('R123');
    expect(calls).toEqual([
      ['GET', 'http://shop.test/api/admin_native/v1/payment_methods'],
      ['DELETE', 'http://shop.test/api/admin_native/v1/orders/R123'],
    ]);
  });
});
