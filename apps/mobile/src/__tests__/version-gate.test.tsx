import type { Session } from '@instincts/spree-api';
import {
  type AppVersionInfo,
  type CompanionPort,
  unsupportedCarts,
  unsupportedCustomers,
  unsupportedInbox,
  unsupportedMedia,
  unsupportedProducts,
  unsupportedPromotions,
  unsupportedResources,
  unsupportedVisitors,
} from '@instincts/spree-sdk';
import * as Sentry from '@sentry/react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AppState, type AppStateStatus, Linking, Text } from 'react-native';
import { AppThemeProvider } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';
import { evaluateGate, fallbackStoreUrl, isTabRoot } from '@/version-gate/gate';
import { resetPromptedForTests, SNOOZE_MS } from '@/version-gate/snooze';
import { FOREGROUND_CHECK_INTERVAL_MS, type GateStore } from '@/version-gate/use-version-gate';
import { VersionGate } from '@/version-gate/version-gate';

let mockInstalled: string | null = '1.0.0';
jest.mock('@/version-gate/installed-version', () => ({ installedVersion: () => mockInstalled }));

let mockPathname = '/';
jest.mock('expo-router', () => ({ usePathname: () => mockPathname }));

const mockDistribution: { name: string; storeUrls?: { ios?: string; android?: string } } = {
  name: 'Spree Admin',
};
// A getter: the factory runs when the gate's modules are imported, before this file's consts exist.
jest.mock('@/distribution', () => ({
  get distribution() {
    return mockDistribution;
  },
}));

const STORE_LINK = 'https://apps.apple.com/app/id123';
const FALLBACK_LINK = 'https://apps.apple.com/app/id999';

const info = (over: Partial<AppVersionInfo> = {}): AppVersionInfo => ({
  minimumVersion: null,
  recommendedVersion: null,
  updateUrl: STORE_LINK,
  updateRequired: false,
  updateRecommended: false,
  ...over,
});

function session(appVersion: CompanionPort['appVersion'], capabilities = ['orders.read', 'app.versionGate']) {
  const s: Session = {
    probe: {
      baseUrl: 'https://shop.test',
      apiFamilies: ['api-v1'],
      preferredApi: 'api-v1',
      capabilities: capabilities as Session['probe']['capabilities'],
      authMethods: ['spreeToken'],
      storeName: 'Northwind',
      currency: 'USD',
      spreeVersion: '4.2.7',
      gem: { version: '0.6.0' },
      probedAt: '2026-11-28T00:00:00Z',
    },
    adapter: {
      family: 'api-v1',
      orders: {} as Session['adapter']['orders'],
      products: unsupportedProducts,
      customers: unsupportedCustomers,
      promotions: unsupportedPromotions,
      media: unsupportedMedia,
      resources: unsupportedResources,
      inbox: unsupportedInbox,
      carts: unsupportedCarts,
      visitors: unsupportedVisitors,
      companion: { appVersion } as unknown as CompanionPort,
    },
  };
  return s;
}

const gateStore = (s: Session, id = 'shop.test'): GateStore => ({ id, capabilities: s.probe.capabilities });

function tree(s: Session | null, store: GateStore | null, onSwitchStore = jest.fn()) {
  return (
    <AppThemeProvider>
      <ApiProvider session={s}>
        <VersionGate store={store} storeName={s?.probe.storeName ?? null} onSwitchStore={onSwitchStore}>
          <Text>Tabs</Text>
        </VersionGate>
      </ApiProvider>
    </AppThemeProvider>
  );
}

