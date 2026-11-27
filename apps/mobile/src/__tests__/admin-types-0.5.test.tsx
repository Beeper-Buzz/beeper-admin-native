import type { Session } from '@instincts/spree-api';
import type { AdminRecord, AdminResource } from '@instincts/spree-domain';
import {
  type GemAdminRecord,
  type GemAdminResource,
  mapGemRecord,
  mapGemResource,
  SpreeError,
  unsupportedCustomers,
  unsupportedProducts,
} from '@instincts/spree-sdk';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Alert, type AlertButton, Linking } from 'react-native';
import { filterValues, rangeErrors } from '@/admin-types/filters';
import { resolvePick } from '@/admin-types/picker';
import { groupTypes } from '@/admin-types/use-admin-types';
import {
  createValues,
  defaultDrafts,
  displayValue,
  draftsFor,
  payload,
  singularLabel,
} from '@/admin-types/values';
import RecordScreen from '@/app/(tabs)/more/admin/[key]/[id]';
import ListScreen from '@/app/(tabs)/more/admin/[key]/index';
import NewScreen from '@/app/(tabs)/more/admin/[key]/new';
import ActionSheet from '@/app/(tabs)/more/admin/action';
import PickSheet from '@/app/(tabs)/more/admin/pick';
import MoreScreen from '@/app/(tabs)/more/index';
import { pickPhoto } from '@/media/pick';
import { AppThemeProvider } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';
import fixtures from '../../../../packages/spree-sdk/test/fixtures/admin-types-0.5.json';

