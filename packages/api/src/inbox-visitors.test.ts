import type { Conversation, Message } from '@instincts/spree-domain';
import {
  type SpreeAdapter,
  type StoreProbe,
  unsupportedCarts,
  unsupportedCustomers,
  unsupportedInbox,
  unsupportedMedia,
  unsupportedProducts,
  unsupportedPromotions,
  unsupportedResources,
  unsupportedVisitors,
} from '@instincts/spree-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createCaller } from './router';
import type { Context } from './trpc';

/** Menus, inbox and visitors (docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md). */
const probe = (capabilities: string[]): StoreProbe => ({
  baseUrl: 'https://shop.test',
  apiFamilies: ['api-v1'],
  preferredApi: 'api-v1',
  capabilities: capabilities as StoreProbe['capabilities'],
  authMethods: ['pairing'],
  storeName: 'Shop',
  currency: 'USD',
  spreeVersion: '4.2.7',
  gem: { version: '0.7.0' },
  probedAt: '2026-11-28T00:00:00Z',
});

const conversation: Conversation = {
  id: '12',
  status: 'open',
  channel: 'web',
  subject: null,
  customer: { name: 'Ada', email: 'ada@example.com', avatarUrl: null, contactId: '7', userId: null },
  assignee: null,
  unread: 1,
  lastMessage: null,
  updatedAt: '2026-11-28T10:00:00Z',
  snoozedUntil: null,
};
const message: Message = {
  id: '301',
  direction: 'outbound',
  body: 'Yes',
  channel: 'web',
  author: { kind: 'staff', name: 'Sam' },
  attachments: [],
  createdAt: '2026-11-28T10:00:00Z',
  readAt: null,
  delivery: 'sent',
};
const tree = { nodes: [], group: { id: '1', title: 'Header' } };

function setup() {
  const inbox = {
    list: vi.fn(async () => ({ items: [conversation], nextCursor: null, totalCount: 1 })),
    get: vi.fn(async () => ({ ...conversation, customerContext: null })),
    messages: vi.fn(async () => [message]),
    reply: vi.fn(async () => message),
    update: vi.fn(async (_id: string, _patch: unknown) => conversation),
    markRead: vi.fn(async () => undefined),
    summary: vi.fn(async () => ({ open: 3, unassigned: 1, unread: 2 })),
  };
  const carts = {
    list: vi.fn(async () => ({ items: [], nextCursor: null, totalCount: 0 })),
    get: vi.fn(async () => {
      throw new Error('unused');
    }),
  };
  const visitors = {
    list: vi.fn(async () => ({ items: [], nextCursor: null, totalCount: 0 })),
    get: vi.fn(async () => {
      throw new Error('unused');
    }),
    startConversation: vi.fn(async () => ({ conversationId: '12' })),
  };
  const resources = {
    ...unsupportedResources,
    tree: vi.fn(async () => tree),
    moveTree: vi.fn(async () => tree),
    upload: vi.fn(async () => ({
      signedId: 'sig1',
      filename: 'p.jpg',
      contentType: 'image/jpeg',
      byteSize: 1,
      url: null,
    })),
  };
  const adapter = {
    family: 'api-v1',
    orders: {} as SpreeAdapter['orders'],
    products: unsupportedProducts,
    customers: unsupportedCustomers,
    promotions: unsupportedPromotions,
    media: unsupportedMedia,
    resources,
    inbox,
    carts,
    visitors,
  } as unknown as SpreeAdapter;
  const caller = (capabilities: string[]) =>
    createCaller({ session: { probe: probe(capabilities), adapter } } satisfies Context);
  return { inbox, carts, visitors, resources, caller };
}

