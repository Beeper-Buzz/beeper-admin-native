import type { Session } from '@instincts/spree-api';
import type { AdminRecord, AdminResource, AdminTree, AdminTreeNode } from '@instincts/spree-domain';
import {
  type GemAdminResource,
  mapGemResource,
  SpreeError,
  unsupportedCustomers,
  unsupportedProducts,
} from '@instincts/spree-sdk';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { resolvePick } from '@/admin-types/picker';
import { groupTypes } from '@/admin-types/use-admin-types';
import { draftsFor, payload, validateDraft } from '@/admin-types/values';
import RecordScreen from '@/app/(tabs)/more/admin/[key]/[id]';
import ListScreen from '@/app/(tabs)/more/admin/[key]/index';
import GroupsSheet from '@/app/(tabs)/more/admin/groups';
import MoveSheet from '@/app/(tabs)/more/admin/move';
import { AppThemeProvider } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';

/** The menu builder (spec §6.1) against gem 0.7 manifests and trees, mapped by the SDK. */
const mockBack = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    back: () => mockBack(),
    push: (...a: unknown[]) => mockPush(...a),
    replace: jest.fn(),
    dismissTo: jest.fn(),
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
  useIsFocused: () => true,
}));
jest.mock('@/session/session', () => ({
  useCan: () => () => true,
  useSession: () => ({ state: { store: null }, signOut: jest.fn() }),
}));

const GEM = '0.7.0';
const menuItems: GemAdminResource = {
  key: 'menu_items',
  label: 'Menu items',
  singular: 'Menu item',
  group: 'Content',
  title_field: 'name',
  fields: [
    { name: 'name', type: 'string', label: 'Name', required: true },
    {
      name: 'menu_location_id',
      type: 'reference',
      label: 'Menu',
      resource: 'menu_locations',
      required: true,
    },
    {
      name: 'link',
      type: 'link',
      label: 'Links to',
      kinds: [{ kind: 'url' }, { kind: 'product', resource: 'spree_products' }],
    },
    { name: 'is_visible', type: 'boolean', label: 'Visible' },
  ],
  create: true,
  update: true,
  destroy: true,
  view: { type: 'tree', parent: 'parent_id', position: 'position', group: 'menu_location_id' },
};
const locations: GemAdminResource = {
  key: 'menu_locations',
  label: 'Menu locations',
  singular: 'Menu location',
  hidden: true,
  title_field: 'title',
  fields: [{ name: 'title', type: 'string', required: true }],
  create: true,
  update: true,
  destroy: true,
};
const products: GemAdminResource = {
  key: 'spree_products',
  label: 'Products',
  singular: 'Product',
  hidden: true,
  title_field: 'name',
  fields: [],
};
const types = [menuItems, locations, products]
  .map((t) => mapGemResource(t, GEM))
  .filter((t): t is AdminResource => t !== null);

const rec = (id: string, title: string, values: Record<string, unknown> = {}): AdminRecord => ({
  id,
  title,
  subtitle: null,
  values,
  actions: [],
  can: { update: true, destroy: true },
  version: null,
});
const node = (id: string, title: string, children: AdminTreeNode[] = [], visible = true): AdminTreeNode => ({
  ...rec(id, title, { name: title, is_visible: visible }),
  children,
});
const header = (): AdminTree => ({
  nodes: [node('1', 'Shop', [node('2', 'Bags'), node('3', 'Shoes')]), node('4', 'About', [], false)],
  group: { id: '10', title: 'Header' },
});

