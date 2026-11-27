import { describe, expect, it } from 'vitest';
import {
  AdminField,
  AdminFilter,
  AdminRecord,
  AdminResource,
  adminReference,
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
    expect(isWritableField({ ...name, type: 'image' })).toBe(false);
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
    });
  });
});
