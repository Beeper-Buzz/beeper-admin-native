import { describe, expect, it } from 'vitest';
import { Conversation, CustomerContext, customerName, InboxSummary, Message } from './inbox';
import { StoreSummary } from './summary';
import { Cart, isAbandoned, VisitorSession, visitorName } from './visitors';

describe('inbox shapes', () => {
  it('parses a conversation and fills what is missing', () => {
    const c = Conversation.parse({
      id: '12',
      status: 'open',
      channel: 'web',
      customer: { name: 'Ada', email: 'ada@example.com' },
      unread: 2,
      lastMessage: { body: 'Is this in stock?', direction: 'inbound', at: '2026-11-28T10:00:00Z' },
    });
    expect(c).toMatchObject({
      subject: null,
      assignee: null,
      unread: 2,
      snoozedUntil: null,
      customer: { name: 'Ada', avatarUrl: null, contactId: null },
    });
  });

  it('survives values a newer store may send', () => {
    const c = Conversation.parse({ id: '1', status: 'pending', channel: 'whatsapp', unread: -1 });
    expect(c.status).toBe('unknown');
    expect(c.channel).toBe('whatsapp');
    expect(c.unread).toBe(0);
    const m = Message.parse({ id: '3', direction: 'reaction', delivery: 'queued' });
    expect(m).toMatchObject({ direction: 'unknown', delivery: 'unknown', body: '', attachments: [] });
    expect(Message.parse({ id: '4', direction: 'note', delivery: null }).delivery).toBeNull();
  });

  it('parses customer context with nulls for what the store lacks', () => {
    expect(CustomerContext.parse({})).toEqual({
      contact: null,
      user: null,
      session: null,
      cart: null,
      recentOrders: [],
    });
    const ctx = CustomerContext.parse({
      cart: {
        orderNumber: 'R1',
        itemCount: 2,
        total: { amount: '12.00', currency: 'USD' },
        items: [{ name: 'Tote' }],
      },
    });
    expect(ctx.cart?.items[0]).toEqual({ name: 'Tote', quantity: 0, imageUrl: null });
  });

  it('names customers and reads badge numbers', () => {
    expect(customerName({ name: ' ', email: 'ada@example.com' })).toBe('ada@example.com');
    expect(customerName(null)).toBe('Visitor');
    expect(InboxSummary.parse({ open: 3 })).toEqual({ open: 3, unassigned: 0, unread: 0 });
  });
});

describe('carts and visitors', () => {
  const now = Date.parse('2026-11-28T12:00:00Z');

  it('counts carts with an email untouched for an hour as abandoned', () => {
    const cart = Cart.parse({ number: 'R1', email: 'a@example.com', updatedAt: '2026-11-28T10:59:00Z' });
    expect(isAbandoned(cart, now)).toBe(true);
    expect(isAbandoned({ ...cart, updatedAt: '2026-11-28T11:30:00Z' }, now)).toBe(false);
    expect(isAbandoned({ ...cart, email: null }, now)).toBe(false);
  });

  it('parses sessions tolerantly and names visitors', () => {
    const s = VisitorSession.parse({ id: '9', device: 'watch', online: 'yes', country: 'DE' });
    expect(s).toMatchObject({ device: 'unknown', online: false, cart: null, conversationId: null });
    expect(visitorName(s)).toBe('Visitor from DE');
    expect(visitorName({ ...s, contact: { id: '1', name: 'Ada', email: null } })).toBe('Ada');
  });

  it('adds optional visitor and cart counts to the summary', () => {
    const summary = {
      currency: 'USD',
      timeZone: null,
      today: { orders: 0, sales: { amount: '0.00', currency: 'USD' } },
      ordersToFulfill: 0,
      paymentsDue: 0,
      lowStockVariants: 0,
      generatedAt: '2026-11-28T12:00:00Z',
    };
    expect(StoreSummary.parse(summary)).toMatchObject({ visitorsOnline: null, activeCarts: null });
    expect(StoreSummary.parse({ ...summary, visitorsOnline: 4, activeCarts: 2 })).toMatchObject({
      visitorsOnline: 4,
      activeCarts: 2,
    });
  });
});
