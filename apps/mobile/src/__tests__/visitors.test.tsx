import type { Session } from '@instincts/spree-api';
import type { Cart, StoreSummary, VisitorSession } from '@instincts/spree-domain';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import HomeScreen from '@/app/(tabs)/index';
import MoreScreen from '@/app/(tabs)/more/index';
import SessionScreen from '@/app/(tabs)/more/visitors/[id]';
import VisitorsScreen from '@/app/(tabs)/more/visitors/index';
import { AppThemeProvider } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';
import { visitorSummary } from '@/visitors/home-card';
import { cartParams, LIVE_POLL_MS } from '@/visitors/use-visitors';

/** Visitors and carts (spec §6.3). */
const mockPush = jest.fn();
const mockNavigate = jest.fn();
let mockParams: Record<string, string> = {};
let mockCaps: string[] = [];
jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    push: (...a: unknown[]) => mockPush(...a),
    navigate: (...a: unknown[]) => mockNavigate(...a),
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
  useIsFocused: () => true,
}));
jest.mock('@/session/session', () => ({
  useCan: () => (c: string) => mockCaps.includes(c),
  useSession: () => ({
    state: { store: { probe: { baseUrl: 'https://shop.test', storeName: 'Shop', capabilities: mockCaps } } },
    signOut: jest.fn(),
  }),
}));

const usd = (amount: string) => ({ amount, currency: 'USD' });
const session = (id: string, patch: Partial<VisitorSession> = {}): VisitorSession => ({
  id,
  contact: id === '55' ? { id: '7', name: 'Ada', email: 'ada@example.com' } : null,
  userId: null,
  currentUrl: '/t/bags',
  currentTitle: 'Bags',
  referrer: 'https://search.example.com/q',
  utm: { source: 'news', medium: 'email', campaign: 'fall' },
  device: 'mobile',
  country: 'NL',
  startedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  lastSeenAt: new Date().toISOString(),
  online: true,
  pageViews: 4,
  cart: { orderNumber: 'R100', itemCount: 2, total: usd('49.00') },
  conversationId: null,
  ...patch,
});
const cart = (number: string, patch: Partial<Cart> = {}): Cart => ({
  number,
  state: 'address',
  email: 'ada@example.com',
  userId: null,
  itemCount: 2,
  total: usd('49.00'),
  updatedAt: new Date().toISOString(),
  abandoned: false,
  items: [{ name: 'Tote', variantSku: 'TOTE-1', quantity: 2, imageUrl: null }],
  ...patch,
});
const summary: StoreSummary = {
  currency: 'USD',
  timeZone: null,
  today: { orders: 1, sales: usd('10.00') },
  ordersToFulfill: 0,
  paymentsDue: 0,
  lowStockVariants: 0,
  generatedAt: '2026-11-28T10:00:00Z',
  visitorsOnline: 3,
  activeCarts: 2,
};

function setup() {
  const visitors = {
    list: jest.fn(async () => ({
      items: [session('55'), session('56', { conversationId: '12' })],
      nextCursor: null,
      totalCount: 2,
    })),
    get: jest.fn(async () => ({
      ...session('55'),
      pages: [
        // Oldest first, as the 4.2 demo adapter sends them; the screen shows newest first.
        { url: '/', title: 'Home', at: '2026-11-28T10:00:00Z' },
        { url: '/t/bags', title: 'Bags', at: '2026-11-28T10:04:00Z' },
      ],
    })),
    startConversation: jest.fn(async () => ({ conversationId: '77' })),
  };
  const carts = {
    list: jest.fn(async (p: { abandoned?: boolean }) => ({
      items: p.abandoned ? [cart('R200', { abandoned: true, email: 'gone@example.com' })] : [cart('R100')],
      nextCursor: null,
      totalCount: 1,
    })),
    get: jest.fn(async () => cart('R100')),
  };
  const companion = { summary: jest.fn(async () => summary) };
  const orders = { list: jest.fn(async () => ({ items: [], nextCursor: null, totalCount: 0 })) };
  const s = {
    probe: { baseUrl: 'https://shop.test', currency: 'USD', capabilities: mockCaps },
    adapter: { family: 'api-v1', orders, visitors, carts, companion },
  } as unknown as Session;
  const ui = (el: React.ReactElement) =>
    render(
      <AppThemeProvider>
        <ApiProvider session={s}>{el}</ApiProvider>
      </AppThemeProvider>,
    );
  return { visitors, carts, companion, ui };
}

beforeEach(() => {
  mockPush.mockClear();
  mockNavigate.mockClear();
  mockParams = {};
  mockCaps = ['visitors', 'carts', 'inbox', 'analytics.summary', 'orders.read'];
  jest.useRealTimers();
});

