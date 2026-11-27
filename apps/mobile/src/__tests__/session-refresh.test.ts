import type { StoreProbe } from '@instincts/spree-sdk';
import { refreshedProbe } from '@/session/session';

const stored: StoreProbe = {
  baseUrl: 'https://admin.example.com',
  apiFamilies: ['api-v1'],
  preferredApi: 'api-v1',
  capabilities: ['orders.read', 'orders.capture'],
  authMethods: ['spreeToken'],
  storeName: 'Example',
  currency: 'USD',
  spreeVersion: '4.2.5',
  gem: null,
  probedAt: '2026-11-01T00:00:00Z',
};

describe('refreshedProbe', () => {
  it('adopts new capabilities after a gem install', () => {
    const fresh: StoreProbe = {
      ...stored,
      capabilities: ['orders.read', 'orders.capture', 'orders.refund', 'analytics.summary'],
      authMethods: ['pairing', 'spreeToken'],
      gem: { version: '0.2.0' },
      probedAt: '2026-11-27T00:00:00Z',
    };
    expect(refreshedProbe(stored, fresh)).toEqual(fresh);
  });

  it('keeps the stored probe when nothing that matters changed', () => {
    expect(
      refreshedProbe(stored, {
        ...stored,
        capabilities: ['orders.capture', 'orders.read'],
        probedAt: 'later',
      }),
    ).toBeNull();
  });

  it('never switches API family without a new sign-in', () => {
    expect(
      refreshedProbe(stored, { ...stored, preferredApi: 'admin-v3', capabilities: ['orders.refund'] }),
    ).toBeNull();
  });

  it('keeps the address the user connected with', () => {
    const fresh = { ...stored, baseUrl: 'https://admin.example.com/', gem: { version: '0.2.0' } };
    expect(refreshedProbe(stored, fresh)?.baseUrl).toBe('https://admin.example.com');
  });
});