function setup(overrides: Record<string, jest.Mock> = {}) {
  let current = header();
  const resources = {
    manifest: jest.fn(async () => ({ types, meta: { gemVersion: GEM } })),
    list: jest.fn(async (key: string) => ({
      items:
        key === 'menu_locations'
          ? [rec('10', 'Header'), rec('11', 'Footer')]
          : [rec('7', 'Ruby Tote'), rec('8', 'Denim Shirt')],
      nextCursor: null,
      totalCount: 2,
    })),
    get: jest.fn(async () =>
      rec('2', 'Bags', {
        name: 'Bags',
        menu_location_id: { id: '10', title: 'Header' },
        link: { kind: 'url', url: '/bags' },
      }),
    ),
    create: jest.fn(async (_key: string, values: Record<string, unknown>) => rec('9', String(values.name))),
    update: jest.fn(async (_key: string, id: string, values: Record<string, unknown>) =>
      rec(
        id,
        ({ '4': 'About', '2': 'Bags', '11': 'Footer links' } as Record<string, string>)[id] ?? 'Updated',
        values,
      ),
    ),
    remove: jest.fn(async () => undefined),
    perform: jest.fn(),
    upload: jest.fn(),
    tree: jest.fn(async () => current),
    moveTree: jest.fn(async () => current),
    ...overrides,
  };
  const session = {
    probe: { baseUrl: 'https://shop.test', currency: 'USD', capabilities: ['admin.resources'] },
    adapter: {
      family: 'api-v1',
      orders: {},
      products: unsupportedProducts,
      customers: unsupportedCustomers,
      resources,
    },
  } as unknown as Session;
  const ui = (el: React.ReactElement) =>
    render(
      <AppThemeProvider>
        <ApiProvider session={session}>{el}</ApiProvider>
      </AppThemeProvider>,
    );
  return { resources, ui, setTree: (t: AdminTree) => (current = t) };
}

/** Titles of the rows, top to bottom, with their nesting as "level N" from the hint. */
const rows = () =>
  screen
    .getAllByRole('button')
    .filter((b) => /level \d/.test(String(b.props.accessibilityHint)))
    .map((b) => `${b.props.accessibilityLabel}@${/level (\d)/.exec(String(b.props.accessibilityHint))?.[1]}`);

const row = (title: string) =>
  screen
    .getAllByRole('button')
    .find(
      (b) => b.props.accessibilityLabel === title && /level/.test(String(b.props.accessibilityHint)),
    ) as ReturnType<typeof screen.getByRole>;

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
  mockParams = {};
  jest.restoreAllMocks();
});

describe('More screen', () => {
  it('lists the tree type once, hidden group type or not', () => {
    const keys = (list: AdminResource[]) => groupTypes(list).flatMap((g) => g.types.map((t) => t.key));
    expect(keys(types)).toEqual(['menu_items']);
    const shown = types.map((t) => (t.key === 'menu_locations' ? { ...t, hidden: false } : t));
    expect(keys(shown)).toEqual(['menu_items']);
  });
});

