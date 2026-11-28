import { describe, expect, it } from 'vitest';
import { fakeTransport } from '../adapters/fakeTransport.test-helper';
import { SpreeError } from '../errors';
import type { Transport } from '../transport';
import { companionInbox, mapGemConversation, mapGemMessage } from './inbox';

/** The spec's shapes (docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md §2). */
const conversation = {
  id: 12,
  status: 'open',
  channel: 'web',
  subject: null,
  customer: { name: 'Ada', email: 'ada@example.com', avatar_url: null, contact_id: '7', user_id: 3 },
  assignee: { id: '1', email: 'staff@example.com' },
  unread: 2,
  last_message: { body: 'Is this in stock?', direction: 'inbound', at: '2026-11-28T10:00:00Z' },
  updated_at: '2026-11-28T10:00:00Z',
  snoozed_until: null,
};
const message = {
  id: '301',
  direction: 'inbound',
  body: 'Is this in stock?',
  channel: 'web',
  author: { kind: 'customer', name: 'Ada' },
  attachments: [{ url: 'https://shop.test/rails/blobs/x/tote%20back.jpg', content_type: 'image/jpeg' }],
  created_at: '2026-11-28T10:00:00Z',
  read_at: null,
  delivery: null,
};
const context = {
  contact: { id: '7', name: 'Ada', email: 'ada@example.com', phone: null },
  user: { id: '3', email: 'ada@example.com' },
  session: {
    id: '55',
    current_url: 'https://shop.test/t/bags',
    last_seen_at: '2026-11-28T10:01:00Z',
    online: true,
  },
  cart: {
    order_number: 'R100',
    item_count: 1,
    total: '24.5',
    currency: 'USD',
    items: [{ name: 'Tote', quantity: 1, image_url: null }],
  },
  recent_orders: [{ number: 'R099', state: 'complete', total: '10.00', currency: 'USD', completed_at: null }],
};

describe('inbox mapping', () => {
  it('maps a conversation to the domain', () => {
    expect(mapGemConversation(conversation)).toEqual({
      id: '12',
      status: 'open',
      channel: 'web',
      subject: null,
      customer: { name: 'Ada', email: 'ada@example.com', avatarUrl: null, contactId: '7', userId: '3' },
      assignee: { id: '1', email: 'staff@example.com' },
      unread: 2,
      lastMessage: { body: 'Is this in stock?', direction: 'inbound', at: '2026-11-28T10:00:00Z' },
      updatedAt: '2026-11-28T10:00:00Z',
      snoozedUntil: null,
    });
    expect(mapGemConversation({ status: 'open' })).toBeNull();
  });

  it('maps a message and names unnamed attachments after their URL', () => {
    expect(mapGemMessage(message)).toMatchObject({
      id: '301',
      direction: 'inbound',
      author: { kind: 'customer', name: 'Ada' },
      attachments: [{ filename: 'tote back.jpg', contentType: 'image/jpeg' }],
      delivery: null,
    });
  });
});

