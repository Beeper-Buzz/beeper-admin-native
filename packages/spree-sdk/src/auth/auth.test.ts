import { describe, expect, it, vi } from 'vitest';
import { createTransport, type FetchLike } from '../transport';
import { apiKeyAuth, oauthClientCredentials, oauthPasswordGrant, restoreAuth } from './index';

function recorder(...replies: { status: number; body: unknown }[]) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers });
    const r = replies.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

const token = (access: string, refresh = 'r1') => ({
  access_token: access,
  token_type: 'Bearer',
  expires_in: 7200,
  refresh_token: refresh,
  created_at: 1_764_150_000,
  scope: 'admin',
});

describe('oauthPasswordGrant (Platform API v2)', () => {
  it('signs in with the admin scope and sends a bearer token', async () => {
    const { fetch, calls } = recorder({ status: 200, body: token('a1') });
    const t = createTransport({ baseUrl: 'https://shop.test', fetch });
    const auth = await oauthPasswordGrant.signIn(t, { email: 'admin@example.com', password: 'spree123' });
    expect(calls[0]).toMatchObject({
      url: 'https://shop.test/spree_oauth/token',
      body: { grant_type: 'password', username: 'admin@example.com', password: 'spree123', scope: 'admin' },
    });
    expect(await auth.headers()).toEqual({ Authorization: 'Bearer a1' });
    expect(auth.serialize()).toMatchObject({
      method: 'oauthPassword',
      accessToken: 'a1',
      refreshToken: 'r1',
    });
  });

  it('refreshes with the refresh token and reports the new credential', async () => {
    const { fetch, calls } = recorder(
      { status: 200, body: token('a1') },
      { status: 200, body: token('a2', 'r2') },
    );
    const t = createTransport({ baseUrl: 'https://shop.test', fetch });
    const onChange = vi.fn();
    const auth = await oauthPasswordGrant.signIn(t, { email: 'a@b.c', password: 'x' }, { onChange });
    await auth.refresh?.();
    expect(calls[1]?.body).toEqual({ grant_type: 'refresh_token', refresh_token: 'r1' });
    expect(await auth.headers()).toEqual({ Authorization: 'Bearer a2' });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'a2', refreshToken: 'r2' }));
  });

  it('turns a rejected password into an "auth" error with Spree\'s message', async () => {
    const { fetch } = recorder({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'The provided authorization grant is invalid' },
    });
    const t = createTransport({ baseUrl: 'https://shop.test', fetch });
    await expect(oauthPasswordGrant.signIn(t, { email: 'a@b.c', password: 'bad' })).rejects.toMatchObject({
      kind: 'auth',
      message: 'Email or password is incorrect.',
    });
  });
});

describe('oauthClientCredentials (Platform API v2)', () => {
  it('requests a token and re-requests it on refresh', async () => {
    const { fetch, calls } = recorder({ status: 200, body: token('c1') }, { status: 200, body: token('c2') });
    const t = createTransport({ baseUrl: 'https://shop.test', fetch });
    const auth = await oauthClientCredentials.signIn(t, { clientId: 'id', clientSecret: 'secret' });
    await auth.refresh?.();
    expect(calls.map((c) => (c.body as { grant_type: string }).grant_type)).toEqual([
      'client_credentials',
      'client_credentials',
    ]);
    expect(await auth.headers()).toEqual({ Authorization: 'Bearer c2' });
  });
});

describe('apiKeyAuth (Admin API v3)', () => {
  it('sends X-Spree-Api-Key', async () => {
    const auth = apiKeyAuth('sk_test_123');
    expect(await auth.headers()).toEqual({ 'X-Spree-Api-Key': 'sk_test_123' });
    expect(auth.refresh).toBeUndefined();
  });
});

describe('restoreAuth', () => {
  it('rebuilds a strategy from a stored credential', async () => {
    const t = createTransport({ baseUrl: 'https://shop.test', fetch: recorder().fetch });
    const auth = restoreAuth(t, { method: 'apiKey', apiKey: 'sk_1' });
    expect(await auth.headers()).toEqual({ 'X-Spree-Api-Key': 'sk_1' });
    const pw = restoreAuth(t, {
      method: 'oauthPassword',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: null,
    });
    expect(await pw.headers()).toEqual({ Authorization: 'Bearer a' });
  });
});

describe('spreeTokenAuth (API v1)', () => {
  it('sends X-Spree-Token', async () => {
    const { spreeTokenAuth } = await import('./index');
    expect(await spreeTokenAuth('abc').headers()).toEqual({ 'X-Spree-Token': 'abc' });
  });
});

describe('adminJwt (Admin API v3)', () => {
  const login = (token: string, cookie: string) =>
    new Response(JSON.stringify({ token, user: { email: 'admin@example.com' } }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': `spree_admin_refresh_token=${cookie}; path=/api/v3/admin/auth; expires=Sat, 26 Dec 2026 13:45:57 GMT; httponly; samesite=lax`,
      },
    });

  it('logs in, keeps the refresh cookie and replays it on refresh', async () => {
    const { adminJwt } = await import('./index');
    const seen: { url: string; headers: Record<string, string>; credentials?: string }[] = [];
    const replies = [login('jwt1', 'c1'), login('jwt2', 'c2')];
    const fetch: FetchLike = async (url, init) => {
      seen.push({
        url,
        headers: init.headers,
        ...(init.credentials ? { credentials: init.credentials } : {}),
      });
      return replies.shift() as Response;
    };
    const t = createTransport({ baseUrl: 'http://localhost:3060', fetch });
    const onChange = vi.fn();
    const auth = await adminJwt.signIn(t, { email: 'admin@example.com', password: 'spree123' }, { onChange });
    expect(seen[0]).toMatchObject({
      url: 'http://localhost:3060/api/v3/admin/auth/login',
      credentials: 'include',
    });
    expect(auth.serialize()).toEqual({ method: 'adminJwt', accessToken: 'jwt1', refreshCookie: 'c1' });

    await auth.refresh?.();
    expect(seen[1]?.url).toBe('http://localhost:3060/api/v3/admin/auth/refresh');
    expect(seen[1]?.headers.Cookie).toBe('spree_admin_refresh_token=c1');
    expect(await auth.headers()).toEqual({ Authorization: 'Bearer jwt2' });
    expect(onChange).toHaveBeenCalledWith({ method: 'adminJwt', accessToken: 'jwt2', refreshCookie: 'c2' });
  });

  it('shares one refresh between concurrent callers (the cookie rotates)', async () => {
    const { adminJwt } = await import('./index');
    let refreshes = 0;
    const fetch: FetchLike = async (url) => {
      if (url.endsWith('/refresh')) refreshes++;
      return login(`jwt${refreshes}`, `c${refreshes}`);
    };
    const t = createTransport({ baseUrl: 'http://localhost:3060', fetch });
    const auth = adminJwt.restore(t, { method: 'adminJwt', accessToken: 'old', refreshCookie: 'c0' });
    await Promise.all([auth.refresh?.(), auth.refresh?.(), auth.refresh?.()]);
    expect(refreshes).toBe(1);
  });

  it('says the password is wrong on 401', async () => {
    const { adminJwt } = await import('./index');
    const fetch: FetchLike = async () =>
      new Response(
        JSON.stringify({ error: { code: 'authentication_failed', message: 'Invalid email or password' } }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      );
    const t = createTransport({ baseUrl: 'http://localhost:3060', fetch });
    await expect(adminJwt.signIn(t, { email: 'a@b.c', password: 'x' })).rejects.toMatchObject({
      kind: 'auth',
      message: 'Email or password is incorrect.',
    });
  });
});
