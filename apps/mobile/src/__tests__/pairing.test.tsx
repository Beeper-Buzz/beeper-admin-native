import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SignInScreen from '@/app/(auth)/sign-in';
import { SessionProvider } from '@/session/session';
import { AppThemeProvider } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ url: 'https://shop.test', methods: 'pairing,spreeToken' }),
}));
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
jest.mock('expo-device', () => ({ deviceName: 'Test iPhone', isDevice: false }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Sign in by pairing code', () => {
  it('trades a typed code for a device token and connects the store', async () => {
    const exchanged: unknown[] = [];
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === '/api/admin_native/v1/capabilities')
        return json(200, {
          api_families: ['api-v1'],
          capabilities: ['analytics.summary'],
          auth_methods: ['pairing'],
          store: { name: 'Shop' },
        });
      if (path === '/api/admin_native/v1/pairings/exchange') {
        exchanged.push(JSON.parse(String(init?.body)));
        return json(201, {
          token: 'san_abc',
          device: { id: '1', name: 'Test iPhone', platform: 'ios' },
          user: { email: 'a@b.c' },
        });
      }
      return json(404, {});
    }) as unknown as typeof fetch;

    await render(
      <AppThemeProvider>
        <SessionProvider>
          <ApiProvider session={null}>
            <SignInScreen />
          </ApiProvider>
        </SessionProvider>
      </AppThemeProvider>,
    );
    expect(screen.getByText('Scan pairing code')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Or type the code'), 'abcd-efgh-jkmn');
    await fireEvent.press(screen.getByText('Pair'));

    await waitFor(() => expect(exchanged).toHaveLength(1));
    expect(exchanged[0]).toMatchObject({ code: 'abcd-efgh-jkmn', device_name: 'Test iPhone' });
    const SecureStore = jest.requireMock('expo-secure-store');
    await waitFor(() =>
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'store.shop.test',
        expect.stringContaining('"token":"san_abc"'),
        expect.anything(),
      ),
    );
  });
});