describe('Home card', () => {
  it('says who is on the store from the summary and opens Visitors', async () => {
    const { visitors, ui } = setup();
    await ui(<HomeScreen />);
    const card = await screen.findByRole('button', { name: '3 online · 2 carts' });
    // The summary had both counts, so no extra lists were fetched.
    expect(visitors.list).not.toHaveBeenCalled();
    await fireEvent.press(card);
    expect(mockNavigate).toHaveBeenCalledWith('/more/visitors');
  });

  it('counts from the lists when the summary lacks them, and hides without either capability', async () => {
    expect(visitorSummary(null, 1, { visitors: false, carts: true })).toBe('1 cart');
    expect(visitorSummary(4, undefined, { visitors: true, carts: true })).toBe('4 online · – carts');
    mockCaps = ['carts', 'orders.read'];
    const { carts, ui } = setup();
    await ui(<HomeScreen />);
    expect(await screen.findByRole('button', { name: '1 cart' })).toBeTruthy();
    expect(carts.list).toHaveBeenCalledWith({ activeWithin: 60, perPage: 1, cursor: null });
  });

  it('is absent without visitors or carts', async () => {
    mockCaps = ['orders.read'];
    const { ui } = setup();
    await ui(<HomeScreen />);
    expect(screen.queryByText(/online|carts?$/)).toBeNull();
  });
});

describe('More screen', () => {
  it('lists Visitors, and Customers when the Inbox tab took its place', async () => {
    mockCaps = ['visitors', 'inbox', 'customers.read'];
    const { ui } = setup();
    await ui(<MoreScreen />);
    await fireEvent.press(screen.getByRole('link', { name: 'Customers' }));
    expect(mockPush).toHaveBeenCalledWith('/more/customers');
    await fireEvent.press(screen.getByRole('link', { name: 'Visitors' }));
    expect(mockPush).toHaveBeenCalledWith('/more/visitors');
  });
});

describe('Visitors screen', () => {
  it('lists live sessions, refreshes every 15 s and messages a visitor', async () => {
    jest.useFakeTimers();
    const { visitors, ui } = setup();
    await ui(<VisitorsScreen />);
    await act(() => jest.advanceTimersByTimeAsync(100));
    expect(screen.getByText('2 online now')).toBeTruthy();
    expect(
      screen.getByLabelText(
        /^Ada, on Bags, 4 min on the store · Phone · NL · 4 pages, cart 2 items · \$49\.00/,
      ),
    ).toBeTruthy();
    expect(visitors.list).toHaveBeenCalledWith({ online: true, perPage: 50, cursor: null });
    const calls = visitors.list.mock.calls.length;
    await act(() => jest.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(visitors.list.mock.calls.length).toBeGreaterThan(calls);
    jest.useRealTimers();

    await fireEvent.press(screen.getByRole('button', { name: 'Message Ada' }));
    await waitFor(() => expect(visitors.startConversation).toHaveBeenCalledWith('55'));
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({ pathname: '/inbox/[id]', params: { id: '77' } }),
    );
    // A visitor already in a conversation opens it.
    await fireEvent.press(screen.getByRole('button', { name: /^Open the chat with/ }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/inbox/[id]', params: { id: '12' } });
  });

  it('shows active and abandoned carts and opens the order', async () => {
    const { carts, ui } = setup();
    await ui(<VisitorsScreen />);
    await fireEvent.press(await screen.findByRole('tab', { name: 'Carts' }));
    expect(
      await screen.findByLabelText(/^ada@example\.com, active, 2 items · \$49\.00, 2× Tote/),
    ).toBeTruthy();
    expect(carts.list).toHaveBeenLastCalledWith({ activeWithin: 60, perPage: 25, cursor: null });
    await fireEvent.press(screen.getByRole('tab', { name: /^Abandoned/ }));
    const row = await screen.findByLabelText(/^gone@example\.com, abandoned/);
    expect(carts.list).toHaveBeenLastCalledWith({ abandoned: true, perPage: 25, cursor: null });
    await fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/orders/[id]', params: { id: 'R200' } });
    expect(cartParams('all')).toEqual({});
  });

  it('offers no Message button without the inbox', async () => {
    mockCaps = ['visitors'];
    const { ui } = setup();
    await ui(<VisitorsScreen />);
    await screen.findByText('2 online now');
    expect(screen.queryByRole('button', { name: /Message/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Carts' })).toBeNull();
  });
});

describe('session detail', () => {
  it('shows the page timeline, newest first, and the cart', async () => {
    mockParams = { id: '55' };
    const { carts, ui } = setup();
    await ui(<SessionScreen />);
    expect(await screen.findByText('Online now')).toBeTruthy();
    const pages = screen.getAllByLabelText(/^(Bags|Home), /).map((p) => p.props.accessibilityLabel as string);
    expect(pages.map((p) => p.split(',')[0])).toEqual(['Bags', 'Home']);
    expect(await screen.findByText('Tote')).toBeTruthy();
    expect(carts.get).toHaveBeenCalledWith('R100');
    expect(screen.getByText(/From search\.example\.com · news \/ email \/ fall/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Message' }));
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({ pathname: '/inbox/[id]', params: { id: '77' } }),
    );
  });
});