/**
 * The app against gem 0.5 payloads (packages/spree-sdk/test/fixtures/admin-types-0.5.json, as the
 * spec describes them), mapped by the SDK as a real store's would be.
 */
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockTitles: string[] = [];
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    back: () => mockBack(),
    push: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
    dismissTo: (...a: unknown[]) => mockDismissTo(...a),
  },
  Stack: {
    Screen: ({ options }: { options?: { title?: string } }) => {
      if (options?.title) mockTitles.push(options.title);
      return null;
    },
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/session/session', () => ({
  useCan: () => () => true,
  useSession: () => ({ state: { store: null }, signOut: jest.fn() }),
}));
jest.mock('@/media/pick', () => ({ pickPhoto: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const GEM = '0.5.0';
const gemTypes = fixtures.manifest.data as unknown as GemAdminResource[];
/** A host type with a file field and a reference to a built-in lookup. */
const documents: GemAdminResource = {
  key: 'documents',
  label: 'Documents',
  group: 'Content',
  title_field: 'title',
  fields: [
    { name: 'title', type: 'string', label: 'Title', required: true },
    { name: 'document', type: 'file', label: 'Document' },
    { name: 'product_id', type: 'reference', label: 'Product', resource: 'spree_products' },
  ],
  create: true,
  update: true,
  destroy: true,
};
const types = [...gemTypes, documents]
  .map((t) => mapGemResource(t, GEM))
  .filter((t): t is AdminResource => t !== null);
const type = (key: string) => types.find((t) => t.key === key) as AdminResource;
const rec = (r: unknown): AdminRecord => mapGemRecord(r as GemAdminRecord);

const reason = rec({
  ...fixtures.renamed.data,
  title: 'Damaged',
  values: { ...fixtures.renamed.data.values, name: 'Damaged' },
});
const zone = rec(fixtures.zoneWithMembers.data);
const image = rec(fixtures.productImage.data);
const doc = rec({ ...fixtures.fileRecord.data, can: { update: true, destroy: true } });
const products = [
  rec({ id: '2', title: 'Ruby Tote', subtitle: 'ruby-tote', values: {}, actions: [] }),
  rec({ id: '3', title: 'Denim Shirt', subtitle: 'denim-shirt', values: {}, actions: [] }),
];

function setup(overrides: Record<string, jest.Mock> = {}) {
  const records: Record<string, AdminRecord> = {
    refund_reasons: reason,
    zones: zone,
    product_images: image,
    documents: doc,
  };
  const resources = {
    manifest: jest.fn(async () => ({ types, meta: { gemVersion: GEM } })),
    list: jest.fn(async (key: string) => ({
      items:
        key === 'spree_products'
          ? products
          : key === 'countries'
            ? [rec({ id: '38', title: 'Canada', values: {}, actions: [] })]
            : [records[key] ?? reason],
      nextCursor: null,
      totalCount: key === 'spree_products' ? 2 : 1,
    })),
    get: jest.fn(async (key: string) => records[key] ?? reason),
    create: jest.fn(async (key: string) => records[key] ?? reason),
    update: jest.fn(async (key: string, _id: string, values: Record<string, unknown>) => {
      const r = records[key] ?? reason;
      return { ...r, values: { ...r.values, ...values } };
    }),
    remove: jest.fn(async () => undefined),
    perform: jest.fn(async () => ({
      record: rec(fixtures.renamed.data),
      message: 'Renamed.',
      removed: false,
    })),
    upload: jest.fn(async () => ({
      signedId: fixtures.upload.data.signed_id,
      filename: 'back.png',
      contentType: 'image/png',
      byteSize: 1234,
      url: fixtures.upload.data.url,
    })),
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
  return { resources, ui };
}

/** Alert.alert presses the button named `choose`. */
function answerAlerts(choose: string) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons?: AlertButton[]) => {
    buttons?.find((b) => b.text === choose)?.onPress?.();
  });
}

beforeEach(() => {
  for (const m of [mockBack, mockPush, mockReplace, mockDismissTo]) m.mockClear();
  mockTitles.length = 0;
  jest.restoreAllMocks();
  (pickPhoto as jest.Mock).mockReset();
  (DocumentPicker.getDocumentAsync as jest.Mock).mockReset();
});

describe('0.5 values and filters', () => {
  it('uses singular labels, hides hidden types from More and prefills defaults', () => {
    expect(singularLabel(type('refund_reasons'))).toBe('Refund reason');
    expect(singularLabel({ label: 'Refund reasons', singular: null })).toBe('Refund reason');
    expect(groupTypes(types).flatMap((g) => g.types.map((t) => t.key))).not.toContain('spree_products');
    const zones = type('zones');
    expect(defaultDrafts(zones.fields)).toMatchObject({ kind: 'state', default_tax: false, name: '' });
    expect(
      createValues(
        zones.fields.filter((f) => !f.readonly),
        defaultDrafts(zones.fields),
      ),
    ).toEqual({
      kind: 'state',
      default_tax: false,
    });
  });

  it('turns attachments into signed ids, null or nothing', () => {
    const file = type('documents').fields.find((f) => f.name === 'document');
    if (!file) throw new Error('no file field');
    const before = draftsFor([file], doc.values);
    expect(before.document).toMatchObject({ filename: 'terms.pdf', byteSize: 48213, signedId: null });
    expect(displayValue(file, doc.values.document)).toBe('terms.pdf');
    const replaced = { ...(before.document as object), signedId: 'abc' } as never;
    expect(payload(file, replaced)).toBe('abc');
    expect(payload(file, null)).toBeNull();
    expect(createValues([file], { document: before.document ?? null })).toEqual({});
    expect(createValues([file], { document: replaced })).toEqual({ document: 'abc' });
  });

  it('sends presence, reference and finished date ranges', () => {
    const zones = type('zones');
    expect(
      filterValues(
        zones.filters,
        { kind: '*', description: 'set', created_at: { from: '2026-11-01', to: '' } },
        types,
      ),
    ).toEqual({ description: 'set', created_at: { from: '2026-11-01' } });
    expect(filterValues(zones.filters, { created_at: { from: '2026-11', to: '' } }, types)).toEqual({});
    expect(rangeErrors({ from: '2026-11-30', to: '2026-11-01' })).toEqual({
      from: null,
      to: 'To is before From.',
    });
    expect(
      filterValues(type('states').filters, { country_id: { id: '38', title: 'Canada' } }, types),
    ).toEqual({ country_id: '38' });
    // A reference filter to a type the manifest doesn't have can't be offered.
    expect(filterValues(type('states').filters, { country_id: { id: '38', title: 'Canada' } }, [])).toEqual(
      {},
    );
  });
});

describe('More and New', () => {
  it('leaves hidden types off More', async () => {
    const { ui } = setup();
    await ui(<MoreScreen />);
    expect(await screen.findByText('Catalog')).toBeTruthy();
    expect(screen.getByText('Product images')).toBeTruthy();
    expect(screen.queryByText('Products')).toBeNull();
  });

  it('titles a new record with the singular and prefills defaults', async () => {
    mockParams = { key: 'refund_reasons' };
    const { ui, resources } = setup();
    await ui(<NewScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Name, required'), 'Lost');
    expect(mockTitles).toContain('New refund reason');
    expect(screen.getByLabelText('Active').props.value).toBe(true);
    await fireEvent.press(screen.getByText('Create'));
    await waitFor(() =>
      expect(resources.create).toHaveBeenCalledWith('refund_reasons', { name: 'Lost', active: true }),
    );
  });
});

describe('record rules and versions', () => {
  it('has no Delete when the record can’t be deleted', async () => {
    mockParams = { key: 'zones', id: '1' };
    const { ui } = setup();
    await ui(<RecordScreen />);
    expect(await screen.findByLabelText('Name, required')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('is read-only when the record can’t be edited', async () => {
    mockParams = { key: 'documents', id: '7' };
    const { ui } = setup({ get: jest.fn(async () => rec(fixtures.fileRecord.data)) });
    await ui(<RecordScreen />);
    expect(await screen.findByText(/doesn't allow editing this one/)).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
    expect(screen.queryByLabelText('Title, required')).toBeNull();
    expect(screen.getByLabelText('Document: terms.pdf · 47 KB')).toBeTruthy();
    expect(screen.queryByText('Replace')).toBeNull();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await fireEvent.press(screen.getByLabelText('Open terms.pdf'));
    expect(open).toHaveBeenCalledWith(fixtures.fileRecord.data.values.document.url);
  });

  it('sends the version and offers Reload on a conflict', async () => {
    mockParams = { key: 'zones', id: '1' };
    const theirs = rec({
      ...fixtures.zoneWithMembers.data,
      title: 'EU (theirs)',
      values: { ...fixtures.zoneWithMembers.data.values, name: 'EU (theirs)' },
      version: '2026-11-27T11:00:00.000000Z',
    });
    const get = jest.fn(async () => zone);
    const update = jest.fn(async () => {
      throw new SpreeError({ kind: 'conflict', status: 409, message: fixtures.conflict.error.message });
    });
    const { ui } = setup({ get, update });
    const alert = answerAlerts('Reload');
    await ui(<RecordScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Name, required'), 'EU mine');
    get.mockResolvedValue(theirs);
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('zones', '1', { name: 'EU mine' }, '2026-11-27T10:00:00.123456Z'),
    );
    expect(alert).toHaveBeenCalledWith(
      'Someone else changed this',
      fixtures.conflict.error.message,
      expect.any(Array),
    );
    await waitFor(() => expect(screen.getByLabelText('Name, required').props.value).toBe('EU (theirs)'));
    expect(screen.getByText('Reloaded with their changes.')).toBeTruthy();
  });

  it('shows base errors above the form', async () => {
    mockParams = { key: 'zones', id: '1' };
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { ui } = setup({
      update: jest.fn(async () => {
        throw new SpreeError({
          kind: 'invalid',
          status: 422,
          message: 'Zone is locked',
          fieldErrors: { base: ['Zone is locked'] },
        });
      }),
    });
    await ui(<RecordScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Name, required'), 'EU');
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText('Zone is locked')).toBeTruthy();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('Zone is locked')).toBeLessThan(tree.indexOf('Name *'));
  });
});

describe('actions', () => {
  it('asks for inputs in a sheet, validates, shows 422 errors there and sends input', async () => {
    mockParams = { key: 'refund_reasons', id: '4' };
    const perform = jest
      .fn()
      .mockRejectedValueOnce(
        new SpreeError({
          kind: 'invalid',
          status: 422,
          message: fixtures.missingInput.error.message,
          fieldErrors: fixtures.missingInput.error.fields,
        }),
      )
      .mockResolvedValue({ record: rec(fixtures.renamed.data), message: 'Renamed.', removed: false });
    const { ui, resources } = setup({ perform });
    const form = await ui(<RecordScreen />);
    await fireEvent.press(await screen.findByText('Rename'));
    const [{ pathname, params }] = mockPush.mock.calls.at(-1) as [
      { pathname: string; params: Record<string, string> },
    ];
    expect(pathname).toBe('/more/admin/action');
    expect(params).toMatchObject({ key: 'refund_reasons', id: '4', action: 'rename' });
    expect(resources.perform).not.toHaveBeenCalled();

    mockParams = params;
    const sheet = await setup({ perform }).ui(<ActionSheet />);
    const submit = async () => fireEvent.press((await sheet.findAllByText('Rename')).at(-1) as never);
    // Inputs start from their defaults.
    expect((await sheet.findByLabelText('Tell the team')).props.value).toBe(true);
    await submit();
    expect(await sheet.findByText('Required.')).toBeTruthy();
    expect(perform).not.toHaveBeenCalled();
    await fireEvent.changeText(sheet.getByLabelText('New name, required'), ' ');
    await fireEvent.changeText(sheet.getByLabelText('New name, required'), 'Broken');
    await submit();
    expect(await sheet.findByText("Can't be blank")).toBeTruthy();
    expect(perform).toHaveBeenLastCalledWith('refund_reasons', '4', 'rename', {
      new_name: 'Broken',
      notify: true,
    });
    expect(mockBack).not.toHaveBeenCalled();
    await submit();
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(await form.findByText('Renamed.')).toBeTruthy();
  });

  it('goes back to the list when an action removes the record', async () => {
    mockParams = { key: 'zones', id: '1' };
    const alert = answerAlerts('Discard');
    const { ui, resources } = setup({
      perform: jest.fn(async () => ({ record: null, message: 'Discarded.', removed: true })),
    });
    await ui(<RecordScreen />);
    await fireEvent.press(await screen.findByText('Discard'));
    await waitFor(() => expect(resources.perform).toHaveBeenCalledWith('zones', '1', 'discard'));
    await waitFor(() =>
      expect(mockDismissTo).toHaveBeenCalledWith({ pathname: '/more/admin/[key]', params: { key: 'zones' } }),
    );
    expect(alert).toHaveBeenCalledWith('Discarded.');
  });
});

describe('attachments', () => {
  it('uploads a chosen photo, shows it and saves its signed id; Remove sends null', async () => {
    mockParams = { key: 'product_images', id: '31' };
    (pickPhoto as jest.Mock).mockResolvedValue({
      status: 'picked',
      photo: { uri: 'file:///tmp/photo-1.jpg', name: 'photo-1.jpg', type: 'image/jpeg' },
    });
    const { ui, resources } = setup();
    await ui(<RecordScreen />);
    await fireEvent.press(await screen.findByLabelText('Choose a photo for Attachment'));
    await waitFor(() =>
      expect(resources.upload).toHaveBeenCalledWith({
        uri: 'file:///tmp/photo-1.jpg',
        name: 'photo-1.jpg',
        type: 'image/jpeg',
      }),
    );
    await waitFor(() =>
      expect(JSON.stringify(screen.getByLabelText('Attachment').props.source)).toContain(
        'file:///tmp/photo-1.jpg',
      ),
    );
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() =>
      expect(resources.update).toHaveBeenCalledWith('product_images', '31', {
        attachment: fixtures.upload.data.signed_id,
      }),
    );
    await fireEvent.press(await screen.findByLabelText('Remove Attachment'));
    expect(await screen.findByText('No image')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() =>
      expect(resources.update).toHaveBeenLastCalledWith('product_images', '31', { attachment: null }),
    );
  });

  it('replaces a file through the document picker and opens it', async () => {
    mockParams = { key: 'documents', id: '7' };
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///tmp/terms-v2.pdf', name: 'terms-v2.pdf', mimeType: 'application/pdf', size: 2048 },
      ],
    });
    const { ui, resources } = setup({
      upload: jest.fn(async () => ({
        signedId: 'sid-2',
        filename: 'terms-v2.pdf',
        contentType: 'application/pdf',
        byteSize: 2048,
        url: 'https://shop.test/terms-v2.pdf',
      })),
    });
    await ui(<RecordScreen />);
    expect(await screen.findByLabelText('Document: terms.pdf · 47 KB')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Replace the file for Document'));
    await waitFor(() =>
      expect(resources.upload).toHaveBeenCalledWith({
        uri: 'file:///tmp/terms-v2.pdf',
        name: 'terms-v2.pdf',
        type: 'application/pdf',
      }),
    );
    expect(await screen.findByLabelText('Document: terms-v2.pdf · 2 KB')).toBeTruthy();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await fireEvent.press(screen.getByLabelText('Open terms-v2.pdf'));
    expect(open).toHaveBeenCalledWith('https://shop.test/terms-v2.pdf');
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() =>
      expect(resources.update).toHaveBeenCalledWith('documents', '7', { document: 'sid-2' }, 3),
    );
  });

  it('refuses a file over 25 MB before uploading', async () => {
    mockParams = { key: 'documents', id: '7' };
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///tmp/big.mov', name: 'big.mov', mimeType: 'video/quicktime', size: 30 * 1024 * 1024 },
      ],
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { ui, resources } = setup();
    await ui(<RecordScreen />);
    await fireEvent.press(await screen.findByLabelText('Replace the file for Document'));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith('This file is too big', expect.stringMatching(/25 MB/)),
    );
    expect(resources.upload).not.toHaveBeenCalled();
  });
});