describe('tree screen', () => {
  it('shows the groups as tabs and the nested tree of the first one', async () => {
    mockParams = { key: 'menu_items' };
    const { resources, ui } = setup();
    await ui(<ListScreen />);
    await waitFor(() => expect(rows()).toEqual(['Shop@1', 'Bags@2', 'Shoes@2', 'About@1']));
    expect(resources.tree).toHaveBeenCalledWith('menu_items', '10');
    expect(screen.getByRole('tab', { name: 'Header' }).props.accessibilityState.selected).toBe(true);
    // The flat list never loads for a tree type.
    expect(resources.list).not.toHaveBeenCalledWith('menu_items', expect.anything());
    // The visibility switch reads is_visible.
    expect(screen.getByLabelText('Show About').props.value).toBe(false);

    await fireEvent.press(screen.getByRole('tab', { name: 'Footer' }));
    await waitFor(() => expect(resources.tree).toHaveBeenCalledWith('menu_items', '11'));
  });

  it('moves optimistically and saves the affected siblings in one PATCH', async () => {
    mockParams = { key: 'menu_items' };
    let finish: (t: AdminTree) => void = () => {};
    const { resources, ui } = setup({
      moveTree: jest.fn(() => new Promise<AdminTree>((r) => (finish = r))),
    });
    await ui(<ListScreen />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    await fireEvent(row('Shoes'), 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
    // Shown at once, before the store answers.
    await waitFor(() => expect(rows()).toEqual(['Shop@1', 'Shoes@2', 'Bags@2', 'About@1']));
    expect(resources.moveTree).toHaveBeenCalledWith('menu_items', '10', [
      { id: '3', parentId: '1', position: 0 },
      { id: '2', parentId: '1', position: 1 },
    ]);
    // The store's tree replaces the local one.
    await act(async () =>
      finish({
        nodes: [node('1', 'Shop', [node('3', 'Shoes'), node('2', 'Bags')]), node('4', 'About')],
        group: { id: '10', title: 'Header' },
      }),
    );
    expect(rows()).toEqual(['Shop@1', 'Shoes@2', 'Bags@2', 'About@1']);
  });

  it('undoes a move the store refuses and says so', async () => {
    mockParams = { key: 'menu_items' };
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { ui } = setup({
      moveTree: jest.fn(async () => {
        throw new SpreeError({ kind: 'invalid', status: 422, message: 'That would put it inside itself.' });
      }),
    });
    await ui(<ListScreen />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    await fireEvent(row('About'), 'accessibilityAction', { nativeEvent: { actionName: 'indent' } });
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0]?.[0]).toBe("Couldn't move “About”");
    expect(alert.mock.calls[0]?.[1]).toMatch(/inside itself\. The move was undone\./);
    expect(rows()).toEqual(['Shop@1', 'Bags@2', 'Shoes@2', 'About@1']);
  });

  it('indents and outdents from the row menu', async () => {
    mockParams = { key: 'menu_items' };
    const { resources, ui, setTree } = setup();
    await ui(<ListScreen />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    // What the store answers with after the move.
    setTree({
      nodes: [node('1', 'Shop', [node('2', 'Bags')]), node('3', 'Shoes'), node('4', 'About', [], false)],
      group: { id: '10', title: 'Header' },
    });
    await fireEvent.press(screen.getByLabelText('Actions for Shoes'));
    expect(screen.queryByRole('button', { name: 'Move up' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Outdent' }));
    await waitFor(() => expect(rows()).toEqual(['Shop@1', 'Bags@2', 'Shoes@1', 'About@1']));
    expect(resources.moveTree).toHaveBeenCalledWith('menu_items', '10', [
      { id: '1', parentId: null, position: 0 },
      { id: '3', parentId: null, position: 1 },
      { id: '4', parentId: null, position: 2 },
      { id: '2', parentId: '1', position: 0 },
    ]);
  });

  it('toggles visibility, showing it at once', async () => {
    mockParams = { key: 'menu_items' };
    const { resources, ui } = setup();
    await ui(<ListScreen />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    await fireEvent(screen.getByLabelText('Show About'), 'valueChange', true);
    expect(screen.getByLabelText('Show About').props.value).toBe(true);
    await waitFor(() =>
      expect(resources.update).toHaveBeenCalledWith('menu_items', '4', { is_visible: true }),
    );
  });

  it('adds a child inline, then moves it into place', async () => {
    mockParams = { key: 'menu_items' };
    const { resources, ui, setTree } = setup();
    await ui(<ListScreen />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    await fireEvent.press(screen.getByLabelText('Actions for Shop'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add menu item inside' }));
    // The store puts the new record at the top level; the app moves it under Shop.
    setTree({ ...header(), nodes: [...header().nodes, node('9', 'Sale')] });
    await fireEvent.changeText(screen.getByLabelText('New menu item'), 'Sale');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(resources.create).toHaveBeenCalledWith('menu_items', { name: 'Sale', menu_location_id: '10' }),
    );
    await waitFor(() =>
      expect(resources.moveTree).toHaveBeenCalledWith(
        'menu_items',
        '10',
        expect.arrayContaining([{ id: '9', parentId: '1', position: 2 }]),
      ),
    );
  });

  it('opens the full form when the store needs more than a title', async () => {
    mockParams = { key: 'menu_items' };
    const { ui } = setup({
      create: jest.fn(async () => {
        throw new SpreeError({ kind: 'invalid', status: 422, fieldErrors: { link: ["can't be blank"] } });
      }),
    });
    await ui(<ListScreen />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    await fireEvent.press(screen.getByRole('button', { name: 'Add menu item' }));
    await fireEvent.changeText(screen.getByLabelText('New menu item'), 'Gift cards');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const [{ pathname, params }] = mockPush.mock.calls[0] as [
      { pathname: string; params: { prefill: string } },
    ];
    expect(pathname).toBe('/more/admin/[key]/new');
    expect(JSON.parse(params.prefill)).toEqual({
      name: 'Gift cards',
      menu_location_id: { id: '10', title: 'Header' },
    });
  });

  it('taps through to the record form', async () => {
    mockParams = { key: 'menu_items' };
    const { ui } = setup();
    await ui(<ListScreen />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    await fireEvent.press(row('Bags'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/more/admin/[key]/[id]',
      params: { key: 'menu_items', id: '2' },
    });
  });
});

describe('Move sheet', () => {
  it('moves under a chosen parent at a chosen position', async () => {
    mockParams = { key: 'menu_items', id: '4', group: '10' };
    const { resources, ui } = setup();
    await ui(<MoveSheet />);
    await screen.findByText('Move “About”');
    await fireEvent.press(screen.getByRole('radio', { name: 'Shop' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'After “Bags”' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(resources.moveTree).toHaveBeenCalledWith('menu_items', '10', [
        { id: '1', parentId: null, position: 0 },
        { id: '2', parentId: '1', position: 0 },
        { id: '4', parentId: '1', position: 1 },
        { id: '3', parentId: '1', position: 2 },
      ]),
    );
    expect(mockBack).toHaveBeenCalled();
  });

  it('offers only places outside the node’s own subtree', async () => {
    mockParams = { key: 'menu_items', id: '1', group: '10' };
    const { ui } = setup();
    await ui(<MoveSheet />);
    await screen.findByText('Move “Shop”');
    const under = within(screen.getByLabelText('Put it under'));
    expect(under.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual([
      'Top level',
      'About',
    ]);
  });
});

describe('groups sheet', () => {
  it('adds, renames and deletes locations', async () => {
    mockParams = { key: 'menu_items' };
    const { resources, ui } = setup();
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons?: AlertButton[]) => {
      buttons?.find((b) => b.text === 'Delete')?.onPress?.();
    });
    await ui(<GroupsSheet />);
    const name = await screen.findAllByLabelText('Menu location name');
    await fireEvent.changeText(name[1] as never, 'Footer links');
    await fireEvent.press(screen.getByRole('button', { name: 'Rename Footer' }));
    await waitFor(() =>
      expect(resources.update).toHaveBeenCalledWith('menu_locations', '11', { title: 'Footer links' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Delete Header' }));
    await waitFor(() => expect(resources.remove).toHaveBeenCalledWith('menu_locations', '10'));
    await fireEvent.changeText(screen.getByLabelText('New menu location'), 'Sidebar');
    await fireEvent.press(screen.getByRole('button', { name: 'Add menu location' }));
    await waitFor(() =>
      expect(resources.create).toHaveBeenCalledWith('menu_locations', { title: 'Sidebar' }),
    );
  });
});

describe('link field', () => {
  const link = types[0]?.fields.find((f) => f.name === 'link');
  if (!link) throw new Error('no link field');

  it('turns drafts into the store’s link values and checks them', () => {
    expect(draftsFor([link], { link: { kind: 'product', id: '7', title: 'Ruby Tote' } })).toEqual({
      link: { kind: 'product', url: null, id: '7', title: 'Ruby Tote' },
    });
    expect(payload(link, { kind: 'url', url: ' /sale ', id: null, title: null })).toEqual({
      kind: 'url',
      url: '/sale',
    });
    expect(payload(link, { kind: 'product', url: null, id: '7', title: 'x' })).toEqual({
      kind: 'product',
      id: '7',
    });
    expect(payload(link, { kind: 'url', url: '', id: null, title: null })).toBeNull();
    expect(validateDraft(link, { kind: 'url', url: 'not a link', id: null, title: null })).toMatch(
      /Enter a link/,
    );
    expect(
      validateDraft(link, { kind: 'url', url: 'https://example.com/a', id: null, title: null }),
    ).toBeNull();
    expect(validateDraft({ ...link, required: true }, null)).toBe('Required.');
  });

  it('edits a URL link and switches to a product from the picker', async () => {
    mockParams = { key: 'menu_items', id: '2' };
    const { resources, ui } = setup();
    await ui(<RecordScreen />);
    const url = await screen.findByDisplayValue('/bags');
    expect(url.props.value).toBe('/bags');
    await fireEvent.press(screen.getByRole('radio', { name: 'Product' }));
    await fireEvent.press(screen.getByRole('button', { name: /Product: none chosen/ }));
    const [[{ params: request }]] = mockPush.mock.calls.slice(-1) as [
      [{ params: { request: string; resource: string } }],
    ];
    expect(request.resource).toBe('spree_products');
    await act(async () => {
      resolvePick(request.request, { id: '7', title: 'Ruby Tote' });
    });
    await screen.findByText('Ruby Tote');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(resources.update).toHaveBeenCalledWith('menu_items', '2', {
        link: { kind: 'product', id: '7' },
      }),
    );
  });
});
