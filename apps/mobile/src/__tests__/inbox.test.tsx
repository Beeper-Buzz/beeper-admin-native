import type { Session } from '@instincts/spree-api';
import type { Conversation, ConversationDetail, Message } from '@instincts/spree-domain';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import TabsLayout from '@/app/(tabs)/_layout';
import ChatScreen from '@/app/(tabs)/inbox/[id]';
import CustomerSheetScreen from '@/app/(tabs)/inbox/customer';
import InboxScreen from '@/app/(tabs)/inbox/index';
import { usePoll } from '@/components/use-poll';
import {
  filterParams,
  mergeConversations,
  mergeMessages,
  pollSince,
  snoozeOptions,
  unreadBadge,
} from '@/inbox/inbox-state';
import { notificationRoute } from '@/push/push';
import { AppThemeProvider } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';

/** The inbox (spec §6.2) against SDK-shaped fixtures. */
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
let mockCaps: string[] = ['inbox', 'customers.read'];
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: (...a: unknown[]) => mockPush(...a) },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
  useIsFocused: () => true,
}));
jest.mock('@/session/session', () => ({
  useCan: () => (c: string) => mockCaps.includes(c),
  useSession: () => ({
    state: { store: { probe: { capabilities: mockCaps }, credential: { method: 'apiKey' } } },
  }),
}));
jest.mock('@/push/push', () => ({
  ...jest.requireActual('@/push/push'),
  getPushToken: jest.fn(async () => null),
  useNotificationNavigation: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-router/native-tabs', () => {
  const { Text: T, View: V } = require('react-native');
  const Trigger = ({ name, hidden, children }: { name: string; hidden?: boolean; children?: unknown }) => (
    <V testID={`tab-${name}`} accessibilityHint={hidden ? 'hidden' : 'shown'}>
      {children as never}
    </V>
  );
  Trigger.Label = ({ children }: { children: string }) => <T>{children}</T>;
  Trigger.Icon = () => null;
  Trigger.Badge = ({ children, hidden }: { children?: string; hidden?: boolean }) =>
    hidden || !children ? null : <T testID="badge">{children}</T>;
  const NativeTabs = ({ children }: { children: unknown }) => <V>{children as never}</V>;
  NativeTabs.Trigger = Trigger;
  return { NativeTabs };
});
jest.mock('@/media/pick', () => ({ pickPhoto: jest.fn() }));

const conv = (id: string, patch: Partial<Conversation> = {}): Conversation => ({
  id,
  status: 'open',
  channel: 'web',
  subject: null,
  customer: {
    name: `Customer ${id}`,
    email: `c${id}@example.com`,
    avatarUrl: null,
    contactId: id,
    userId: null,
  },
  assignee: null,
  unread: 0,
  lastMessage: { body: `Hello from ${id}`, direction: 'inbound', at: '2026-11-28T10:00:00Z' },
  updatedAt: '2026-11-28T10:00:00Z',
  snoozedUntil: null,
  ...patch,
});
const msg = (
  id: string,
  direction: Message['direction'],
  body: string,
  at = `2026-11-28T10:0${id.slice(-1)}:00Z`,
): Message => ({
  id,
  direction,
  body,
  channel: 'web',
  author: {
    kind: direction === 'inbound' ? 'customer' : 'staff',
    name: direction === 'inbound' ? 'Ada' : 'Sam',
  },
  attachments: [],
  createdAt: at,
  readAt: null,
  delivery: direction === 'outbound' ? 'sent' : null,
});
const detail = (patch: Partial<ConversationDetail> = {}): ConversationDetail => ({
  ...conv('12', {
    customer: { name: 'Ada', email: 'ada@example.com', avatarUrl: null, contactId: '7', userId: '3' },
    unread: 1,
  }),
  customerContext: {
    contact: { id: '7', name: 'Ada Lovelace', email: 'ada@example.com', phone: '+1 555 0100' },
    user: { id: '3', email: 'ada@example.com' },
    session: { id: '55', currentUrl: '/t/bags', lastSeenAt: '2026-11-28T10:01:00Z', online: true },
    cart: {
      orderNumber: 'R100',
      itemCount: 2,
      total: { amount: '49.00', currency: 'USD' },
      items: [{ name: 'Tote', quantity: 2, imageUrl: null }],
    },
    recentOrders: [
      { number: 'R099', state: 'complete', total: { amount: '10.00', currency: 'USD' }, completedAt: null },
    ],
  },
  ...patch,
});

function setup(overrides: Record<string, jest.Mock> = {}) {
  const inbox = {
    list: jest.fn(async (p: { updatedSince?: string }) =>
      p.updatedSince
        ? { items: [], nextCursor: null, totalCount: 0 }
        : {
            items: [conv('1', { unread: 2 }), conv('2', { assignee: { id: '9', email: 'sam@example.com' } })],
            nextCursor: null,
            totalCount: 2,
          },
    ),
    get: jest.fn(async () => detail()),
    messages: jest.fn(async (_id: string, p: { after?: string }) =>
      p?.after
        ? []
        : [
            msg('301', 'inbound', 'Is this in stock?'),
            msg('302', 'note', 'VIP customer'),
            msg('303', 'outbound', 'Yes!'),
          ],
    ),
    reply: jest.fn(async (_id: string, input: { body: string; note?: boolean }) =>
      msg('304', input.note ? 'note' : 'outbound', input.body, '2026-11-28T10:09:00Z'),
    ),
    update: jest.fn(async (_id: string, patch: Record<string, unknown>) =>
      conv('12', patch as Partial<Conversation>),
    ),
    markRead: jest.fn(async () => undefined),
    summary: jest.fn(async () => ({ open: 3, unassigned: 1, unread: 5 })),
    ...overrides,
  };
  const session = {
    probe: { baseUrl: 'https://shop.test', currency: 'USD', capabilities: mockCaps },
    adapter: { family: 'api-v1', orders: {}, inbox, resources: { upload: jest.fn() } },
  } as unknown as Session;
  const ui = (el: React.ReactElement) =>
    render(
      <AppThemeProvider>
        <ApiProvider session={session}>{el}</ApiProvider>
      </AppThemeProvider>,
    );
  return { inbox, ui };
}

/** Captures the AppState listener so tests can send the app to the background and back. */
function captureAppState() {
  const listeners: ((s: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener as (s: AppStateStatus) => void);
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
  return (state: AppStateStatus) =>
    act(() => {
      for (const l of listeners) l(state);
    });
}

beforeEach(() => {
  mockPush.mockClear();
  mockParams = {};
  mockCaps = ['inbox', 'customers.read'];
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('inbox state', () => {
  it('maps filter tabs to list queries', () => {
    expect(filterParams('open')).toEqual({ status: 'open', assignee: 'any' });
    expect(filterParams('mine')).toEqual({ status: 'open', assignee: 'me' });
    expect(filterParams('unassigned')).toEqual({ status: 'open', assignee: 'unassigned' });
    expect(filterParams('closed')).toEqual({ status: 'closed', assignee: 'any' });
  });

  it('folds polled changes into the list, dropping ones that left the tab', () => {
    const pages = [{ items: [conv('1'), conv('2')] }, { items: [conv('3')] }];
    const merged = mergeConversations(
      pages,
      [
        conv('3', { updatedAt: '2026-11-28T11:00:00Z' }),
        conv('2', { status: 'closed' }),
        conv('9', { updatedAt: '2026-11-28T10:30:00Z' }),
      ],
      'open',
    );
    expect(merged.map((p) => p.map((c) => c.id))).toEqual([['3', '9', '1'], []]);
    expect(
      mergeConversations(pages, [conv('1', { assignee: { id: '1', email: null } })], 'unassigned')[0]?.map(
        (c) => c.id,
      ),
    ).toEqual(['2']);
  });

  it('polls from the newest activity, else a minute before loading', () => {
    expect(pollSince([conv('1', { updatedAt: '2026-11-28T09:00:00Z' }), conv('2')], 0)).toBe(
      '2026-11-28T10:00:00.000Z',
    );
    expect(pollSince([], Date.parse('2026-11-28T10:00:00Z'))).toBe('2026-11-28T09:59:00.000Z');
  });

  it('merges messages by id, oldest first', () => {
    const a = msg('301', 'inbound', 'a');
    const b = msg('302', 'outbound', 'b');
    expect(mergeMessages([b], [a, { ...b, body: 'edited' }]).map((m) => [m.id, m.body])).toEqual([
      ['301', 'a'],
      ['302', 'edited'],
    ]);
  });

  it('offers snoozes of an hour, tomorrow morning and next Monday morning', () => {
    // Wednesday 26 Nov 2026, 15:20 local.
    const now = new Date(2026, 10, 26, 15, 20);
    const [hour, tomorrow, week] = snoozeOptions(now);
    expect(hour).toMatchObject({ key: '1h', label: '1 hour' });
    expect(hour?.until.getTime()).toBe(now.getTime() + 3_600_000);
    expect(tomorrow?.until).toEqual(new Date(2026, 10, 27, 9, 0));
    expect(week?.until).toEqual(new Date(2026, 10, 30, 9, 0));
    // On a Monday, next week is the Monday after.
    expect(snoozeOptions(new Date(2026, 10, 30, 8, 0))[2]?.until).toEqual(new Date(2026, 11, 7, 9, 0));
  });

  it('caps the tab badge', () => {
    expect([unreadBadge(0), unreadBadge(undefined), unreadBadge(7), unreadBadge(120)]).toEqual([
      null,
      null,
      '7',
      '99+',
    ]);
  });
});

describe('polling', () => {
  it('waits the interval, never overlaps, and pauses in the background', async () => {
    jest.useFakeTimers();
    const emit = captureAppState();
    let release: () => void = () => {};
    const tick = jest.fn(() => new Promise<void>((r) => (release = r)));
    await renderHook(() => usePoll(tick, 5_000));
    await act(() => jest.advanceTimersByTimeAsync(4_999));
    expect(tick).toHaveBeenCalledTimes(0);
    await act(() => jest.advanceTimersByTimeAsync(1));
    expect(tick).toHaveBeenCalledTimes(1);
    // A slow store: nothing more until the call settles.
    await act(() => jest.advanceTimersByTimeAsync(20_000));
    expect(tick).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await act(() => jest.advanceTimersByTimeAsync(5_000));
    expect(tick).toHaveBeenCalledTimes(2);
    await act(async () => release());
    // Background: paused, however long.
    await emit('background');
    await act(() => jest.advanceTimersByTimeAsync(60_000));
    expect(tick).toHaveBeenCalledTimes(2);
    // Back after longer than the interval: polls straight away.
    await emit('active');
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('polls the list with updated_since every 20 seconds and shows what changed', async () => {
    jest.useFakeTimers();
    const { inbox, ui } = setup();
    await ui(<InboxScreen />);
    await act(() => jest.advanceTimersByTimeAsync(500));
    expect(screen.getByLabelText(/^Customer 1, 2 unread/)).toBeTruthy();
    inbox.list.mockImplementation(async (p: { updatedSince?: string }) =>
      p.updatedSince
        ? {
            items: [conv('5', { updatedAt: '2026-11-28T10:05:00Z', unread: 1 })],
            nextCursor: null,
            totalCount: 1,
          }
        : { items: [], nextCursor: null, totalCount: 0 },
    );
    await act(() => jest.advanceTimersByTimeAsync(20_000));
    expect(inbox.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'open', assignee: 'any', updatedSince: '2026-11-28T10:00:00.000Z' }),
    );
    expect(screen.getByLabelText(/^Customer 5, 1 unread/)).toBeTruthy();
  });

  it('polls an open conversation every 5 seconds with after, and not in the background', async () => {
    jest.useFakeTimers();
    const emit = captureAppState();
    mockParams = { id: '12' };
    const { inbox, ui } = setup();
    await ui(<ChatScreen />);
    await act(() => jest.advanceTimersByTimeAsync(500));
    inbox.messages.mockImplementation(async (_id: string, p: { after?: string }) =>
      p?.after === '303' ? [msg('305', 'inbound', 'Great, thanks')] : [],
    );
    await act(() => jest.advanceTimersByTimeAsync(5_000));
    expect(inbox.messages).toHaveBeenLastCalledWith('12', { after: '303' });
    expect(screen.getByText('Great, thanks')).toBeTruthy();
    const calls = inbox.messages.mock.calls.length;
    await emit('background');
    await act(() => jest.advanceTimersByTimeAsync(30_000));
    expect(inbox.messages.mock.calls.length).toBe(calls);
  });
});

describe('inbox list', () => {
  it('filters by tab and opens a conversation', async () => {
    const { inbox, ui } = setup();
    await ui(<InboxScreen />);
    await screen.findByLabelText(/^Customer 2, Hello from 2/);
    await fireEvent.press(screen.getByRole('tab', { name: 'Mine' }));
    await waitFor(() =>
      expect(inbox.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'open', assignee: 'me' }),
      ),
    );
    await fireEvent.press(screen.getByRole('tab', { name: 'Closed' }));
    await waitFor(() =>
      expect(inbox.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'closed' })),
    );
    await fireEvent.press(await screen.findByLabelText(/^Customer 1/));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/inbox/[id]', params: { id: '1' } });
  });
});

