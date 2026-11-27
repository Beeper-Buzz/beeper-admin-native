import { describe, expect, it } from 'vitest';
import { createAdapter } from '../adapters';
import { fakeTransport } from '../adapters/fakeTransport.test-helper';
import { parseFieldErrors, SpreeError } from '../errors';
import { companionResources, mapGemResource } from './resources';

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
    const [r, ...rest] = await companionResources(transport).manifest();
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
      expect(await createAdapter(family, transport, { companion: true }).resources.manifest()).toEqual([]);
      await expect(createAdapter(family, transport).resources.manifest()).rejects.toMatchObject({
        kind: 'capability',
      });
    }
    await expect(createAdapter('api-v1', transport).resources.list('x', {})).rejects.toBeInstanceOf(
      SpreeError,
    );
  });
});