/** Captures the AppState listener so tests can send the app to the background and back. */
function captureAppState() {
  const listeners: ((s: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener as (s: AppStateStatus) => void);
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
  return async (state: AppStateStatus) => {
    await act(async () => {
      for (const l of listeners) l(state);
    });
  };
}

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

let now = Date.parse('2026-11-28T09:00:00Z');
beforeEach(async () => {
  mockInstalled = '1.0.0';
  mockPathname = '/';
  mockDistribution.storeUrls = undefined;
  now = Date.parse('2026-11-28T09:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  resetPromptedForTests();
  for (const id of ['shop.test', 'other.test']) await SecureStore.deleteItemAsync(`versionGate.snooze.${id}`);
});
afterEach(() => jest.restoreAllMocks());

describe('evaluateGate', () => {
  it('requires below the minimum, and that wins over recommended', () => {
    expect(
      evaluateGate('s', info({ minimumVersion: '1.1', recommendedVersion: '1.2.0' }), '1.0.9', null),
    ).toEqual({
      status: 'required',
      installed: '1.0.9',
      minimum: '1.1',
      updateUrl: STORE_LINK,
    });
  });

  it('recommends between the minimum and the recommended version', () => {
    expect(
      evaluateGate('s', info({ minimumVersion: '1.0.0', recommendedVersion: '1.2.0' }), '1.1.0', null),
    ).toMatchObject({ status: 'recommended', recommended: '1.2.0' });
  });

  it('compares itself, so a gem without the booleans still gates', () => {
    expect(evaluateGate('s', info({ minimumVersion: '2.0.0' }), '1.9.9', null).status).toBe('required');
    expect(
      evaluateGate('s', info({ minimumVersion: '1.0.0', updateRequired: true }), '1.0.0', null).status,
    ).toBe('none');
  });

  it("takes the store's word only when the app can't read a version", () => {
    expect(
      evaluateGate('s', info({ minimumVersion: '1.0.0', updateRequired: true }), null, null).status,
    ).toBe('required');
    expect(evaluateGate('s', info({ minimumVersion: '1.0.0' }), null, null).status).toBe('none');
  });

  it('shows Update required when the gem says both required and recommended', () => {
    const both = info({
      minimumVersion: '1.0.0',
      recommendedVersion: '1.1.0',
      updateRequired: true,
      updateRecommended: true,
    });
    expect(evaluateGate('s', both, '0.9.0', null).status).toBe('required');
  });

  it('reads 0.0.0 as no minimum and nothing set as no gate', () => {
    expect(evaluateGate('s', info({ minimumVersion: '0.0.0' }), '0.0.0', null).status).toBe('none');
    expect(evaluateGate('s', info(), '0.1.0', null).status).toBe('none');
  });

  it('agrees with the gem on versions neither can read: no gate', () => {
    for (const installed of ['v0.9.0', '0.9.0.1']) {
      expect(
        evaluateGate('s', info({ minimumVersion: '1.0.0', recommendedVersion: '1.1.0' }), installed, null),
      ).toEqual({ status: 'none' });
    }
  });

  it("falls back to the distribution's listing", () => {
    const gate = evaluateGate(
      's',
      info({ minimumVersion: '2.0.0', updateUrl: null }),
      '1.0.0',
      FALLBACK_LINK,
    );
    expect(gate).toMatchObject({ updateUrl: FALLBACK_LINK });
    expect(fallbackStoreUrl({ ios: FALLBACK_LINK }, 'ios')).toBe(FALLBACK_LINK);
    expect(fallbackStoreUrl({ ios: FALLBACK_LINK }, 'android')).toBeNull();
    expect(fallbackStoreUrl(undefined, 'ios')).toBeNull();
  });

  it('knows a tab root from a pushed screen or a form sheet', () => {
    for (const p of ['/', '/orders', '/more']) expect(isTabRoot(p)).toBe(true);
    for (const p of ['/orders/ship', '/orders/R123', '/more/admin/pick', ''])
      expect(isTabRoot(p)).toBe(false);
  });
});

describe('the version check', () => {
  it('checks at launch with the platform and installed version, without waiting to show the app', async () => {
    const appVersion = jest.fn(async () => info());
    const s = session(appVersion);
    await render(tree(s, gateStore(s)));
    expect(screen.getByText('Tabs')).toBeTruthy();
    await waitFor(() => expect(appVersion).toHaveBeenCalledWith('ios', '1.0.0'));
    expect(appVersion).toHaveBeenCalledTimes(1);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'version-gate',
        data: expect.objectContaining({ reason: 'launch' }),
      }),
    );
  });

  it('makes no call when the store lacks app.versionGate', async () => {
    const appVersion = jest.fn(async () => info({ minimumVersion: '9.0.0' }));
    const s = session(appVersion, ['orders.read']);
    await render(tree(s, gateStore(s)));
    await flush();
    expect(appVersion).not.toHaveBeenCalled();
    expect(screen.getByText('Tabs')).toBeTruthy();
  });

  it('checks after sign-in', async () => {
    const appVersion = jest.fn(async () => info({ minimumVersion: '2.0.0' }));
    const s = session(appVersion);
    const view = await render(tree(null, null));
    await flush();
    expect(appVersion).not.toHaveBeenCalled();
    await view.rerender(tree(s, gateStore(s)));
    expect(await screen.findByText('Update required')).toBeTruthy();
    expect(appVersion).toHaveBeenCalledTimes(1);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: 'sign-in' }) }),
    );
  });

  it('checks again on returning to the foreground, at most every 30 minutes', async () => {
    const emit = captureAppState();
    const appVersion = jest.fn(async () => info());
    const s = session(appVersion);
    await render(tree(s, gateStore(s)));
    await waitFor(() => expect(appVersion).toHaveBeenCalledTimes(1));

    now += 10 * 60 * 1000;
    await emit('background');
    await emit('active');
    expect(appVersion).toHaveBeenCalledTimes(1);

    now += FOREGROUND_CHECK_INTERVAL_MS;
    await emit('background');
    await emit('active');
    await waitFor(() => expect(appVersion).toHaveBeenCalledTimes(2));

    // Already active (e.g. a second 'active' event) is not a return to the foreground.
    now += FOREGROUND_CHECK_INTERVAL_MS;
    await emit('active');
    await flush();
    expect(appVersion).toHaveBeenCalledTimes(2);
  });

  it('closes the gate when a foreground check finds the minimum lowered', async () => {
    const emit = captureAppState();
    const appVersion = jest
      .fn<Promise<AppVersionInfo | null>, [string, string | null | undefined]>()
      .mockResolvedValueOnce(info({ minimumVersion: '2.0.0' }))
      .mockResolvedValueOnce(info({ minimumVersion: '1.0.0' }));
    const s = session(appVersion);
    await render(tree(s, gateStore(s)));
    expect(await screen.findByText('Update required')).toBeTruthy();
    now += FOREGROUND_CHECK_INTERVAL_MS;
    await emit('background');
    await emit('active');
    expect(await screen.findByText('Tabs')).toBeTruthy();
    expect(screen.queryByText('Update required')).toBeNull();
  });

  it('fails open when the check fails', async () => {
    const appVersion = jest.fn(async () => null);
    const s = session(appVersion);
    await render(tree(s, gateStore(s)));
    await waitFor(() => expect(appVersion).toHaveBeenCalled());
    await flush();
    expect(screen.getByText('Tabs')).toBeTruthy();
    expect(screen.queryByText('Update required')).toBeNull();
  });

  it('fails open when the client throws', async () => {
    const appVersion = jest.fn(async () => {
      throw new Error('boom');
    });
    const s = session(appVersion);
    await render(tree(s, gateStore(s)));
    await waitFor(() => expect(appVersion).toHaveBeenCalled());
    await flush();
    expect(screen.getByText('Tabs')).toBeTruthy();
  });
});