describe('chat', () => {
  it('shows bubbles and notes, marks read and sends a reply', async () => {
    mockParams = { id: '12' };
    const { inbox, ui } = setup();
    await ui(<ChatScreen />);
    expect(await screen.findByLabelText(/^Internal note\. Note by Sam/)).toBeTruthy();
    expect(screen.getByLabelText(/^Ada · .*Is this in stock\?/)).toBeTruthy();
    await waitFor(() => expect(inbox.markRead).toHaveBeenCalledWith('12'));
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Message'), 'It ships tomorrow');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(inbox.reply).toHaveBeenCalledWith('12', { body: 'It ships tomorrow' }));
    expect(await screen.findByText('It ships tomorrow')).toBeTruthy();
    expect(screen.getByLabelText('Message').props.value).toBe('');
  });

  it('saves an internal note with the toggle', async () => {
    mockParams = { id: '12' };
    const { inbox, ui } = setup();
    await ui(<ChatScreen />);
    await screen.findByLabelText('Message');
    await fireEvent(screen.getByLabelText('Internal note'), 'valueChange', true);
    await fireEvent.changeText(screen.getByLabelText('Note'), 'Offer a discount');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() =>
      expect(inbox.reply).toHaveBeenCalledWith('12', { body: 'Offer a discount', note: true }),
    );
  });
});

