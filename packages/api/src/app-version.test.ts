import {
  type CompanionPort,
  companion,
  createTransport,
  type FetchLike,
  type SpreeAdapter,
  type StoreProbe,
  unsupportedCustomers,
  unsupportedMedia,
  unsupportedProducts,
  unsupportedPromotions,
  unsupportedResources,
} from '@instincts/spree-sdk';
import { describe, expect, it, vi } from 'vitest';
import fixtures from '../../spree-sdk/test/fixtures/app-version-0.6.json';
import { createCaller } from './router';
import type { Context } from './trpc';

const probe = (capabilities: string[]): StoreProbe => ({
  baseUrl: 'https://shop.test',
  apiFamilies: ['api-v1'],
  preferredApi: 'api-v1',
  capabilities: capabilities as StoreProbe['capabilities'],
  authMethods: ['spreeToken'],
  storeName: 'Shop',
  currency: 'USD',
  spreeVersion: '4.2.7',
  gem: { version: '0.6.0' },
  probedAt: '2026-11-28T00:00:00Z',
});

function ctx(capabilities: string[], gem?: CompanionPort): Context {
  const adapter: SpreeAdapter = {
    family: 'api-v1',
    orders: {} as SpreeAdapter['orders'],
    products: unsupportedProducts,
    customers: unsupportedCustomers,
    promotions: unsupportedPromotions,
    media: unsupportedMedia,
    resources: unsupportedResources,
    ...(gem ? { companion: gem } : {}),
  };
  return { session: { probe: probe(capabilities), adapter } };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('app.version', () => {
  it('reads the store gate through the companion gem', async () => {
    const urls: string[] = [];
    const fetch: FetchLike = async (url) => {
      urls.push(url);
      return json(fixtures.required);
    };
    const gem = companion(createTransport({ baseUrl: 'https://shop.test', fetch }));
    const res = await createCaller(ctx(['app.versionGate'], gem)).app.version({
      platform: 'ios',
      version: '0.9.0',
    });
    expect(res).toEqual({
      minimumVersion: '1.0.0',
      recommendedVersion: '1.1.0',
      updateUrl: 'https://apps.apple.com/app/id123',
      updateRequired: true,
      updateRecommended: true,
    });
    expect(urls).toEqual(['https://shop.test/api/admin_native/v1/app_version?platform=ios&version=0.9.0']);
  });

  it('makes no call without the capability', async () => {
    const appVersion = vi.fn(async () => null);
    const gem = { appVersion } as unknown as CompanionPort;
    expect(await createCaller(ctx([], gem)).app.version({ platform: 'ios', version: '1.0.0' })).toBeNull();
    expect(appVersion).not.toHaveBeenCalled();
  });

  it('is null without the companion gem', async () => {
    expect(
      await createCaller(ctx(['app.versionGate'])).app.version({ platform: 'ios', version: '1.0.0' }),
    ).toBeNull();
  });

  it('fails open when the store fails', async () => {
    const gem = companion(
      createTransport({ baseUrl: 'https://shop.test', fetch: async () => json({}, 500) }),
    );
    expect(
      await createCaller(ctx(['app.versionGate'], gem)).app.version({ platform: 'ios', version: null }),
    ).toBeNull();
  });

  it('needs a connected store', async () => {
    await expect(
      createCaller({ session: null }).app.version({ platform: 'ios', version: '1.0.0' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
