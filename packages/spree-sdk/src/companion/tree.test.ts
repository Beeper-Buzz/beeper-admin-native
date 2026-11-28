import { describe, expect, it } from 'vitest';
import { fakeTransport } from '../adapters/fakeTransport.test-helper';
import { unsupportedResources } from '../adapters/unsupported';
import { companion } from './index';
import { companionResources, mapGemResource } from './resources';

/** Gem 0.7 tree views and link fields (docs/superpowers/specs/2026-11-28-menus-inbox-visitors.md §1). */
const menuItems = {
  key: 'menu_items',
  label: 'Menu items',
  singular: 'Menu item',
  group: 'Content',
  title_field: 'name',
  fields: [
    { name: 'name', type: 'string', required: true },
    { name: 'menu_location_id', type: 'reference', resource: 'menu_locations', required: true },
    {
      name: 'link',
      type: 'link',
      kinds: { product: 'spree_products', taxon: 'spree_taxons', page: 'pages' },
    },
    { name: 'is_visible', type: 'boolean' },
  ],
  create: true,
  update: true,
  destroy: true,
  view: { type: 'tree', parent: 'parent_id', position: 'position', group: 'menu_location_id' },
};
const node = (id: number, name: string, children: unknown[] = []) => ({
  id,
  title: name,
  values: { name },
  children,
});
const tree = {
  data: [node(1, 'Shop', [node(2, 'Bags'), node(3, 'Shoes')]), node(4, 'About')],
  meta: { group: { id: 1, title: 'Header' } },
};

describe('tree views', () => {
  it('maps the view and the link kinds from the manifest', () => {
    const type = mapGemResource(menuItems, '0.7.0');
    expect(type?.view).toEqual({
      type: 'tree',
      parent: 'parent_id',
      position: 'position',
      group: 'menu_location_id',
    });
    expect(type?.fields.find((f) => f.name === 'link')?.kinds.map((k) => k.kind)).toEqual([
      'url',
      'product',
      'taxon',
      'page',
    ]);
    expect(mapGemResource({ ...menuItems, view: undefined })?.view).toBeNull();
  });

  it('gets one group’s tree, nested', async () => {
    const { transport, calls } = fakeTransport(() => tree);
    const res = await companionResources(transport).tree('menu_items', '1');
    expect(calls[0]?.url).toBe('/api/admin_native/v1/resources/menu_items/tree?group=1');
    expect(res.group).toEqual({ id: '1', title: 'Header' });
    expect(res.nodes.map((n) => [n.id, n.title, n.children.map((c) => c.id)])).toEqual([
      ['1', 'Shop', ['2', '3']],
      ['4', 'About', []],
    ]);
    expect(res.nodes[0]?.children[0]).toMatchObject({ values: { name: 'Bags' }, children: [] });
  });

  it('gets the whole table without a group', async () => {
    const { transport, calls } = fakeTransport(() => ({ data: [node(1, 'Shop')], meta: { group: null } }));
    expect((await companionResources(transport).tree('menu_items', null)).group).toBeNull();
    expect(calls[0]?.url).toBe('/api/admin_native/v1/resources/menu_items/tree');
  });

  it('moves nodes in one PATCH and returns the new tree', async () => {
    const { transport, calls } = fakeTransport(() => tree);
    const res = await companionResources(transport).moveTree('menu_items', '1', [
      { id: '3', parentId: null, position: 0 },
      { id: '1', parentId: null, position: 1 },
    ]);
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      url: '/api/admin_native/v1/resources/menu_items/tree',
      body: {
        group: '1',
        nodes: [
          { id: '3', parent_id: null, position: 0 },
          { id: '1', parent_id: null, position: 1 },
        ],
      },
    });
    expect(res.nodes).toHaveLength(2);
  });

  it('refuses without the gem', async () => {
    await expect(unsupportedResources.tree('menu_items', null)).rejects.toMatchObject({ kind: 'capability' });
    await expect(unsupportedResources.moveTree('menu_items', null, [])).rejects.toMatchObject({
      kind: 'capability',
    });
  });
});

describe('summary additions', () => {
  it('reads visitors online and active carts when the gem sends them', async () => {
    const body = {
      currency: 'USD',
      time_zone: null,
      today: { orders: 1, sales: '10.00' },
      orders_to_fulfill: 0,
      payments_due: 0,
      low_stock_variants: 0,
      generated_at: '2026-11-28T10:00:00Z',
    };
    const old = fakeTransport(() => body);
    expect(await companion(old.transport).summary()).toMatchObject({
      visitorsOnline: null,
      activeCarts: null,
    });
    const now = fakeTransport(() => ({ ...body, visitors_online: 4, active_carts: 2 }));
    expect(await companion(now.transport).summary()).toMatchObject({ visitorsOnline: 4, activeCarts: 2 });
  });
});