describe('customer sheet', () => {
  it('shows the contact, live page, cart and orders', async () => {
    mockParams = { id: '12' };
    const { ui } = setup();
    await ui(<CustomerSheetScreen />);
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Online now')).toBeTruthy();
    expect(screen.getByLabelText('Current page /t/bags')).toBeTruthy();
    expect(screen.getByText('Tote')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Order R099/));
    expect(mockPush).toHaveBeenCalledWith('/orders/R099');
  });

  it('assigns to me, snoozes until tomorrow and closes', async () => {
    mockParams = { id: '12' };
    const { inbox, ui } = setup();
    await ui(<CustomerSheetScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Assign to me' }));
    await waitFor(() => expect(inbox.update).toHaveBeenCalledWith('12', { assigneeId: 'me' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Snooze' }));
    const tomorrow = snoozeOptions()[1]?.until.toISOString();
    await fireEvent.press(screen.getByLabelText(/^Snooze for tomorrow/));
    await waitFor(() =>
      expect(inbox.update).toHaveBeenLastCalledWith('12', { status: 'snoozed', snoozedUntil: tomorrow }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(inbox.update).toHaveBeenLastCalledWith('12', { status: 'closed', snoozedUntil: null }),
    );
  });
});

describe('push and tabs', () => {
  it('routes an inbox push to its conversation and an order push to the order', () => {
    expect(notificationRoute({ type: 'inbox', conversation_id: 12 })).toBe('/inbox/12');
    expect(notificationRoute({ type: 'inbox', conversation_id: 'c_9' })).toBe('/inbox/c_9');
    expect(notificationRoute({ type: 'inbox', conversation_id: '../x' })).toBeNull();
    expect(notificationRoute({ url: '/orders/R123' })).toBe('/orders/R123');
    expect(notificationRoute({ url: 'https://evil.example.com' })).toBeNull();
    expect(notificationRoute(null)).toBeNull();
  });

  it('swaps Customers for Inbox with an unread badge when the store has an inbox', async () => {
    const { ui } = setup();
    await ui(<TabsLayout />);
    expect(screen.getByTestId('tab-inbox').props.accessibilityHint).toBe('shown');
    expect(screen.getByTestId('tab-customers').props.accessibilityHint).toBe('hidden');
    expect((await screen.findByTestId('badge')).props.children).toBe('5');
  });

  it('keeps Customers and no Inbox without the capability', async () => {
    mockCaps = ['customers.read'];
    const { inbox, ui } = setup();
    await ui(<TabsLayout />);
    expect(screen.getByTestId('tab-inbox').props.accessibilityHint).toBe('hidden');
    expect(screen.getByTestId('tab-customers').props.accessibilityHint).toBe('shown');
    expect(screen.queryByTestId('badge')).toBeNull();
    expect(inbox.summary).not.toHaveBeenCalled();
  });
});
