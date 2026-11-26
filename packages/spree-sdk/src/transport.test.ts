import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpreeError } from './errors';
import { encodeQuery } from './query';
import { createTransport, type FetchLike } from './transport';

type Reply = { status: number; body?: unknown; headers?: Record<string, string>; text?: string };

function fakeFetch(...replies: Reply[]) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = replies.shift() ?? { status: 200, body: {} };
    const text = r.text ?? (r.body === undefined ? '' : JSON.stringify(r.body));
    return new Response(r.status === 204 ? null : text, {
      status: r.status,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  };
  return { fn, calls };
}

afterEach(() => vi.useRealTimers());

describe('encodeQuery', () => {
  it('encodes nested filters and arrays the way Rails expects', () => {
    expect(
      encodeQuery({
        filter: { state_eq: 'complete' },
        include: 'line_items,shipments',
        page: 2,
        x: undefined,
      }),
    ).toBe('filter%5Bstate_eq%5D=complete&include=line_items%2Cshipments&page=2');
    expect(encodeQuery({ ids: ['1', '2'] })).toBe('ids%5B%5D=1&ids%5B%5D=2');
  });
});

describe('transport', () => {
  it('joins base URL and path, sends JSON headers and parses JSON', async () => {
    const { fn, calls } = fakeFetch({ status: 200, body: { data: [] } });
    const t = createTransport({ baseUrl: 'https://shop.test/', fetch: fn });
    const res = await t.request<{ data: unknown[] }>({ path: '/api/v2/platform/orders', query: { page: 1 } });
    expect(res.data).toEqual({ data: [] });
    expect(calls[0]?.url).toBe('https://shop.test/api/v2/platform/orders?page=1');
    expect(calls[0]?.init.headers).toMatchObject({ Accept: 'application/vnd.api+json, application/json' });
  });

  it('adds auth headers from the strategy', async () => {
    const { fn, calls } = fakeFetch({ status: 200, body: {} });
    const t = createTransport({
      baseUrl: 'https://shop.test',
      fetch: fn,
      auth: { headers: async () => ({ Authorization: 'Bearer abc' }) },
    });
    await t.request({ path: '/x' });
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'Bearer abc' });
  });

  it('skips auth headers when auth is "none"', async () => {
    const { fn, calls } = fakeFetch({ status: 200, body: {} });
    const t = createTransport({
      baseUrl: 'https://shop.test',
      fetch: fn,
      auth: { headers: async () => ({ Authorization: 'Bearer abc' }) },
    });
    await t.request({ path: '/x', auth: 'none' });
    expect(calls[0]?.init.headers).not.toHaveProperty('Authorization');
  });

  it('refreshes once on 401 then retries', async () => {
    const { fn, calls } = fakeFetch(
      { status: 401, body: { error: 'expired' } },
      { status: 200, body: { ok: true } },
    );
    let token = 'old';
    const t = createTransport({
      baseUrl: 'https://shop.test',
      fetch: fn,
      auth: {
        headers: async () => ({ Authorization: `Bearer ${token}` }),
        refresh: async () => {
          token = 'new';
        },
      },
    });
    const res = await t.request({ path: '/x' });
    expect(res.data).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.init.headers).toMatchObject({ Authorization: 'Bearer new' });
  });

  it('gives up with kind "auth" after one failed refresh', async () => {
    const { fn } = fakeFetch({ status: 401 }, { status: 401, body: { error: 'Invalid token' } });
    const t = createTransport({
      baseUrl: 'https://shop.test',
      fetch: fn,
      auth: { headers: async () => ({}), refresh: async () => {} },
    });
    await expect(t.request({ path: '/x' })).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
      message: 'Invalid token',
    });
  });

  it.each([
    [403, 'forbidden'],
    [404, 'notFound'],
    [409, 'conflict'],
    [400, 'invalid'],
    [500, 'server'],
    [503, 'server'],
  ] as const)('maps %i to %s', async (status, kind) => {
    const { fn } = fakeFetch({ status, body: {} });
    const t = createTransport({ baseUrl: 'https://shop.test', fetch: fn });
    await expect(t.request({ path: '/x' })).rejects.toMatchObject({ kind, status });
  });

  it('reads 422 field errors from Rails and JSON:API bodies', async () => {
    const { fn } = fakeFetch(
      { status: 422, body: { error: 'Invalid resource', errors: { tracking: ["can't be blank"] } } },
      {
        status: 422,
        body: { errors: [{ detail: 'is too long', source: { pointer: '/data/attributes/name' } }] },
      },
    );
    const t = createTransport({ baseUrl: 'https://shop.test', fetch: fn });
    await expect(t.request({ path: '/x' })).rejects.toMatchObject({
      kind: 'invalid',
      message: 'Invalid resource',
      fieldErrors: { tracking: ["can't be blank"] },
    });
    await expect(t.request({ path: '/x' })).rejects.toMatchObject({ fieldErrors: { name: ['is too long'] } });
  });

  it('reads Spree 6 { error: { code, message } } bodies', async () => {
    const { fn } = fakeFetch({
      status: 422,
      body: { error: { code: 'processing_error', message: "The coupon code you entered doesn't exist." } },
    });
    const t = createTransport({ baseUrl: 'https://shop.test', fetch: fn });
    await expect(t.request({ path: '/x' })).rejects.toMatchObject({
      kind: 'invalid',
      message: "The coupon code you entered doesn't exist.",
    });
  });

  it('carries Retry-After on 429', async () => {
    const { fn } = fakeFetch({ status: 429, headers: { 'retry-after': '7' } });
    const t = createTransport({ baseUrl: 'https://shop.test', fetch: fn });
    await expect(t.request({ path: '/x' })).rejects.toMatchObject({
      kind: 'rateLimited',
      retryAfterMs: 7000,
    });
  });

  it('reports network failures with status 0', async () => {
    const t = createTransport({
      baseUrl: 'https://shop.test',
      fetch: async () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(t.request({ path: '/x' })).rejects.toMatchObject({ kind: 'network', status: 0 });
  });

  it('times out', async () => {
    const t = createTransport({
      baseUrl: 'https://shop.test',
      timeoutMs: 50,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    });
    await expect(t.request({ path: '/x' })).rejects.toMatchObject({ kind: 'timeout', status: 0 });
  });

  it('reports a non-JSON 200 body as "parse"', async () => {
    const { fn } = fakeFetch({
      status: 200,
      text: '<html>Login</html>',
      headers: { 'content-type': 'text/html' },
    });
    const t = createTransport({ baseUrl: 'https://shop.test', fetch: fn });
    const err = await t.request({ path: '/x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpreeError);
    expect(err).toMatchObject({ kind: 'parse' });
  });

  it('returns null data for 204', async () => {
    const { fn } = fakeFetch({ status: 204 });
    const t = createTransport({ baseUrl: 'https://shop.test', fetch: fn });
    expect((await t.request({ method: 'DELETE', path: '/x' })).data).toBeNull();
  });

  it('sends JSON bodies', async () => {
    const { fn, calls } = fakeFetch({ status: 200, body: {} });
    const t = createTransport({ baseUrl: 'https://shop.test', fetch: fn });
    await t.request({ method: 'PATCH', path: '/x', body: { a: 1 } });
    expect(calls[0]?.init).toMatchObject({ method: 'PATCH', body: '{"a":1}' });
    expect(calls[0]?.init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });
});