describe('Update required', () => {
  const required = async (over: Partial<AppVersionInfo> = {}, onSwitchStore = jest.fn()) => {
    const s = session(jest.fn(async () => info({ minimumVersion: '1.2.0', ...over })));
    await render(tree(s, gateStore(s), onSwitchStore));
    expect(await screen.findByText('Update required')).toBeTruthy();
    return onSwitchStore;
  };

  it('covers the app and shows the installed and minimum versions', async () => {
    await required();
    expect(screen.queryByText('Tabs')).toBeNull();
    expect(screen.getByLabelText('Installed: 1.0.0')).toBeTruthy();
    expect(screen.getByLabelText('Required: 1.2.0 or later')).toBeTruthy();
    expect(screen.getByText(/Northwind needs version 1\.2\.0 or later of Spree Admin/)).toBeTruthy();
  });

  it("Update opens the store's link", async () => {
    await required();
    await fireEvent.press(screen.getByText('Update'));
    expect(Linking.openURL).toHaveBeenCalledWith(STORE_LINK);
  });

  it("Update falls back to the distribution's store listing", async () => {
    mockDistribution.storeUrls = { ios: FALLBACK_LINK };
    await required({ updateUrl: null });
    await fireEvent.press(screen.getByText('Update'));
    expect(Linking.openURL).toHaveBeenCalledWith(FALLBACK_LINK);
  });

  it("hides Update without a link and says to ask the store's admin", async () => {
    await required({ updateUrl: null });
    expect(screen.queryByText('Update')).toBeNull();
    expect(screen.getByText(/Ask the store's admin/)).toBeTruthy();
  });

  it('Switch store signs out of this store, and the signed-out app shows again', async () => {
    const s = session(jest.fn(async () => info({ minimumVersion: '1.2.0' })));
    const onSwitchStore = jest.fn();
    const view = await render(tree(s, gateStore(s), onSwitchStore));
    await fireEvent.press(await screen.findByText('Switch store'));
    expect(onSwitchStore).toHaveBeenCalledTimes(1);
    // The session signs out; another store, or the same one, starts ungated.
    await view.rerender(tree(null, null, onSwitchStore));
    expect(await screen.findByText('Tabs')).toBeTruthy();
    expect(screen.queryByText('Update required')).toBeNull();
  });
});

describe('Update available', () => {
  const recommended = (version = '1.1.0', over: Partial<AppVersionInfo> = {}) =>
    session(jest.fn(async () => info({ recommendedVersion: version, ...over })));

  it('asks once the answer comes, with Update and Not now', async () => {
    const s = recommended();
    await render(tree(s, gateStore(s)));
    expect(await screen.findByText('Update available')).toBeTruthy();
    expect(screen.getByText('Tabs')).toBeTruthy();
    expect(screen.getByText(/Spree Admin 1\.1\.0 is available \(you have 1\.0\.0\)/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Update'));
    expect(Linking.openURL).toHaveBeenCalledWith(STORE_LINK);
    expect(screen.queryByText('Update available')).toBeNull();
  });

  it('snoozes Not now for 24 hours per store and recommended version', async () => {
    const s = recommended();
    const view = await render(tree(s, gateStore(s)));
    await fireEvent.press(await screen.findByText('Not now'));
    expect(screen.queryByText('Update available')).toBeNull();
    await view.unmount();

    // A new session the same day: still snoozed.
    resetPromptedForTests();
    const again = await render(tree(s, gateStore(s)));
    await waitFor(() => expect(s.adapter.companion?.appVersion).toHaveBeenCalledTimes(2));
    await flush();
    expect(screen.queryByText('Update available')).toBeNull();
    await again.unmount();

    // Another store isn't covered by this store's snooze.
    resetPromptedForTests();
    const other = await render(tree(s, gateStore(s, 'other.test')));
    expect(await screen.findByText('Update available')).toBeTruthy();
    await other.unmount();

    // A newer recommended version asks again at once.
    resetPromptedForTests();
    const newer = recommended('1.2.0');
    const third = await render(tree(newer, gateStore(newer)));
    expect(await screen.findByText(/Spree Admin 1\.2\.0 is available/)).toBeTruthy();
    await third.unmount();

    // A day later the old version asks again too.
    resetPromptedForTests();
    now += SNOOZE_MS;
    await render(tree(s, gateStore(s)));
    expect(await screen.findByText('Update available')).toBeTruthy();
  });

  it('asks at most once per session', async () => {
    const s = recommended();
    const view = await render(tree(s, gateStore(s)));
    await fireEvent.press(await screen.findByText('Update'));
    await view.unmount();

    await render(tree(s, gateStore(s)));
    await waitFor(() => expect(s.adapter.companion?.appVersion).toHaveBeenCalledTimes(2));
    await flush();
    expect(screen.queryByText('Update available')).toBeNull();
  });

  it('waits while a form sheet or pushed screen is open', async () => {
    mockPathname = '/orders/ship';
    const s = recommended();
    const view = await render(tree(s, gateStore(s)));
    await waitFor(() => expect(s.adapter.companion?.appVersion).toHaveBeenCalled());
    await flush();
    expect(screen.queryByText('Update available')).toBeNull();

    mockPathname = '/orders';
    await view.rerender(tree(s, gateStore(s)));
    expect(await screen.findByText('Update available')).toBeTruthy();
  });

  it('never shows over the Update required screen', async () => {
    const s = recommended('1.5.0', { minimumVersion: '1.2.0' });
    await render(tree(s, gateStore(s)));
    expect(await screen.findByText('Update required')).toBeTruthy();
    await flush();
    expect(screen.queryByText('Update available')).toBeNull();
  });
});