describe('companion inbox', () => {
  it('lists with filters and polling, dropping rows it cannot read', async () => {
    const { transport, calls } = fakeTransport(() => ({
      data: [conversation, { nonsense: true }],
      meta: { page: 1, per_page: 25, total_count: 30 },
    }));
    const page = await companionInbox(transport).list({
      status: 'open',
      assignee: 'me',
      query: ' ada ',
      updatedSince: '2026-11-28T10:00:00Z',
    });
    expect(calls[0]?.url).toBe(
      '/api/admin_native/v1/inbox/conversations?status=open&assignee=me&q=ada&updated_since=2026-11-28T10:00:00Z&page=1&per_page=25',
    );
    expect(page.items.map((c) => c.id)).toEqual(['12']);
    expect(page).toMatchObject({ nextCursor: '2', totalCount: 30 });
  });

  it('gets a conversation with its customer context', async () => {
    const { transport, calls } = fakeTransport(() => ({
      data: { ...conversation, customer_context: context },
    }));
    const c = await companionInbox(transport).get('12');
    expect(calls[0]?.url).toBe('/api/admin_native/v1/inbox/conversations/12');
    expect(c.customerContext).toEqual({
      contact: { id: '7', name: 'Ada', email: 'ada@example.com', phone: null },
      user: { id: '3', email: 'ada@example.com' },
      session: {
        id: '55',
        currentUrl: 'https://shop.test/t/bags',
        lastSeenAt: '2026-11-28T10:01:00Z',
        online: true,
      },
      cart: {
        orderNumber: 'R100',
        itemCount: 1,
        total: { amount: '24.50', currency: 'USD' },
        items: [{ name: 'Tote', quantity: 1, imageUrl: null }],
      },
      recentOrders: [
        { number: 'R099', state: 'complete', total: { amount: '10.00', currency: 'USD' }, completedAt: null },
      ],
    });
  });

  it('reads messages before and after, and caps the limit', async () => {
    const { transport, calls } = fakeTransport(() => ({ data: [message] }));
    const inbox = companionInbox(transport);
    expect(await inbox.messages('12')).toHaveLength(1);
    await inbox.messages('12', { after: '301' });
    await inbox.messages('12', { before: '250', limit: 500 });
    expect(calls.map((c) => c.url)).toEqual([
      '/api/admin_native/v1/inbox/conversations/12/messages',
      '/api/admin_native/v1/inbox/conversations/12/messages?after=301',
      '/api/admin_native/v1/inbox/conversations/12/messages?before=250&limit=200',
    ]);
  });

  it('replies, notes, updates and marks read', async () => {
    const { transport, calls } = fakeTransport((method, url) => {
      if (method === 'POST' && url.endsWith('/messages'))
        return { data: { ...message, id: '302', direction: 'note' } };
      if (method === 'PATCH') return { data: { ...conversation, status: 'snoozed' } };
      return {};
    });
    const inbox = companionInbox(transport);
    expect((await inbox.reply('12', { body: 'Checking' })).id).toBe('302');
    await inbox.reply('12', { body: 'VIP', note: true, attachments: ['sig1'] });
    expect(calls.map((c) => c.body)).toEqual([
      { body: 'Checking' },
      { body: 'VIP', note: true, attachments: ['sig1'] },
    ]);
    const updated = await inbox.update('12', { status: 'snoozed', snoozedUntil: '2026-11-29T09:00:00Z' });
    expect(updated.status).toBe('snoozed');
    await inbox.update('12', { assigneeId: null });
    await inbox.markRead('12');
    expect(calls.slice(2).map((c) => [c.method, c.url, c.body])).toEqual([
      [
        'PATCH',
        '/api/admin_native/v1/inbox/conversations/12',
        { status: 'snoozed', snoozed_until: '2026-11-29T09:00:00Z' },
      ],
      ['PATCH', '/api/admin_native/v1/inbox/conversations/12', { assignee_id: null }],
      ['POST', '/api/admin_native/v1/inbox/conversations/12/read', undefined],
    ]);
  });

  it('makes relative attachment and image URLs absolute on the store', async () => {
    const { transport } = fakeTransport(() => ({
      data: [{ ...message, attachments: [{ url: '/rails/active_storage/blobs/redirect/x/p.png' }] }],
    }));
    const [m] = await companionInbox(transport).messages('12');
    expect(m?.attachments[0]).toMatchObject({
      url: 'https://shop.test/rails/active_storage/blobs/redirect/x/p.png',
      filename: 'p.png',
    });
  });

  it('reads the summary bare or under data', async () => {
    const bare = fakeTransport(() => ({ open: 3, unassigned: 1, unread: 2 }));
    expect(await companionInbox(bare.transport).summary()).toEqual({ open: 3, unassigned: 1, unread: 2 });
    const wrapped = fakeTransport(() => ({ data: { open: 1 } }));
    expect(await companionInbox(wrapped.transport).summary()).toEqual({ open: 1, unassigned: 0, unread: 0 });
  });

  it('says plainly when a conversation is gone', async () => {
    const { transport } = fakeTransport(() => undefined);
    await expect(companionInbox(transport).get('99')).rejects.toMatchObject({
      kind: 'notFound',
      message: 'This conversation is gone.',
    });
    // An inbox that isn't set up (404 `unsupported`) is a missing capability, not a gone conversation.
    const unset: Transport = {
      baseUrl: 'https://shop.test',
      request: async () => {
        throw new SpreeError({
          kind: 'notFound',
          status: 404,
          body: { error: { code: 'unsupported', message: 'No inbox.' } },
        });
      },
      withAuth: () => unset,
    };
    await expect(companionInbox(unset).summary()).rejects.toMatchObject({ kind: 'capability' });
    const broken = fakeTransport(() => ({ data: { status: 'open' } }));
    await expect(companionInbox(broken.transport).get('1')).rejects.toBeInstanceOf(SpreeError);
  });
});
