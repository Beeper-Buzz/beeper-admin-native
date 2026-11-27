import { type AdminResource, gemAtLeast } from '@instincts/spree-domain';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createAdapter } from '../src/adapters';
import { probeStore } from '../src/capabilities/probe';
import type { StoreProbe } from '../src/capabilities/types';
import { isSpreeError } from '../src/errors';
import type { SpreeAdapter } from '../src/ports';
import type { Transport } from '../src/transport';
import { baseTransport, enabled, env, proves, signIn, writeResults } from './env';
import { png } from './png';

/**
 * Host-described admin types (companion gem 0.4+) against the demo types the Spree 4.2 store
 * registers (infra/spree/4.2/initializers/admin_native_demo_types.rb). Stores without the gem, or
 * without those types, skip; the gem 0.5 cases skip on a 0.4 gem. Everything created here is
 * deleted again.
 */
const DEMO = ['refund_reasons', 'zones', 'countries', 'states'];
/** Demo types the gem 0.5 cases add (docs/superpowers/specs/2026-11-27-admin-types-0.5.md). */
const DEMO_05 = [...DEMO, 'product_images', 'option_types'];
const LOOKUPS = ['spree_users', 'spree_products', 'spree_variants', 'spree_orders'];

/** A UTC day `days` from today, as YYYY-MM-DD. */
const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe.runIf(enabled)(`contract: admin types on Spree ${env.label}`, () => {
  let adapter: SpreeAdapter;
  let api: Transport;
  let probe: StoreProbe;
  let manifest: AdminResource[] = [];
  let gemVersion: string | null = null;
  const tag = `CT${Date.now().toString(36).toUpperCase()}`;
  const created: [key: string, id: string][] = [];

  beforeAll(async () => {
    probe = await probeStore({ baseUrl: env.url, timeoutMs: 10_000 });
    // Nothing to prove without the capability; skip the sign-in too (Spree 6 rate-limits JWT logins).
    if (!probe.capabilities.includes('admin.resources')) return;
    const transport = baseTransport();
    const auth = await signIn(transport);
    api = transport.withAuth(auth);
    adapter = createAdapter(env.family ?? probe.preferredApi, api, {
      companion: probe.gem !== null,
    });
    ({
      types: manifest,
      meta: { gemVersion },
    } = await adapter.resources.manifest());
  });

  /** Other clean-ups (a product and its photos), run before the created records are deleted. */
  const cleanups: (() => Promise<unknown>)[] = [];

  afterAll(async () => {
    for (const undo of cleanups.reverse()) await undo().catch(() => undefined);
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
    });
    // Gem 0.5 adds a `rename` action to the demo type; the 0.4 ones are the same.
    expect(reasons?.actions.slice(0, 2)).toMatchObject([
      { name: 'retire', label: 'Retire', destructive: true, confirm: expect.any(String) },
      { name: 'reinstate', label: 'Offer again', destructive: false, confirm: null },
    ]);
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
    // Conditional actions; gem 0.5's `rename` has no condition, so it is always listed too.
    const conditional = (actions: string[]) => actions.filter((a) => a !== 'rename');
    expect(conditional(reason.actions)).toEqual(['retire']);
    const retired = await adapter.resources.perform('refund_reasons', reason.id, 'retire');
    expect(retired.message).toMatch(/Retired/);
    expect(retired.record).toMatchObject({ values: { active: false } });
    expect(conditional(retired.record?.actions ?? [])).toEqual(['reinstate']);
    await expect(adapter.resources.perform('refund_reasons', reason.id, 'retire')).rejects.toMatchObject({
      kind: 'invalid',
    });
    const back = await adapter.resources.perform('refund_reasons', reason.id, 'reinstate');
    expect(back.message).toBe('Offered again.');
    expect(conditional(back.record?.actions ?? [])).toEqual(['retire']);
  });

  // --- Gem 0.5 -------------------------------------------------------------------------------

  /** Skips unless the store runs gem 0.5+ with the 0.5 demo types. */
  const demo05 = (skip: (why: string) => never) => {
    demo(skip);
    if (!gemAtLeast(gemVersion, '0.5'))
      skip(`needs the companion gem 0.5 (store has ${gemVersion ?? '0.4'})`);
    const keys = manifest.map((t) => t.key);
    if (!DEMO_05.every((k) => keys.includes(k)))
      skip('the 0.5 demo admin types are not registered on this store');
  };
  const typeOf = (key: string) => {
    const t = manifest.find((x) => x.key === key);
    if (!t) throw new Error(`no ${key} type`);
    return t;
  };
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => {
        throw new Error('expected the store to refuse this');
      },
      (e: unknown) => {
        if (!isSpreeError(e)) throw e;
        return e;
      },
    );

  proves(
    'admin.resources',
    'gem 0.5: singular, defaults and an action with a required input',
    async (skip) => {
      demo05(skip);
      const reasons = typeOf('refund_reasons');
      expect(reasons.singular).toBe('Refund reason');
      expect(reasons.hidden).toBe(false);
      expect(reasons.fields.find((f) => f.name === 'active')?.default).toBe(true);
      const rename = reasons.actions.find((a) => a.name === 'rename');
      expect(rename?.inputs).toMatchObject([
        { name: 'new_name', type: 'string', label: 'New name', required: true, readonly: false },
      ]);
      // Inputs only on actions that declare them.
      expect(reasons.actions.find((a) => a.name === 'retire')?.inputs).toEqual([]);

      const reason = await create('refund_reasons', { name: `${tag} rename me` });
      // The `active` default applies when the app sends nothing for it.
      expect(reason.values.active).toBe(true);
      expect(reason.can).toEqual({ update: true, destroy: true });

      const missing = await failure(adapter.resources.perform('refund_reasons', reason.id, 'rename', {}));
      expect(missing).toMatchObject({ kind: 'invalid', status: 422 });
      expect(missing.fieldErrors?.new_name?.length).toBeGreaterThan(0);
      const blank = await failure(
        adapter.resources.perform('refund_reasons', reason.id, 'rename', { new_name: '' }),
      );
      expect(blank.fieldErrors?.new_name?.length).toBeGreaterThan(0);

      const renamed = await adapter.resources.perform('refund_reasons', reason.id, 'rename', {
        new_name: `${tag} renamed`,
        ignored_key: 'unknown inputs are ignored',
      });
      expect(renamed).toMatchObject({
        message: 'Renamed.',
        removed: false,
        record: { id: reason.id, title: `${tag} renamed`, values: { name: `${tag} renamed` } },
      });
    },
  );

  proves('admin.resources', 'gem 0.5: presence and date-range filters', async (skip) => {
    demo05(skip);
    const zones = typeOf('zones');
    expect(zones.filters.find((f) => f.name === 'description')).toMatchObject({ type: 'presence' });
    expect(zones.filters.find((f) => f.name === 'created_at')).toMatchObject({ type: 'date_range' });
    expect(zones.filters.find((f) => f.name === 'kind')).toMatchObject({ type: 'enum' });

    const described = await create('zones', {
      name: `${tag} described`,
      kind: 'state',
      description: 'Has one',
    });
    const bare = await create('zones', { name: `${tag} bare`, kind: 'state' });
    const titles = async (filters: Record<string, unknown>) =>
      (await adapter.resources.list('zones', { query: tag, filters: filters as never, perPage: 100 })).items
        .map((r) => r.title)
        .sort();
    expect(await titles({ description: 'set' })).toEqual([described.title]);
    expect(await titles({ description: 'unset' })).toEqual([bare.title]);
    // Inclusive days in the store's time zone: a few days either side of today holds both.
    expect(await titles({ created_at: { from: day(-2), to: day(2) } })).toEqual(
      [bare.title, described.title].sort(),
    );
    expect(await titles({ created_at: { from: day(3) } })).toEqual([]);
    expect(await titles({ created_at: { to: day(-3) } })).toEqual([]);
    expect(await titles({ created_at: { from: day(-2) }, description: 'set' })).toEqual([described.title]);
  });

  proves('admin.resources', 'gem 0.5: per-record delete rule and an action that removes', async (skip) => {
    demo05(skip);
    // The sample data's zones have members, so the demo's deletable_if refuses them.
    const all = await adapter.resources.list('zones', { perPage: 100 });
    const withMembers = all.items.find((z) => Number(z.values.zone_members_count) > 0);
    if (!withMembers) throw new Error('the store has no zone with members');
    expect(withMembers.can).toEqual({ update: true, destroy: false });
    await expect(adapter.resources.remove('zones', withMembers.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });

    const zone = await create('zones', { name: `${tag} discard me`, kind: 'country' });
    expect(zone.can.destroy).toBe(true);
    const discard = typeOf('zones').actions.find((a) => a.name === 'discard');
    expect(discard).toMatchObject({ destructive: true, confirm: expect.any(String), inputs: [] });
    expect(zone.actions).toContain('discard');
    const result = await adapter.resources.perform('zones', zone.id, 'discard');
    expect(result).toEqual({ record: null, removed: true, message: 'Discarded.' });
    await expect(adapter.resources.get('zones', zone.id)).rejects.toMatchObject({ kind: 'notFound' });
  });

  proves('admin.resources', 'gem 0.5: a reference filter', async (skip) => {
    demo05(skip);
    expect(typeOf('states').filters.find((f) => f.name === 'country_id')).toMatchObject({
      type: 'reference',
      resource: 'countries',
    });
    const country = async (q: string) => {
      const [c] = (await adapter.resources.list('countries', { query: q, perPage: 1 })).items;
      if (!c) throw new Error(`the store has no ${q}`);
      return c;
    };
    const us = await country('united states');
    const states = await adapter.resources.list('states', { filters: { country_id: us.id }, perPage: 100 });
    expect(states.totalCount).toBeGreaterThan(0);
    expect(states.items.every((s) => (s.values.country_id as { id: string }).id === us.id)).toBe(true);
    // References in a list come with their titles (preloaded per page).
    expect(states.items[0]?.values.country_id).toEqual({ id: us.id, title: 'United States' });
    const all = await adapter.resources.list('states', { perPage: 1 });
    expect(all.totalCount ?? 0).toBeGreaterThan(states.totalCount ?? 0);
  });

  proves(
    'admin.resources',
    'gem 0.5: uploads replace a product image; before_save refuses empty alt',
    async (skip) => {
      demo05(skip);
      const images = typeOf('product_images');
      expect(images).toMatchObject({ create: false, update: true, destroy: false });
      expect(images.fields.find((f) => f.name === 'attachment')).toMatchObject({
        type: 'image',
        readonly: false,
      });
      expect(images.fields.find((f) => f.name === 'viewable_id')).toMatchObject({ readonly: true });

      // A product of its own, with one photo uploaded through the products media port.
      const sample = await api.request<{ products: { id: number; shipping_category_id: number }[] }>({
        path: '/api/v1/products',
        query: { per_page: 1 },
      });
      const shippingCategoryId = sample.data.products[0]?.shipping_category_id;
      const product = await api.request<{ id: number }>({
        method: 'POST',
        path: '/api/v1/products',
        body: {
          product: { name: `${tag} image product`, price: '9.99', shipping_category_id: shippingCategoryId },
        },
      });
      const productRef = { id: String(product.data.id) };
      cleanups.push(() => api.request({ method: 'DELETE', path: `/api/v1/products/${product.data.id}` }));
      const gallery = await adapter.media.upload(productRef, {
        file: { blob: png([30, 160, 90]), name: `${tag}-front.png`, type: 'image/png' },
        alt: `${tag} front`,
      });
      const photo = gallery.find((i) => i.alt === `${tag} front`);
      if (!photo) throw new Error('the uploaded photo is not in the gallery');
      cleanups.push(() => adapter.media.remove(productRef, photo.id));

      const before = await adapter.resources.get('product_images', photo.id);
      expect(before).toMatchObject({ title: `${tag} front`, can: { update: true, destroy: false } });
      expect(typeof before.values.attachment).toBe('string');
      const found = await adapter.resources.list('product_images', { query: tag });
      expect(found.items.map((r) => r.id)).toEqual([photo.id]);

      const blob = await adapter.resources.upload({
        blob: png([220, 120, 20]),
        name: `${tag}-back.png`,
        type: 'image/png',
      });
      expect(blob).toMatchObject({ filename: `${tag}-back.png`, contentType: 'image/png' });
      expect(blob.signedId.length).toBeGreaterThan(10);
      expect(blob.byteSize).toBeGreaterThan(0);

      const replaced = await adapter.resources.update(
        'product_images',
        photo.id,
        { attachment: blob.signedId },
        before.version,
      );
      expect(typeof replaced.values.attachment).toBe('string');
      expect(replaced.values.attachment).not.toBe(before.values.attachment);
      expect(String(replaced.values.attachment)).toContain(`${tag}-back.png`);

      const notUpload = await failure(
        adapter.resources.update('product_images', photo.id, { attachment: 'not-a-signed-id' }),
      );
      expect(notUpload).toMatchObject({ kind: 'invalid', status: 422 });
      expect(notUpload.fieldErrors?.attachment?.length).toBeGreaterThan(0);

      const noAlt = await failure(adapter.resources.update('product_images', photo.id, { alt: ' ' }));
      expect(noAlt).toMatchObject({ kind: 'invalid', status: 422 });
      expect(noAlt.fieldErrors?.alt).toContain("Alt text can't be blank");
      expect(noAlt.message).toContain("Alt text can't be blank");
      expect((await adapter.resources.get('product_images', photo.id)).values.alt).toBe(`${tag} front`);
    },
  );

  proves('admin.resources', 'gem 0.5: a stale version is a conflict', async (skip) => {
    demo05(skip);
    const zone = await create('zones', { name: `${tag} versioned`, kind: 'state' });
    expect(zone.version).not.toBeNull();
    const first = await adapter.resources.update(
      'zones',
      zone.id,
      { name: `${tag} versioned 2` },
      zone.version,
    );
    expect(first.version).not.toEqual(zone.version);
    const stale = await failure(
      adapter.resources.update('zones', zone.id, { name: `${tag} versioned 3` }, zone.version),
    );
    expect(stale).toMatchObject({ kind: 'conflict', status: 409, message: expect.stringMatching(/Reload/) });
    expect((await adapter.resources.get('zones', zone.id)).title).toBe(`${tag} versioned 2`);
    // The current version still saves.
    const second = await adapter.resources.update(
      'zones',
      zone.id,
      { name: `${tag} versioned 3` },
      first.version,
    );
    expect(second.title).toBe(`${tag} versioned 3`);
  });

  proves(
    'admin.resources',
    'gem 0.5: built-in lookups are hidden, read-only, listed and searchable',
    async (skip) => {
      demo05(skip);
      for (const key of LOOKUPS)
        expect(typeOf(key)).toMatchObject({
          hidden: true,
          create: false,
          update: false,
          destroy: false,
          searchable: true,
        });
      const users = await adapter.resources.list('spree_users', { query: 'admin@example.com' });
      expect(users.items.map((u) => u.title)).toContain('admin@example.com');

      const [product] = (await adapter.resources.list('spree_products', { perPage: 1 })).items;
      if (!product) throw new Error('the store has no products');
      const byName = await adapter.resources.list('spree_products', { query: product.title });
      expect(byName.items.map((p) => p.id)).toContain(product.id);
      expect(product.subtitle).toBeTruthy();

      const [variant] = (await adapter.resources.list('spree_variants', { perPage: 1 })).items;
      if (!variant) throw new Error('the store has no variants');
      // The subtitle is the product's name, computed by the gem.
      expect(variant.subtitle).toBeTruthy();
      if (variant.title !== `#${variant.id}`) {
        const bySku = await adapter.resources.list('spree_variants', { query: variant.title });
        expect(bySku.items.map((v) => v.id)).toContain(variant.id);
      }

      const [order] = (await adapter.resources.list('spree_orders', { perPage: 1 })).items;
      if (!order) throw new Error('the store has no orders');
      const byNumber = await adapter.resources.list('spree_orders', { query: order.title });
      expect(byNumber.items.map((o) => o.id)).toContain(order.id);
      await expect(adapter.resources.create('spree_products', { name: 'Nope' })).rejects.toMatchObject({
        kind: 'forbidden',
      });
    },
  );

  proves('admin.resources', "gem 0.5: configure adds option types' presentation search", async (skip) => {
    demo05(skip);
    expect(typeOf('option_types')).toMatchObject({ titleField: 'presentation', searchable: true });
    const name = `ct-${tag.toLowerCase()}`;
    const optionType = await create('option_types', { name, presentation: `Shade ${tag}` });
    expect(optionType.title).toBe(`Shade ${tag}`);
    // "shade" is only in the presentation, which the later configure call made searchable.
    const found = await adapter.resources.list('option_types', { query: `shade ${tag.toLowerCase()}` });
    expect(found.items.map((o) => o.id)).toEqual([optionType.id]);
    const byName = await adapter.resources.list('option_types', { query: name });
    expect(byName.items.map((o) => o.id)).toEqual([optionType.id]);
  });
});
