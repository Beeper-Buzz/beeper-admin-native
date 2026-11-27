import { describe, expect, it } from 'vitest';
import {
  AdminAction,
  AdminField,
  AdminFilter,
  AdminRecord,
  AdminResource,
  adminFile,
  adminReference,
  formatBytes,
  gemAtLeast,
  isWritableField,
  normalizeOptions,
} from './admin-resource';

describe('admin resources', () => {
  it('keeps unknown field types as unknown and read-only for the app', () => {
    const field = AdminField.parse({ name: 'geo', type: 'geo_point', rawType: 'geo_point', label: 'Geo' });
    expect(field.type).toBe('unknown');
    expect(field.rawType).toBe('geo_point');
    expect(isWritableField(field)).toBe(false);
    expect(field).toMatchObject({ required: false, readonly: false, options: null, resource: null });
    const name = AdminField.parse({ name: 'name', type: 'string', rawType: 'string', label: 'Name' });
    expect(isWritableField(name)).toBe(true);
    expect(isWritableField({ ...name, readonly: true })).toBe(false);
    // Image and file fields take a signed blob id (gem 0.5); the SDK marks them read-only on 0.4.
    expect(isWritableField({ ...name, type: 'image' })).toBe(true);
    expect(isWritableField({ ...name, type: 'readonly' })).toBe(false);
  });

  it('normalizes options written as values, pairs or objects', () => {
    expect(normalizeOptions(['draft', 'sent_out'])).toEqual([
      { value: 'draft', label: 'Draft' },
      { value: 'sent_out', label: 'Sent out' },
    ]);
    expect(normalizeOptions([true, false])).toEqual([
      { value: true, label: 'Yes' },
      { value: false, label: 'No' },
    ]);
    expect(
      normalizeOptions([['Small', 's'], { value: 2, label: 'Two' }, { value: 3 }, { nope: 1 }, null]),
    ).toEqual([
      { value: 's', label: 'Small' },
      { value: 2, label: 'Two' },
      { value: 3, label: '3' },
    ]);
    expect(normalizeOptions(undefined)).toBeNull();
    expect(AdminFilter.parse({ name: 'kind', label: 'Kind' }).options).toEqual([]);
  });

  it('fills manifest defaults', () => {
    const r = AdminResource.parse({ key: 'menus', label: 'Menus', titleField: 'name' });
    expect(r).toMatchObject({
      group: 'More',
      icon: null,
      listFields: [],
      searchable: false,
      create: false,
      actions: [],
    });
  });

  it('reads references from objects or bare ids', () => {
    expect(adminReference({ id: '3', title: 'Canada' })).toEqual({ id: '3', title: 'Canada' });
    expect(adminReference({ id: 3, title: 'Canada' })).toEqual({ id: '3', title: 'Canada' });
    expect(adminReference(7)).toEqual({ id: '7', title: '#7' });
    expect(adminReference(null)).toBeNull();
    expect(adminReference({ title: 'x' })).toBeNull();
    expect(AdminRecord.parse({ id: '1', title: 'A' })).toEqual({
      id: '1',
      title: 'A',
      subtitle: null,
      values: {},
      actions: [],
      can: { update: true, destroy: true },
      version: null,
    });
  });
});

describe('admin resources 0.5 keys', () => {
  it('reads a 0.4 manifest as before: no singular, nothing hidden, no defaults, enum filters', () => {
    const r = AdminResource.parse({
      key: 'zones',
      label: 'Zones',
      titleField: 'name',
      filters: [{ name: 'kind', label: 'Kind', options: ['country'] }],
      fields: [{ name: 'name', type: 'string', rawType: 'string', label: 'Name' }],
      actions: [{ name: 'retire', label: 'Retire' }],
    });
    expect(r).toMatchObject({ singular: null, hidden: false });
    expect(r.fields[0]?.default).toBeNull();
    expect(r.filters[0]).toMatchObject({ type: 'enum', resource: null });
    expect(r.actions[0]?.inputs).toEqual([]);
  });

  it('reads singular, hidden, defaults, typed filters and action inputs', () => {
    const r = AdminResource.parse({
      key: 'refund_reasons',
      label: 'Refund reasons',
      singular: 'Refund reason',
      hidden: true,
      titleField: 'name',
      fields: [{ name: 'active', type: 'boolean', rawType: 'boolean', label: 'Active', default: false }],
      filters: [
        { name: 'country_id', label: 'Country', type: 'reference', resource: 'countries' },
        { name: 'locked_at', label: 'Locked', type: 'presence', options: ['set', 'unset'] },
        { name: 'created_at', label: 'Created', type: 'date_range' },
        { name: 'geo', label: 'Geo', type: 'near_me' },
      ],
    });
    expect(r).toMatchObject({ singular: 'Refund reason', hidden: true });
    expect(r.fields[0]?.default).toBe(false);
    expect(r.filters.map((f) => [f.type, f.resource])).toEqual([
      ['reference', 'countries'],
      ['presence', null],
      ['date_range', null],
      ['unknown', null],
    ]);
    const action = AdminAction.parse({
      name: 'rename',
      label: 'Rename',
      inputs: [{ name: 'new_name', type: 'string', rawType: 'string', label: 'New name', required: true }],
    });
    expect(action.inputs[0]).toMatchObject({ name: 'new_name', type: 'string', required: true });
  });

  it('reads per-record rules and versions', () => {
    expect(
      AdminRecord.parse({ id: '1', title: 'A', can: { update: false, destroy: true }, version: 3 }),
    ).toMatchObject({ can: { update: false, destroy: true }, version: 3 });
    expect(AdminRecord.parse({ id: '1', title: 'A', can: { destroy: false } }).can).toEqual({
      update: true,
      destroy: false,
    });
    expect(AdminRecord.parse({ id: '1', title: 'A', version: '2026-11-27T10:00:00.123456Z' }).version).toBe(
      '2026-11-27T10:00:00.123456Z',
    );
  });

  it('compares gem versions', () => {
    expect(gemAtLeast('0.5.0', '0.5')).toBe(true);
    expect(gemAtLeast('0.10.1', '0.5')).toBe(true);
    expect(gemAtLeast('1.0.0', '0.5')).toBe(true);
    expect(gemAtLeast('0.4.9', '0.5')).toBe(false);
    expect(gemAtLeast(null, '0.5')).toBe(false);
  });

  it('reads file values and sizes', () => {
    expect(
      adminFile({
        url: 'https://s/x.pdf',
        filename: 'x.pdf',
        content_type: 'application/pdf',
        byte_size: 2048,
      }),
    ).toEqual({ url: 'https://s/x.pdf', filename: 'x.pdf', contentType: 'application/pdf', byteSize: 2048 });
    expect(adminFile({ url: 'https://s/a/terms%20v2.pdf?x=1' })?.filename).toBe('terms v2.pdf');
    expect(adminFile(null)).toBeNull();
    expect(adminFile('https://s/x.pdf')).toBeNull();
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(formatBytes(null)).toBeNull();
  });
});
