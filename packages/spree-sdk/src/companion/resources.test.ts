import { describe, expect, it, vi } from 'vitest';
import fixtures from '../../test/fixtures/admin-types-0.5.json';
import { createAdapter } from '../adapters';
import { fakeTransport } from '../adapters/fakeTransport.test-helper';
import { parseFieldErrors, SpreeError } from '../errors';
import { createTransport, type FetchLike } from '../transport';
import { CONFLICT_MESSAGE, companionResources, mapGemRecord, mapGemResource } from './resources';

/** As the gem's integration test (test_manifest_lists_available_types_only_and_hides_secrets) sees it. */
const reasons = {
  key: 't_refund_reasons',
  label: 'Refund reasons',
  group: 'Payments',
  title_field: 'name',
  list_fields: ['name', 'active', 'mutable'],
  searchable: true,
  filters: [{ name: 'active', label: 'Active', options: [true, false] }],
  fields: [
    { name: 'name', type: 'string', label: 'Name', required: true, readonly: false },
    { name: 'active', type: 'boolean', label: 'Active', required: false, readonly: false },
    { name: 'created_at', type: 'datetime', label: 'Created at', required: false, readonly: true },
    { name: 'geo', type: 'geo_point', label: 'Geo' },
  ],
  create: true,
  update: true,
  destroy: true,
  actions: [{ name: 'retire', label: 'Retire', confirm: 'Stop offering this reason?', destructive: false }],
};

const record = {
  id: '4',
  title: 'Damaged',
  subtitle: null,
  values: { name: 'Damaged', active: true, created_at: '2026-11-01T10:00:00Z', geo: null },
  actions: ['retire'],
};

describe('companion resources', () => {
  it('maps the manifest and drops entries it cannot read', async () => {
    const { transport } = fakeTransport(() => ({ data: [reasons, { label: 'No key' }] }));
    const { types, meta } = await companionResources(transport).manifest();
    const [r, ...rest] = types;
    expect(meta).toEqual({ gemVersion: null });
    expect(rest).toEqual([]);
    expect(r).toMatchObject({
      key: 't_refund_reasons',
      group: 'Payments',
      icon: null,
      titleField: 'name',
      subtitleField: null,
      listFields: ['name', 'active', 'mutable'],
      searchable: true,
      filters: [
        {
          name: 'active',
          options: [
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
          ],
        },
      ],
      actions: [
        { name: 'retire', label: 'Retire', confirm: 'Stop offering this reason?', destructive: false },
      ],
    });
    expect(r?.fields.map((f) => [f.name, f.type, f.rawType])).toEqual([
      ['name', 'string', 'string'],
      ['active', 'boolean', 'boolean'],
      ['created_at', 'datetime', 'datetime'],
      ['geo', 'unknown', 'geo_point'],
    ]);
    expect(r?.fields[0]?.required).toBe(true);
  });

  it('fills labels the host left out', () => {
    expect(
      mapGemResource({ key: 'menu_items', fields: [{ name: 'menu_location_id', type: 'reference' }] }),
    ).toMatchObject({ label: 'Menu items', group: 'More', fields: [{ label: 'Menu location' }] });
  });

  it('lists with search, filters and page cursors', async () => {
    const { transport, calls } = fakeTransport(() => ({
      data: [record],
      meta: { page: 1, per_page: 1, total_count: 2 },
    }));
    const port = companionResources(transport);
    const page = await port.list('t_refund_reasons', {
      query: ' zebra ',
      filters: { active: false, kind: null },
      perPage: 1,
    });
    expect(calls[0]?.url).toBe(
      '/api/admin_native/v1/resources/t_refund_reasons?q=zebra&filter[active]=false&page=1&per_page=1',
    );
    expect(page).toMatchObject({ nextCursor: '2', totalCount: 2, items: [{ id: '4', title: 'Damaged' }] });
    await port.list('t_refund_reasons', { cursor: '2', perPage: 1 });
    expect(calls[1]?.url).toBe('/api/admin_native/v1/resources/t_refund_reasons?page=2&per_page=1');
  });

  it('reads, writes, deletes and runs actions with escaped paths', async () => {
    const { transport, calls } = fakeTransport((method, url) => {
      if (method === 'DELETE') return null;
      if (url.includes('/actions/')) return { data: { ...record, actions: [] }, message: 'Retired.' };
      return { data: record };
    });
    const port = companionResources(transport);
    expect((await port.get('t_refund_reasons', '4')).values.active).toBe(true);
    await port.create('t_refund_reasons', { name: 'Wrong size' });
    await port.update('t_refund_reasons', '4', { name: 'Damaged box' });
    await port.remove('t_refund_reasons', 'a/b');
    const done = await port.perform('t_refund_reasons', '4', 'retire');
    expect(done).toMatchObject({ message: 'Retired.', record: { actions: [] } });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['GET', '/api/admin_native/v1/resources/t_refund_reasons/4', undefined],
      ['POST', '/api/admin_native/v1/resources/t_refund_reasons', { values: { name: 'Wrong size' } }],
      ['PATCH', '/api/admin_native/v1/resources/t_refund_reasons/4', { values: { name: 'Damaged box' } }],
      ['DELETE', '/api/admin_native/v1/resources/t_refund_reasons/a%2Fb', undefined],
      ['POST', '/api/admin_native/v1/resources/t_refund_reasons/4/actions/retire', undefined],
    ]);
  });

  it("reads the gem's per-field validation errors", () => {
    expect(
      parseFieldErrors({
        error: { code: 'invalid', message: "Name can't be blank", fields: { name: ["can't be blank"] } },
      }),
    ).toEqual({ name: ["can't be blank"] });
    expect(parseFieldErrors({ error: { code: 'not_found', message: 'No such admin type.' } })).toEqual({});
  });

  it('is the gem port on any family with the gem and unsupported without it', async () => {
    const { transport } = fakeTransport(() => ({ data: [] }));
    for (const family of ['api-v1', 'platform-v2', 'admin-v3'] as const) {
      expect(await createAdapter(family, transport, { companion: true }).resources.manifest()).toEqual({
        types: [],
        meta: { gemVersion: null },
      });
      await expect(createAdapter(family, transport).resources.manifest()).rejects.toMatchObject({
        kind: 'capability',
      });
    }
    await expect(createAdapter('api-v1', transport).resources.list('x', {})).rejects.toBeInstanceOf(
      SpreeError,
    );
  });
});

