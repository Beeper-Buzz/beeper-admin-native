import { describe, expect, it } from 'vitest';
import { adminLink, linkKinds, normalizeLinkKinds } from './admin-link';
import { AdminField, AdminResource } from './admin-resource';
import { normalizeView } from './admin-tree';

const base = { key: 'menu_items', label: 'Menu items', titleField: 'name' };
const field = { name: 'link', type: 'link', rawType: 'link', label: 'Link' };

describe('tree views', () => {
  it('reads a tree view with or without a group', () => {
    const tree = { type: 'tree', parent: 'parent_id', position: 'position', group: 'menu_location_id' };
    expect(AdminResource.parse({ ...base, view: tree }).view).toEqual(tree);
    expect(normalizeView({ type: 'tree', parent: 'parent_id', position: 'position' })).toEqual({
      type: 'tree',
      parent: 'parent_id',
      position: 'position',
      group: null,
    });
  });

  it('keeps the flat list for no view, another view or a broken tree', () => {
    expect(AdminResource.parse(base).view).toBeNull();
    expect(AdminResource.parse({ ...base, view: { type: 'board', column: 'state' } }).view).toBeNull();
    expect(AdminResource.parse({ ...base, view: { type: 'tree', parent: 'parent_id' } }).view).toBeNull();
    expect(AdminResource.parse({ ...base, view: 'tree' }).view).toBeNull();
  });
});

describe('link fields', () => {
  it('is a known field type with the spec kinds by default', () => {
    const parsed = AdminField.parse(field);
    expect(parsed.type).toBe('link');
    expect(parsed.kinds).toEqual([]);
    expect(linkKinds(parsed).map((k) => [k.kind, k.resource])).toEqual([
      ['url', null],
      ['product', 'spree_products'],
      ['taxon', 'spree_taxons'],
      ['page', 'pages'],
    ]);
    expect(AdminField.parse({ ...field, name: 'title', type: 'string' }).kinds).toEqual([]);
  });

  it('reads kinds as names, objects or a kind-to-resource map', () => {
    expect(normalizeLinkKinds(['url', 'product']).map((k) => k.kind)).toEqual(['url', 'product']);
    expect(
      normalizeLinkKinds([{ kind: 'collection', resource: 'collections', label: 'Collection' }, 'mystery']),
    ).toEqual([{ kind: 'collection', resource: 'collections', label: 'Collection' }]);
    expect(
      normalizeLinkKinds({ product: 'shop_products', page: { resource: 'cms_pages', label: 'Page' } }),
    ).toEqual([
      { kind: 'url', resource: null, label: null },
      { kind: 'product', resource: 'shop_products', label: null },
      { kind: 'page', resource: 'cms_pages', label: 'Page' },
    ]);
  });

  it('reads link values, dropping ones without what their kind needs', () => {
    expect(adminLink({ kind: 'url', url: 'https://example.com/sale' })).toEqual({
      kind: 'url',
      url: 'https://example.com/sale',
      id: null,
      title: null,
    });
    expect(adminLink({ kind: 'product', id: 4, title: 'Tote' })).toEqual({
      kind: 'product',
      url: null,
      id: '4',
      title: 'Tote',
    });
    expect(adminLink('/about')).toMatchObject({ kind: 'url', url: '/about' });
    expect(adminLink({ kind: 'product' })).toBeNull();
    expect(adminLink({ kind: 'url', url: ' ' })).toBeNull();
    expect(adminLink(null)).toBeNull();
    expect(adminLink(42)).toBeNull();
  });
});
