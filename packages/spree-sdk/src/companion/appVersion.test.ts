import { describe, expect, it, vi } from 'vitest';
import fixtures from '../../test/fixtures/app-version-0.6.json';
import { probeStore } from '../capabilities';
import { createTransport, type FetchLike } from '../transport';
import { APP_VERSION_TIMEOUT_MS, parseAppVersion } from './appVersion';
import { companion } from './index';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A companion client whose transport carries auth, as the app's does after sign-in. */
function gem(fetch: FetchLike) {
  const auth = { headers: async () => ({ 'X-Spree-Token': 'secret' }) };
  return companion(createTransport({ baseUrl: 'https://shop.test', fetch, auth }));
}

describe('parseAppVersion', () => {
  it('maps the gem payload', () => {
    expect(parseAppVersion(fixtures.required)).toEqual({
      minimumVersion: '1.0.0',
      recommendedVersion: '1.1.0',
      updateUrl: 'https://apps.apple.com/app/id123',
      updateRequired: true,
      updateRecommended: true,
    });
  });

  it('reads nothing set as nulls and false', () => {
    expect(parseAppVersion(fixtures.unset)).toEqual({
      minimumVersion: null,
      recommendedVersion: null,
      updateUrl: null,
      updateRequired: false,
      updateRecommended: false,
    });
  });

  it('keeps a 0.0.0 minimum as the gem sends it (the app reads it as none)', () => {
    expect(parseAppVersion(fixtures.noMinimum)).toMatchObject({
      minimumVersion: '0.0.0',
      updateRequired: false,
    });
  });

  it('reads blank and missing fields as none, so an older gem without the booleans still parses', () => {
    expect(parseAppVersion({ data: { minimum_version: ' ', recommended_version: '1.2' } })).toEqual({
      minimumVersion: null,
      recommendedVersion: '1.2',
      updateUrl: null,
      updateRequired: false,
      updateRecommended: false,
    });
  });

  it('drops a link that is not https', () => {
    for (const url of ['http://apps.apple.com/app/id1', 'javascript:alert(1)', 'not a url']) {
      expect(parseAppVersion({ data: { update_url: url } })?.updateUrl).toBeNull();
    }
  });

  it('refuses a payload of the wrong shape', () => {
    expect(parseAppVersion(null)).toBeNull();
    expect(parseAppVersion({})).toBeNull();
    expect(parseAppVersion({ data: [] })).toBeNull();
    expect(parseAppVersion({ data: { minimum_version: 1 } })).toBeNull();
    expect(parseAppVersion({ data: { update_required: 'yes' } })).toBeNull();
  });
});

describe('companion appVersion', () => {
  it('asks for the platform and version without auth, with a 5 s timeout', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, headers: init.headers });
      return json(200, fixtures.recommended);
    };
    const res = await gem(fetch).appVersion('ios', '1.0.0');
    expect(res).toMatchObject({ recommendedVersion: '1.1.0', updateRecommended: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://shop.test/api/admin_native/v1/app_version?platform=ios&version=1.0.0',
    );
    expect(calls[0]?.headers).not.toHaveProperty('X-Spree-Token');
    expect(APP_VERSION_TIMEOUT_MS).toBe(5000);
  });

  it('leaves out a missing version', async () => {
    const urls: string[] = [];
    await gem(async (url) => {
      urls.push(url);
      return json(200, fixtures.withoutVersion);
    }).appVersion('android', null);
    expect(urls[0]).toBe('https://shop.test/api/admin_native/v1/app_version?platform=android');
  });

  it('returns null on a network failure', async () => {
    const res = await gem(async () => {
      throw new TypeError('Network request failed');
    }).appVersion('ios', '1.0.0');
    expect(res).toBeNull();
  });

  it('returns null on an error status (an older gem 404s)', async () => {
    expect(await gem(async () => json(404, { error: 'not found' })).appVersion('ios', '1.0.0')).toBeNull();
    expect(await gem(async () => json(500, { error: 'boom' })).appVersion('ios', '1.0.0')).toBeNull();
    expect(await gem(async () => json(429, {})).appVersion('ios', '1.0.0')).toBeNull();
  });

  it('returns null on a body that is not JSON or not the payload', async () => {
    expect(await gem(async () => new Response('<html>', { status: 200 })).appVersion('ios', '1')).toBeNull();
    expect(await gem(async () => json(200, { minimum_version: '1.0.0' })).appVersion('ios', '1')).toBeNull();
  });

  it('returns null after 5 s without an answer', async () => {
    vi.useFakeTimers();
    try {
      const fetch: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      const pending = gem(fetch).appVersion('ios', '1.0.0');
      await vi.advanceTimersByTimeAsync(APP_VERSION_TIMEOUT_MS);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('probe', () => {
  it('keeps app.versionGate from the gem capabilities', async () => {
    const fetch: FetchLike = async (url) =>
      url.includes('/api/admin_native/v1/capabilities') ? json(200, fixtures.capabilities) : json(404, {});
    const probe = await probeStore({ baseUrl: 'https://shop.test', fetch });
    expect(probe.capabilities).toContain('app.versionGate');
  });
});