/** A transport over a fetch that answers each call with the next reply, as a store would. */
function replying(...replies: { status: number; body?: unknown }[]) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = replies.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { port: companionResources(createTransport({ baseUrl: 'https://shop.test', fetch })), calls };
}

describe('companion resources, gem 0.5', () => {
  it('maps the 0.5 manifest: singular, hidden, defaults, typed filters, action inputs, writable images', async () => {
    const { transport } = fakeTransport(() => fixtures.manifest);
    const { types, meta } = await companionResources(transport).manifest();
    expect(meta).toEqual({ gemVersion: '0.5.0' });
    const type = (key: string) => types.find((t) => t.key === key);
    expect(type('refund_reasons')).toMatchObject({ singular: 'Refund reason', hidden: false });
    expect(type('refund_reasons')?.fields.find((f) => f.name === 'active')?.default).toBe(true);
    expect(type('refund_reasons')?.fields.find((f) => f.name === 'code')?.default).toBeNull();
    expect(type('refund_reasons')?.actions.find((a) => a.name === 'rename')?.inputs).toMatchObject([
      { name: 'new_name', type: 'string', label: 'New name', required: true, readonly: false, default: null },
      { name: 'notify', type: 'boolean', required: false, default: true },
    ]);
    expect(type('refund_reasons')?.actions.find((a) => a.name === 'retire')?.inputs).toEqual([]);
    expect(type('zones')?.filters.map((f) => [f.name, f.type])).toEqual([
      ['kind', 'enum'],
      ['description', 'presence'],
      ['created_at', 'date_range'],
      ['name', 'enum'],
    ]);
    // A plain equality filter: enum without options, which the app can't offer (as in 0.4).
    expect(type('zones')?.filters[3]?.options).toEqual([]);
    expect(type('states')?.filters[0]).toMatchObject({ type: 'reference', resource: 'countries' });
    expect(type('product_images')?.fields.find((f) => f.name === 'attachment')).toMatchObject({
      type: 'image',
      readonly: false,
    });
    expect(type('spree_products')).toMatchObject({
      hidden: true,
      group: 'Spree',
      subtitleField: 'slug',
      searchable: true,
    });
    // A computed subtitle: no subtitle_field in the manifest, but the record carries one.
    expect(type('spree_variants')).toMatchObject({ hidden: true, titleField: 'sku', subtitleField: null });
    expect(mapGemRecord(fixtures.variant.data)).toMatchObject({
      title: 'ROR-00012',
      subtitle: 'Ruby on Rails Tote',
      version: null,
    });
  });

  it('keeps image and file fields read-only for a gem before 0.5', async () => {
    const manifest = { data: fixtures.manifest.data };
    const { transport } = fakeTransport(() => manifest);
    const { types, meta } = await companionResources(transport).manifest();
    expect(meta.gemVersion).toBeNull();
    const images = types.find((t) => t.key === 'product_images');
    expect(images?.fields.find((f) => f.name === 'attachment')?.readonly).toBe(true);
    expect(
      mapGemResource({ key: 'docs', fields: [{ name: 'document', type: 'file', readonly: false }] }, '0.4.0')
        ?.fields[0],
    ).toMatchObject({ type: 'file', readonly: true });
  });

  it('reads per-record rules and versions, and defaults them for 0.4 records', () => {
    expect(mapGemRecord(fixtures.zoneWithMembers.data)).toMatchObject({
      can: { update: true, destroy: false },
      version: '2026-11-27T10:00:00.123456Z',
    });
    expect(mapGemRecord(fixtures.fileRecord.data)).toMatchObject({ can: { update: false }, version: 3 });
    expect(mapGemRecord(record)).toMatchObject({ can: { update: true, destroy: true }, version: null });
  });

  it('filters by reference, presence and date range', async () => {
    const { transport, calls } = fakeTransport(() => ({
      data: [],
      meta: { page: 1, per_page: 25, total_count: 0 },
    }));
    const port = companionResources(transport);
    await port.list('zones', {
      filters: {
        description: 'unset',
        created_at: { from: '2026-11-01', to: '2026-11-30' },
        updated_at: { from: '', to: null },
      },
    });
    await port.list('zones', { filters: { created_at: { to: '2026-11-30' } } });
    await port.list('states', { filters: { country_id: '38' } });
    expect(calls.map((c) => c.url)).toEqual([
      '/api/admin_native/v1/resources/zones?filter[description]=unset&filter[created_at][from]=2026-11-01&filter[created_at][to]=2026-11-30&page=1&per_page=25',
      '/api/admin_native/v1/resources/zones?filter[created_at][to]=2026-11-30&page=1&per_page=25',
      '/api/admin_native/v1/resources/states?filter[country_id]=38&page=1&per_page=25',
    ]);
  });

  it('sends the version with an update and the input with an action', async () => {
    const { transport, calls } = fakeTransport((_method, url) =>
      url.includes('/actions/') ? fixtures.renamed : fixtures.zoneWithMembers,
    );
    const port = companionResources(transport);
    await port.update('zones', '1', { name: 'EU' }, '2026-11-27T10:00:00.123456Z');
    await port.update('zones', '1', { name: 'EU' }, null);
    const renamed = await port.perform('refund_reasons', '4', 'rename', { new_name: 'Broken' });
    await port.perform('refund_reasons', '4', 'retire', {});
    expect(renamed).toMatchObject({ message: 'Renamed.', removed: false, record: { title: 'Broken' } });
    expect(calls.map((c) => c.body)).toEqual([
      { values: { name: 'EU' }, version: '2026-11-27T10:00:00.123456Z' },
      { values: { name: 'EU' } },
      { input: { new_name: 'Broken' } },
      undefined,
    ]);
  });

  it('reads a removed result', async () => {
    const { transport } = fakeTransport(() => fixtures.discarded);
    expect(await companionResources(transport).perform('zones', '1', 'discard')).toEqual({
      record: null,
      message: 'Discarded.',
      removed: true,
    });
  });

  it('turns a 409 into a conflict error and keeps 422 input errors per field', async () => {
    const { port } = replying(
      { status: 409, body: fixtures.conflict },
      { status: 409 },
      { status: 422, body: fixtures.missingInput },
    );
    await expect(port.update('zones', '1', { name: 'EU' }, 1)).rejects.toMatchObject({
      kind: 'conflict',
      status: 409,
      message: 'Someone else changed this. Reload to see their changes.',
    });
    await expect(port.update('zones', '1', { name: 'EU' }, 1)).rejects.toMatchObject({
      kind: 'conflict',
      message: CONFLICT_MESSAGE,
    });
    await expect(port.perform('refund_reasons', '4', 'rename', { note: 'x' })).rejects.toMatchObject({
      kind: 'invalid',
      fieldErrors: { new_name: ["can't be blank"] },
    });
  });

  it('uploads a file as multipart and returns the blob', async () => {
    const { port, calls } = replying(
      { status: 201, body: fixtures.upload },
      { status: 413, body: fixtures.tooLarge },
    );
    const blob = await port.upload({ name: 'back.png', type: 'image/png', blob: new Blob(['x']) });
    expect(blob).toEqual({
      signedId: fixtures.upload.data.signed_id,
      filename: 'back.png',
      contentType: 'image/png',
      byteSize: 1234,
      url: fixtures.upload.data.url,
    });
    expect(calls[0]?.url).toBe('https://shop.test/api/admin_native/v1/resources/uploads');
    expect(calls[0]?.init.method).toBe('POST');
    const form = calls[0]?.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((form.get('file') as File).name).toBe('back.png');
    await expect(
      port.upload({ name: 'big.mov', type: 'video/quicktime', blob: new Blob(['x']) }),
    ).rejects.toMatchObject({ kind: 'invalid', status: 413, message: expect.stringMatching(/25 MB/) });
  });

  it('uploads a React Native file reference as a { uri, name, type } part', async () => {
    const { transport, calls } = fakeTransport(() => fixtures.upload);
    const append = vi.spyOn(FormData.prototype, 'append').mockImplementation(() => undefined);
    await companionResources(transport).upload({
      uri: 'file:///tmp/terms.pdf',
      name: 'terms.pdf',
      type: 'application/pdf',
    });
    expect(append).toHaveBeenCalledWith('file', {
      uri: 'file:///tmp/terms.pdf',
      name: 'terms.pdf',
      type: 'application/pdf',
    });
    append.mockRestore();
    expect(calls[0]?.url).toBe('/api/admin_native/v1/resources/uploads');
  });
});
