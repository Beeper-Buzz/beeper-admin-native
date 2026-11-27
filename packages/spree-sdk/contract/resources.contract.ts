import type { AdminResource } from '@instincts/spree-domain';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createAdapter } from '../src/adapters';
import { probeStore } from '../src/capabilities/probe';
import type { StoreProbe } from '../src/capabilities/types';
import { isSpreeError } from '../src/errors';
import type { SpreeAdapter } from '../src/ports';
import { baseTransport, enabled, env, proves, signIn, writeResults } from './env';

/**
 * Host-described admin types (companion gem 0.4) against the demo types the Spree 4.2 store
 * registers (infra/spree/4.2/initializers/admin_native_demo_types.rb). Stores without the gem, or
 * without those types, skip. Everything created here is deleted again.
 */
const DEMO = ['refund_reasons', 'zones', 'countries', 'states'];

describe.runIf(enabled)(`contract: admin types on Spree ${env.label}`, () => {
  let adapter: SpreeAdapter;
  let probe: StoreProbe;
  let manifest: AdminResource[] = [];
  const tag = `CT${Date.now().toString(36).toUpperCase()}`;
  const created: [key: string, id: string][] = [];

  beforeAll(async () => {
    probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
    // Nothing to prove without the capability; skip the sign-in too (Spree 6 rate-limits JWT logins).
    if (!probe.capabilities.includes('admin.resources')) return;
    const transport = baseTransport();
    const auth = await signIn(transport);
    adapter = createAdapter(env.family ?? probe.preferredApi, transport.withAuth(auth), {
      companion: probe.gem !== null,
    });
    manifest = await adapter.resources.manifest();
  });

  afterAll(async () => {
    for (const [key, id] of created.reverse()) await adapter.resources.remove(key, id).catch(() => undefined);
    writeResults();
  });

  /** Skips unless the store announces admin types and has the demo ones. */
  const demo = (skip: (why: string) => never) => {
    if (!probe.capabilities.includes('admin.resources'))
      skip('no admin.resources (needs the companion gem 0.4 with registered types)');
    const keys = manifest.map((t) => t.key);
    if (!DEMO.every((k) => keys.includes(k))) skip('the demo admin types are not registered on this store');
  };
  const create = async (key: string, values: Record<string, unknown>) => {
    const record = await adapter.resources.create(key, values);
    created.push([key, record.id]);
    return record;
  };

  proves('admin.resources', 'describes the demo types in the manifest', async (skip) => {
    demo(skip);
    const reasons = manifest.find((t) => t.key === 'refund_reasons');
    expect(reasons).toMatchObject({
      label: 'Refund reasons',
      group: 'Payments',
      icon: 'arrow.uturn.backward',
      titleField: 'name',
      searchable: true,
      create: true,
      update: true,
      destroy: true,
      filters: [{ name: 'active', options: [{ value: true }, { value: false }] }],
      actions: [
        { name: 'retire', label: 'Retire', destructive: true, confirm: expect.any(String) },
        { name: 'reinstate', label: 'Offer again', destructive: false, confirm: null },
      ],
    });
    const field = (key: string, name: string) =>
      manifest.find((t) => t.key === key)?.fields.find((f) => f.name === name);
    expect(field('refund_reasons', 'name')).toMatchObject({ type: 'string', required: true });
    expect(field('refund_reasons', 'mutable')).toMatchObject({ type: 'boolean', readonly: true });
    expect(field('refund_reasons', 'created_at')).toMatchObject({ type: 'datetime', readonly: true });
    expect(field('zones', 'kind')).toMatchObject({
      type: 'enum',
      options: [
        { value: 'country', label: 'Country' },
        { value: 'state', label: 'State' },
      ],
    });
    expect(field('states', 'country_id')).toMatchObject({ type: 'reference', resource: 'countries' });
    expect(manifest.find((t) => t.key === 'countries')).toMatchObject({
      create: false,
      update: false,
      destroy: false,
    });
    expect(manifest.flatMap((t) => t.fields).every((f) => f.type !== 'unknown')).toBe(true);
  });

  proves('admin.resources', 'searches, filters and pages a list', async (skip) => {
    demo(skip);
    const us = await adapter.resources.list('countries', { query: 'united states', perPage: 5 });
    expect(us.items.map((r) => r.title)).toContain('United States');
    const page1 = await adapter.resources.list('countries', { perPage: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBe('2');
    const page2 = await adapter.resources.list('countries', { perPage: 2, cursor: page1.nextCursor });
    expect(page2.items.map((r) => r.id)).not.toContain(page1.items[0]?.id);

    await create('refund_reasons', { name: `${tag} on`, active: true });
    await create('refund_reasons', { name: `${tag} off`, active: false });
    const both = await adapter.resources.list('refund_reasons', { query: tag.toLowerCase() });
    expect(both.items.map((r) => r.title).sort()).toEqual([`${tag} off`, `${tag} on`]);
    const off = await adapter.resources.list('refund_reasons', { query: tag, filters: { active: false } });
    expect(off.items.map((r) => r.title)).toEqual([`${tag} off`]);
    expect(off.items[0]?.values.active).toBe(false);
  });

  proves('admin.resources', 'creates, refuses invalid input per field, updates and deletes', async (skip) => {
    demo(skip);
    const zone = await create('zones', { name: `${tag} zone`, kind: 'state', description: 'Contract' });
    expect(zone).toMatchObject({ title: `${tag} zone`, subtitle: 'Contract', values: { kind: 'state' } });

    const invalid = await adapter.resources.update('zones', zone.id, { name: '' }).catch((e: unknown) => e);
    expect(isSpreeError(invalid) && invalid.kind).toBe('invalid');
    expect(isSpreeError(invalid) && invalid.fieldErrors?.name?.length).toBeGreaterThan(0);

    const updated = await adapter.resources.update('zones', zone.id, {
      name: `${tag} zone 2`,
      kind: 'country',
      default_tax: false,
    });
    expect(updated).toMatchObject({
      title: `${tag} zone 2`,
      values: { kind: 'country', default_tax: false },
    });

    await adapter.resources.remove('zones', zone.id);
    await expect(adapter.resources.get('zones', zone.id)).rejects.toMatchObject({ kind: 'notFound' });
  });

  proves('admin.resources', 'references show their title and take an id', async (skip) => {
    demo(skip);
    const [country] = (await adapter.resources.list('countries', { query: 'united states', perPage: 1 }))
      .items;
    if (!country) throw new Error('the store has no United States country');
    const state = await create('states', { name: `${tag} state`, abbr: 'CX', country_id: country.id });
    expect(state.values.country_id).toEqual({ id: country.id, title: 'United States' });
    expect((await adapter.resources.get('states', state.id)).subtitle).toBe('CX');
    await expect(adapter.resources.create('countries', { name: 'Atlantis' })).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  proves('admin.resources', 'runs a member action only while it is available', async (skip) => {
    demo(skip);
    const reason = await create('refund_reasons', { name: `${tag} retire me`, active: true });
    expect(reason.actions).toEqual(['retire']);
    const retired = await adapter.resources.perform('refund_reasons', reason.id, 'retire');
    expect(retired.message).toMatch(/Retired/);
    expect(retired.record).toMatchObject({ actions: ['reinstate'], values: { active: false } });
    await expect(adapter.resources.perform('refund_reasons', reason.id, 'retire')).rejects.toMatchObject({
      kind: 'invalid',
    });
    const back = await adapter.resources.perform('refund_reasons', reason.id, 'reinstate');
    expect(back).toMatchObject({ message: 'Offered again.', record: { actions: ['retire'] } });
  });
});