describe('list filters', () => {
  it('filters by presence and a date range, with Clear', async () => {
    mockParams = { key: 'zones' };
    const { ui, resources } = setup();
    await ui(<ListScreen />);
    expect(await screen.findByText('EU_VAT')).toBeTruthy();
    await fireEvent.press(screen.getByText('Not set'));
    await waitFor(() =>
      expect(resources.list).toHaveBeenLastCalledWith('zones', {
        perPage: 25,
        cursor: null,
        filters: { description: 'unset' },
      }),
    );
    await fireEvent.changeText(screen.getByLabelText('Created at from'), '2026-11');
    expect(screen.getByText('Use YYYY-MM-DD.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Created at from'), '2026-11-01');
    await fireEvent.changeText(screen.getByLabelText('Created at to'), '2026-11-30');
    await waitFor(() =>
      expect(resources.list).toHaveBeenLastCalledWith('zones', {
        perPage: 25,
        cursor: null,
        filters: { description: 'unset', created_at: { from: '2026-11-01', to: '2026-11-30' } },
      }),
    );
    await fireEvent.press(screen.getByLabelText('Clear Created at'));
    expect(screen.getByLabelText('Created at from').props.value).toBe('');
    expect(screen.queryByLabelText('Clear Created at')).toBeNull();
    // Back to a list already fetched: shown from the cache, so no call is expected here.
    await fireEvent.press(screen.getByText('Any'));
    expect(screen.getByText('Any 1')).toBeTruthy();
  });

  it('filters by a reference chosen in the picker, shown as a removable chip', async () => {
    mockParams = { key: 'states' };
    const { ui, resources } = setup();
    await ui(<ListScreen />);
    await fireEvent.press(await screen.findByLabelText('Filter by Country'));
    const [{ params }] = mockPush.mock.calls.at(-1) as [{ params: Record<string, string> }];
    expect(params).toMatchObject({ resource: 'countries', label: 'Country', optional: '' });
    await act(async () => {
      resolvePick(params.request as string, { id: '38', title: 'Canada' });
    });
    await waitFor(() =>
      expect(resources.list).toHaveBeenLastCalledWith('states', {
        perPage: 25,
        cursor: null,
        filters: { country_id: '38' },
      }),
    );
    await fireEvent.press(screen.getByLabelText('Remove filter Country: Canada'));
    expect(await screen.findByLabelText('Filter by Country')).toBeTruthy();
    expect(screen.queryByLabelText('Remove filter Country: Canada')).toBeNull();
  });
});

describe('built-in lookups', () => {
  it('a reference to spree_products opens the picker over the hidden lookup, with search', async () => {
    mockParams = { key: 'documents', id: '7' };
    const { ui } = setup();
    await ui(<RecordScreen />);
    await fireEvent.press(await screen.findByLabelText('Product: none chosen'));
    const [{ params }] = mockPush.mock.calls.at(-1) as [{ params: Record<string, string> }];
    expect(params).toMatchObject({ resource: 'spree_products', label: 'Product', optional: '1' });

    mockParams = { ...params, request: 'r9' };
    const picker = setup();
    const picked = jest.spyOn(require('@/admin-types/picker'), 'resolvePick').mockImplementation(() => true);
    await picker.ui(<PickSheet />);
    expect(await screen.findByText('Denim Shirt')).toBeTruthy();
    expect(screen.getByText('denim-shirt')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search products'), 'denim');
    await waitFor(() =>
      expect(picker.resources.list).toHaveBeenLastCalledWith('spree_products', {
        perPage: 25,
        cursor: null,
        query: 'denim',
      }),
    );
    await fireEvent.press(screen.getByText('Denim Shirt'));
    expect(picked).toHaveBeenCalledWith('r9', { id: '3', title: 'Denim Shirt' });
  });
});
