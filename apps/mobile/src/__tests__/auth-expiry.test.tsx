import type { Session } from '@instincts/spree-api';
import { SpreeError } from '@instincts/spree-sdk';
import { useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ApiProvider, useTRPC } from '@/trpc/trpc';

const session = (kind: 'auth' | 'network'): Session => ({
  probe: {
    baseUrl: 'https://shop.test',
    apiFamilies: ['api-v1'],
    preferredApi: 'api-v1',
    capabilities: ['orders.read'],
    authMethods: ['spreeToken'],
    storeName: 'Shop',
    currency: 'USD',
    spreeVersion: null,
    gem: null,
    probedAt: '2026-11-26T00:00:00Z',
  },
  adapter: {
    family: 'api-v1',
    orders: {
      list: async () => {
        throw new SpreeError({ kind, status: kind === 'auth' ? 401 : 0 });
      },
      get: async () => {
        throw new Error('unused');
      },
    },
  },
});

function Orders() {
  const trpc = useTRPC();
  const q = useQuery({ ...trpc.orders.list.queryOptions({}), retry: false });
  return <Text>{q.error ? 'failed' : 'loading'}</Text>;
}

describe('signed-out devices', () => {
  it('signs out when the store refuses the session', async () => {
    const onAuthError = jest.fn();
    await render(
      <ApiProvider session={session('auth')} onAuthError={onAuthError}>
        <Orders />
      </ApiProvider>,
    );
    await waitFor(() => expect(onAuthError).toHaveBeenCalledTimes(1));
  });

  it('stays signed in on network errors', async () => {
    const onAuthError = jest.fn();
    await render(
      <ApiProvider session={session('network')} onAuthError={onAuthError}>
        <Orders />
      </ApiProvider>,
    );
    expect(await screen.findByText('failed')).toBeTruthy();
    expect(onAuthError).not.toHaveBeenCalled();
  });
});

function Count() {
  const trpc = useTRPC();
  const q = useQuery(trpc.orders.list.queryOptions({}));
  return <Text>{q.data ? `count ${q.data.totalCount}` : 'loading'}</Text>;
}

describe('switching stores', () => {
  it('keeps queries started on first mount and clears data when the store changes', async () => {
    const ok = (name: string): Session => ({
      ...session('network'),
      probe: { ...session('network').probe, baseUrl: `https://${name}.test`, storeName: name },
      adapter: {
        family: 'api-v1',
        orders: {
          list: async () => ({ items: [], nextCursor: null, totalCount: name === 'a' ? 1 : 2 }),
          get: async () => {
            throw new Error('unused');
          },
        },
      },
    });
    const view = await render(
      <ApiProvider session={ok('a')}>
        <Count />
      </ApiProvider>,
    );
    expect(await screen.findByText('count 1')).toBeTruthy();
    await view.rerender(
      <ApiProvider session={ok('b')}>
        <Count />
      </ApiProvider>,
    );
    expect(await screen.findByText('count 2')).toBeTruthy();
  });
});
