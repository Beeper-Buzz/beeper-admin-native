import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createAdapter } from '../src/adapters';
import { probeStore } from '../src/capabilities/probe';
import type { StoreProbe } from '../src/capabilities/types';
import { isSpreeError } from '../src/errors';
import type { SpreeAdapter } from '../src/ports';
import { baseTransport, enabled, env, proves, signIn, writeResults } from './env';
import { png } from './png';
import { rails, railsJson } from './rails';

/**
 * The customer inbox (companion gem 0.7, docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md
 * §2) against the Spree 4.2 store's demo inbox adapter (infra/spree/4.2/initializers/
 * admin_native_demo_inbox.rb). Customer messages come in through `AdminNativeDemo.inbound!` with
 * `bin/rails runner`; every demo row is deleted afterwards. Skips without `inbox`.
 */
describe.runIf(enabled)(`inbox contract: Spree ${env.label}`, () => {
  let probe: StoreProbe;
  let adapter: SpreeAdapter;
  const tag = `ct${Date.now().toString(36)}`;
  const email = `${tag}@example.com`;
  let conversationId: string | null = null;
  let seedError = '';
  /** The signed-in admin's user id (the owner of SPREE_TOKEN), for assigning. */
  let me: string | null = null;

  beforeAll(async () => {
    probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
    if (!probe.capabilities.includes('inbox')) return;
    const transport = baseTransport();
    adapter = createAdapter(env.family ?? probe.preferredApi, transport.withAuth(await signIn(transport)), {
      companion: probe.gem !== null,
    });
    const seeded = railsJson<{ conversation_id: string }>(
      `AdminNativeDemo.inbound!(body: 'Is the tote in stock?', name: 'Ada ${tag}', email: '${email}')`,
    );
    if ('value' in seeded) conversationId = seeded.value.conversation_id;
    else seedError = seeded.error;
    const token = process.env.SPREE_TOKEN ?? '';
    const user = railsJson<number | null>(
      token
        ? `Spree.user_class.find_by(spree_api_key: '${token.replace(/[^A-Za-z0-9]/g, '')}')&.id`
        : 'Spree.user_class.admin.first&.id',
    );
    if ('value' in user && user.value) me = String(user.value);
  });

  afterAll(() => {
    if (conversationId) rails('AdminNativeDemo.clear!');
    writeResults();
  });

  const ready = (skip: (why: string) => never): string => {
    if (!probe.capabilities.includes('inbox'))
      skip('no inbox (needs the companion gem 0.7 with an inbox adapter)');
    if (!conversationId) skip(`can't write a customer message through docker compose exec: ${seedError}`);
    return conversationId as string;
  };

  proves('inbox', 'lists conversations with filters, search and updated_since', async (skip) => {
    const id = ready(skip);
    const open = await adapter.inbox.list({ status: 'open', assignee: 'any', query: tag });
    const c = open.items.find((x) => x.id === id);
    expect(c).toMatchObject({
      status: 'open',
      channel: 'web',
      customer: { name: `Ada ${tag}`, email },
      assignee: null,
      lastMessage: { body: 'Is the tote in stock?', direction: 'inbound' },
    });
    expect(c?.unread).toBeGreaterThan(0);
    expect(open.totalCount).toBeGreaterThanOrEqual(1);
    const since = await adapter.inbox.list({
      updatedSince: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    expect(since.items.map((x) => x.id)).toContain(id);
    const later = await adapter.inbox.list({
      updatedSince: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    expect(later.items.map((x) => x.id)).not.toContain(id);
    const closed = await adapter.inbox.list({ status: 'closed', query: tag });
    expect(closed.items.map((x) => x.id)).not.toContain(id);
  });

  proves('inbox', 'gets a conversation with its customer context', async (skip) => {
    const id = ready(skip);
    const c = await adapter.inbox.get(id);
    expect(c.id).toBe(id);
    expect(c.customerContext).toMatchObject({ contact: { name: `Ada ${tag}`, email } });
    expect(Array.isArray(c.customerContext?.recentOrders)).toBe(true);
  });

  proves('inbox', 'replies, keeps notes internal and pages messages before and after', async (skip) => {
    const id = ready(skip);
    const first = await adapter.inbox.messages(id);
    expect(first.at(-1)).toMatchObject({
      direction: 'inbound',
      body: 'Is the tote in stock?',
      author: { kind: 'customer' },
    });
    const reply = await adapter.inbox.reply(id, { body: 'Yes, it ships tomorrow.' });
    expect(reply).toMatchObject({ direction: 'outbound', body: 'Yes, it ships tomorrow.' });
    const note = await adapter.inbox.reply(id, { body: 'Repeat customer.', note: true });
    expect(note.direction).toBe('note');
    const after = await adapter.inbox.messages(id, { after: first.at(-1)?.id ?? null });
    expect(after.map((m) => m.id)).toEqual([reply.id, note.id]);
    const before = await adapter.inbox.messages(id, { before: reply.id });
    expect(before.map((m) => m.id)).toContain(first.at(-1)?.id);
    expect(before.map((m) => m.id)).not.toContain(reply.id);
    // The customer writes again: polling with after picks it up.
    railsJson(`AdminNativeDemo.inbound!(body: 'Great, thanks!', conversation_id: ${Number(id)})`);
    const polled = await adapter.inbox.messages(id, { after: note.id });
    expect(polled.map((m) => m.body)).toEqual(['Great, thanks!']);
  });

  proves('inbox', 'sends a photo as an attachment, with or without text', async (skip) => {
    const id = ready(skip);
    const blob = await adapter.resources.upload({
      blob: png([200, 120, 40]),
      name: `${tag}.png`,
      type: 'image/png',
    });
    const sent = await adapter.inbox.reply(id, { body: '', attachments: [blob.signedId] });
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]?.url).toMatch(/^https?:\/\//);
    const empty = await adapter.inbox.reply(id, { body: '' }).catch((e: unknown) => e);
    expect(isSpreeError(empty) && empty.kind).toBe('invalid');
  });

  proves('inbox', 'assigns and unassigns, and lists by assignee', async (skip) => {
    const id = ready(skip);
    if (!me) skip("can't find the signed-in admin's user id through docker compose exec");
    const assigned = await adapter.inbox.update(id, { assigneeId: me });
    expect(assigned.assignee?.id).toBe(me);
    const mine = await adapter.inbox.list({ assignee: 'me', query: tag });
    expect(mine.items.map((x) => x.id)).toContain(id);
    const unassigned = await adapter.inbox.update(id, { assigneeId: null });
    expect(unassigned.assignee).toBeNull();
    const nobody = await adapter.inbox.list({ assignee: 'unassigned', query: tag });
    expect(nobody.items.map((x) => x.id)).toContain(id);
  });

  proves(
    'inbox',
    'assigns to the signed-in admin with assignee_id "me", as the app sends it',
    async (skip) => {
      const id = ready(skip);
      const res = await adapter.inbox.update(id, { assigneeId: 'me' }).catch((e: unknown) => e);
      if (isSpreeError(res) && res.kind === 'invalid')
        skip(`the store doesn't resolve assignee_id "me" yet (${res.message})`);
      expect(res).toMatchObject({ assignee: { id: me ?? expect.any(String) } });
      await adapter.inbox.update(id, { assigneeId: null });
    },
  );

  proves('inbox', 'snoozes, closes and reopens', async (skip) => {
    const id = ready(skip);
    const until = new Date(Date.now() + 24 * 3_600_000).toISOString();
    const snoozed = await adapter.inbox.update(id, { status: 'snoozed', snoozedUntil: until });
    expect(snoozed.status).toBe('snoozed');
    expect(Date.parse(snoozed.snoozedUntil ?? '')).toBe(Date.parse(until.replace(/\.\d+Z$/, 'Z')));
    const closed = await adapter.inbox.update(id, { status: 'closed', snoozedUntil: null });
    expect(closed).toMatchObject({ status: 'closed', snoozedUntil: null });
    expect((await adapter.inbox.list({ status: 'closed', query: tag })).items.map((x) => x.id)).toContain(id);
    expect((await adapter.inbox.update(id, { status: 'open' })).status).toBe('open');
  });

  proves('inbox', 'marks read and counts for the badge', async (skip) => {
    const id = ready(skip);
    const before = await adapter.inbox.summary();
    expect(before).toEqual({
      open: expect.any(Number),
      unassigned: expect.any(Number),
      unread: expect.any(Number),
    });
    await adapter.inbox.markRead(id);
    expect((await adapter.inbox.get(id)).unread).toBe(0);
    expect((await adapter.inbox.summary()).unread).toBeLessThanOrEqual(before.unread);
  });

  proves('inbox', 'says plainly when a conversation is gone', async (skip) => {
    ready(skip);
    await expect(adapter.inbox.get('999999999')).rejects.toMatchObject({ kind: 'notFound' });
  });
});