describe('resources tree', () => {
  it('reads and moves a group’s tree', async () => {
    const { resources, caller } = setup();
    const api = caller(['admin.resources']);
    expect(await api.resources.tree({ key: 'menu_items', group: '1' })).toEqual(tree);
    await api.resources.tree({ key: 'menu_items' });
    expect(resources.tree.mock.calls).toEqual([
      ['menu_items', '1'],
      ['menu_items', null],
    ]);
    await api.resources.moveTree({
      key: 'menu_items',
      group: '1',
      nodes: [
        { id: '3', parentId: '1', position: 0 },
        { id: '2', parentId: '1', position: 1 },
      ],
    });
    expect(resources.moveTree).toHaveBeenCalledWith('menu_items', '1', [
      { id: '3', parentId: '1', position: 0 },
      { id: '2', parentId: '1', position: 1 },
    ]);
  });

  it('refuses moves that can’t be right before they reach the store', async () => {
    const { resources, caller } = setup();
    const api = caller(['admin.resources']);
    for (const nodes of [
      [],
      [{ id: '1', parentId: '1', position: 0 }],
      [
        { id: '1', parentId: null, position: 0 },
        { id: '1', parentId: null, position: 1 },
      ],
      [{ id: '1', parentId: null, position: -1 }],
    ])
      await expect(api.resources.moveTree({ key: 'menu_items', nodes })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    await expect(caller([]).resources.tree({ key: 'menu_items' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(resources.moveTree).not.toHaveBeenCalled();
  });
});

describe('inbox', () => {
  it('needs inbox, explained in plain words', async () => {
    const { inbox, caller } = setup();
    const err = await caller(['admin.resources'])
      .inbox.list({})
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'PRECONDITION_FAILED', message: expect.stringMatching(/inbox/) });
    expect(inbox.list).not.toHaveBeenCalled();
  });

  it('lists with defaults, filters and polling', async () => {
    const { inbox, caller } = setup();
    const api = caller(['inbox']);
    await api.inbox.list({});
    expect(inbox.list).toHaveBeenLastCalledWith({
      status: 'open',
      assignee: 'any',
      perPage: 25,
      cursor: null,
    });
    await api.inbox.list({
      status: 'closed',
      assignee: 'me',
      query: ' ada ',
      updatedSince: '2026-11-28T10:00:00Z',
    });
    expect(inbox.list).toHaveBeenLastCalledWith({
      status: 'closed',
      assignee: 'me',
      query: 'ada',
      updatedSince: '2026-11-28T10:00:00Z',
      perPage: 25,
      cursor: null,
    });
    await expect(api.inbox.list({ updatedSince: 'yesterday' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('gets, pages messages and refuses before and after together', async () => {
    const { inbox, caller } = setup();
    const api = caller(['inbox']);
    await api.inbox.get({ id: '12' });
    await api.inbox.messages({ id: '12' });
    await api.inbox.messages({ id: '12', after: '301' });
    await api.inbox.messages({ id: '12', before: '250', limit: 50 });
    expect(inbox.messages.mock.calls).toEqual([
      ['12', {}],
      ['12', { after: '301' }],
      ['12', { before: '250', limit: 50 }],
    ]);
    await expect(api.inbox.messages({ id: '12', before: '1', after: '2' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(api.inbox.get({ id: '../12' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('replies and notes with attachments, within the length limit', async () => {
    const { inbox, caller } = setup();
    const api = caller(['inbox']);
    await api.inbox.reply({ id: '12', body: '  Yes, in stock  ' });
    await api.inbox.reply({ id: '12', body: 'VIP', note: true, attachments: ['sig1'] });
    await api.inbox.reply({ id: '12', attachments: ['sig2'] });
    expect(inbox.reply.mock.calls).toEqual([
      ['12', { body: 'Yes, in stock' }],
      ['12', { body: 'VIP', note: true, attachments: ['sig1'] }],
      ['12', { body: '', attachments: ['sig2'] }],
    ]);
    await expect(api.inbox.reply({ id: '12', body: '   ' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(api.inbox.reply({ id: '12', body: 'x'.repeat(4001) })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('assigns, snoozes, closes and reopens', async () => {
    const { inbox, caller } = setup();
    const api = caller(['inbox']);
    await api.inbox.update({ id: '12', assignee: 'me' });
    await api.inbox.update({ id: '12', assignee: null });
    await api.inbox.update({ id: '12', status: 'snoozed', snoozedUntil: '2026-11-29T09:00:00Z' });
    await api.inbox.update({ id: '12', status: 'closed' });
    await api.inbox.update({ id: '12', status: 'open' });
    expect(inbox.update.mock.calls.map((c) => c[1])).toEqual([
      { assigneeId: 'me' },
      { assigneeId: null },
      { status: 'snoozed', snoozedUntil: '2026-11-29T09:00:00Z' },
      { status: 'closed', snoozedUntil: null },
      { status: 'open', snoozedUntil: null },
    ]);
    await expect(api.inbox.update({ id: '12', status: 'snoozed' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('marks read, reads the summary and uploads through resources', async () => {
    const { inbox, resources, caller } = setup();
    const api = caller(['inbox']);
    expect(await api.inbox.read({ id: '12' })).toEqual({ ok: true });
    expect(inbox.markRead).toHaveBeenCalledWith('12');
    expect(await api.inbox.summary()).toEqual({ open: 3, unassigned: 1, unread: 2 });
    const file = { uri: 'file:///p.jpg', name: 'p.jpg', type: 'image/jpeg' };
    expect((await api.inbox.upload({ file })).signedId).toBe('sig1');
    expect(resources.upload).toHaveBeenCalledWith(file);
  });
});

describe('carts and visitors', () => {
  it('gates each on its own capability', async () => {
    const { caller } = setup();
    await expect(caller(['visitors']).carts.list({})).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(caller(['carts']).visitors.list({})).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('passes cart filters through', async () => {
    const { carts, caller } = setup();
    const api = caller(['carts']);
    await api.carts.list({ activeWithin: 60 });
    await api.carts.list({ withEmail: true, cursor: '2' });
    await api.carts.list({ abandoned: true });
    expect(carts.list.mock.calls).toEqual([
      [{ perPage: 25, cursor: null, activeWithin: 60 }],
      [{ perPage: 25, cursor: '2', withEmail: true }],
      [{ perPage: 25, cursor: null, abandoned: true }],
    ]);
  });

  it('lists online visitors and starts a conversation', async () => {
    const { visitors, caller } = setup();
    const api = caller(['visitors']);
    await api.visitors.list({ online: true });
    expect(visitors.list).toHaveBeenCalledWith({ perPage: 25, cursor: null, online: true });
    expect(await api.visitors.startConversation({ id: '55' })).toEqual({ conversationId: '12' });
  });

  it('refuses on a store without the gem', async () => {
    const adapter = {
      family: 'api-v1',
      inbox: unsupportedInbox,
      carts: unsupportedCarts,
      visitors: unsupportedVisitors,
    } as unknown as SpreeAdapter;
    const api = createCaller({ session: { probe: probe(['inbox', 'carts', 'visitors']), adapter } });
    await expect(api.inbox.summary()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(api.carts.list({})).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
