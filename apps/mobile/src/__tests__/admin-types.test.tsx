import type { Session } from '@instincts/spree-api';
import { AdminField, type AdminRecord, AdminResource } from '@instincts/spree-domain';
import { SpreeError, unsupportedCustomers, unsupportedProducts } from '@instincts/spree-sdk';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { knownIcon } from '@/admin-types/icons';
import { resolvePick } from '@/admin-types/picker';
import { groupTypes } from '@/admin-types/use-admin-types';
import {
  changedValues,
  createValues,
  displayValue,
  draftsFor,
  isoFromLocal,
  listDetail,
  localDateTime,
  payload,
  serverFieldErrors,
  singular,
  validateDraft,
} from '@/admin-types/values';
import RecordScreen from '@/app/(tabs)/more/admin/[key]/[id]';
import ListScreen from '@/app/(tabs)/more/admin/[key]/index';
import NewScreen from '@/app/(tabs)/more/admin/[key]/new';
import PickSheet from '@/app/(tabs)/more/admin/pick';
import MoreScreen from '@/app/(tabs)/more/index';
import { AppThemeProvider } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    back: () => mockBack(),
    push: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
let mockCaps = ['admin.resources', 'promotions.read'];
jest.mock('@/session/session', () => ({
  useCan: () => (c: string) => mockCaps.includes(c),
  useSession: () => ({ state: { store: null }, signOut: jest.fn() }),
}));

const field = (f: Record<string, unknown>) => AdminField.parse({ rawType: f.type, label: f.name, ...f });

/** Like the demo initializer's types on the Spree 4.2 test store. */
const reasons = AdminResource.parse({
  key: 'refund_reasons',
  label: 'Refund reasons',
  group: 'Payments',
  icon: 'arrow.uturn.backward',
  titleField: 'name',
  listFields: ['name', 'active', 'position'],
  searchable: true,
  filters: [{ name: 'active', label: 'Active', options: [true, false] }],
  fields: [
    field({ name: 'id', type: 'readonly', label: 'Id', readonly: true }),
    field({ name: 'name', type: 'string', label: 'Name', required: true }),
    field({ name: 'active', type: 'boolean', label: 'Active' }),
    field({ name: 'position', type: 'integer', label: 'Position' }),
    field({ name: 'kind', type: 'enum', label: 'Kind', options: ['damaged', 'lost'] }),
    field({ name: 'notes', type: 'text', label: 'Notes' }),
    field({ name: 'meta', type: 'json', label: 'Meta' }),
    field({ name: 'geo', type: 'unknown', rawType: 'geo_point', label: 'Geo' }),
    field({ name: 'created_at', type: 'datetime', label: 'Created at', readonly: true }),
  ],
  create: true,
  update: true,
  destroy: true,
  actions: [{ name: 'retire', label: 'Retire', confirm: 'Stop offering this reason?', destructive: true }],
});
const countries = AdminResource.parse({
  key: 'countries',
  label: 'Countries',
  group: 'Shipping',
  titleField: 'name',
  searchable: true,
  fields: [field({ name: 'name', type: 'string', label: 'Name' })],
});
const states = AdminResource.parse({
  key: 'states',
  label: 'States',
  group: 'Shipping',
  icon: 'not.a.symbol',
  titleField: 'name',
  fields: [
    field({ name: 'name', type: 'string', label: 'Name', required: true }),
    field({ name: 'country_id', type: 'reference', label: 'Country', resource: 'countries', required: true }),
  ],
  create: true,
  update: true,
});

const damaged: AdminRecord = {
  id: '4',
  title: 'Damaged',
  subtitle: null,
  values: {
    id: 4,
    name: 'Damaged',
    active: true,
    position: 2,
    kind: 'damaged',
    notes: '',
    meta: { a: 1 },
    geo: { lat: 1 },
    created_at: '2026-11-01T10:00:00Z',
  },
  actions: ['retire'],
  // What the SDK fills in for a 0.4 record.
  can: { update: true, destroy: true },
  version: null,
};

function setup(overrides: Record<string, jest.Mock> = {}) {
  const resources = {
    manifest: jest.fn(async () => ({ types: [reasons, countries, states], meta: { gemVersion: null } })),
    list: jest.fn(async (key: string) => ({
      items:
        key === 'countries'
          ? [
              { id: '38', title: 'Canada', subtitle: null, values: {}, actions: [] },
              { id: '233', title: 'United States', subtitle: null, values: {}, actions: [] },
            ]
          : [damaged],
      nextCursor: null,
      totalCount: key === 'countries' ? 2 : 1,
    })),
    get: jest.fn(async () => damaged),
    create: jest.fn(async () => ({ ...damaged, id: '9' })),
    update: jest.fn(async (_k: string, _id: string, values: Record<string, unknown>) => ({
      ...damaged,
      values: { ...damaged.values, ...values },
    })),
    remove: jest.fn(async () => undefined),
    perform: jest.fn(async () => ({ record: { ...damaged, actions: [] }, message: 'Retired.' })),
    ...overrides,
  };
  const session = {
    probe: { baseUrl: 'https://shop.test', currency: 'USD', capabilities: mockCaps },
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
  mockBack.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockCaps = ['admin.resources', 'promotions.read'];
  jest.restoreAllMocks();
});

describe('admin type values', () => {
  const f = (name: string) => reasons.fields.find((x) => x.name === name) as AdminField;

  it('turns drafts into what the store takes and sends only changes', () => {
    const before = draftsFor(reasons.fields, damaged.values);
    expect(before).toMatchObject({ name: 'Damaged', active: true, position: '2', kind: 'damaged' });
    expect(before.meta).toBe('{\n  "a": 1\n}');
    const after = { ...before, name: 'Broken', meta: '{"a":1}', position: '3' };
    expect(changedValues(reasons.fields, before, after)).toEqual({ name: 'Broken', position: 3 });
    expect(payload(f('kind'), null)).toBeNull();
    expect(payload(f('meta'), '')).toBeNull();
    expect(payload(f('notes'), '  keep  ')).toBe('  keep  ');
  });

  it('fills a new record with what was typed and leaves untouched switches to the store', () => {
    const drafts = draftsFor(reasons.fields, {});
    expect(createValues(reasons.fields.slice(1, 5), { ...drafts, name: 'Lost', kind: 'lost' })).toEqual({
      name: 'Lost',
      kind: 'lost',
    });
    // A required switch left alone is sent as off.
    expect(createValues([{ ...f('active'), required: true }], { active: null })).toEqual({ active: false });
  });

  it('validates numbers, dates, JSON, email and colours', () => {
    const t = (type: string) => field({ name: 'x', type });
    expect(validateDraft(f('name'), ' ')).toBe('Required.');
    expect(validateDraft(t('integer'), '1.5')).toMatch(/whole number/);
    expect(validateDraft(t('integer'), '-3')).toBeNull();
    expect(validateDraft(t('decimal'), '12,50')).toBeNull();
    expect(payload(t('decimal'), '12,50')).toBe('12.50');
    expect(validateDraft(t('decimal'), '1.2.3')).toMatch(/number/);
    expect(validateDraft(t('date'), '2026-02-30')).toMatch(/YYYY-MM-DD/);
    expect(validateDraft(t('datetime'), '2026-12-01 25:00')).toMatch(/HH:MM/);
    expect(validateDraft(t('json'), '{nope')).toMatch(/JSON/);
    expect(validateDraft(t('email'), 'a@b')).toBeNull();
    expect(validateDraft(t('email'), 'ab')).toMatch(/email/);
    expect(validateDraft(t('color'), '#12345')).toMatch(/hex/);
    expect(validateDraft(t('color'), 'teal')).toBeNull();
  });

  it('keeps datetimes in ISO and shows them in local time', () => {
    const iso = isoFromLocal('2026-12-01 14:30') as string;
    expect(localDateTime(iso)).toBe('2026-12-01 14:30');
    expect(isoFromLocal('2026-12-01')).toBe(new Date(2026, 11, 1).toISOString());
    const dt = field({ name: 'at', type: 'datetime' });
    expect(draftsFor([dt], { at: iso }).at).toBe('2026-12-01 14:30');
    expect(payload(dt, '2026-12-01 14:30')).toBe(iso);
  });

  it('displays values and list details', () => {
    expect(displayValue(f('active'), false)).toBe('No');
    expect(displayValue(f('kind'), 'lost')).toBe('Lost');
    expect(displayValue(f('geo'), { lat: 1 })).toBe('{"lat":1}');
    expect(displayValue(states.fields[1], { id: '38', title: 'Canada' })).toBe('Canada');
    expect(displayValue(f('notes'), '')).toBe('—');
    expect(listDetail(reasons, damaged)).toBe('Active: Yes · Position: 2');
    expect(singular('Refund reasons')).toBe('Refund reason');
    expect(singular('Categories')).toBe('Category');
    expect(singular('Statuses')).toBe('Status');
  });

  it("puts the store's 422 fields on form fields", () => {
    expect(
      serverFieldErrors(states.fields, {
        name: ["can't be blank"],
        country: ['must exist'],
        base: ['Locked'],
      }),
    ).toEqual({ byField: { name: "Can't be blank", country_id: 'Must exist' }, general: ['Locked'] });
  });

  it('groups types by section in host order and knows only safe icons', () => {
    expect(groupTypes([reasons, countries, states]).map((g) => [g.group, g.types.map((t) => t.key)])).toEqual(
      [
        ['Payments', ['refund_reasons']],
        ['Shipping', ['countries', 'states']],
      ],
    );
    expect(knownIcon('bell.fill')).toEqual({ ios: 'bell.fill', android: 'notifications' });
    expect(knownIcon('not.a.symbol')).toBeNull();
    expect(knownIcon(null)).toBeNull();
  });
});

describe('More screen', () => {
  it('adds a section per group after the built-in links', async () => {
    const { ui } = setup();
    await ui(<MoreScreen />);
    expect(await screen.findByText('Payments')).toBeTruthy();
    expect(screen.getByText('Promotions')).toBeTruthy();
    expect(screen.getByText('Shipping')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('States'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/more/admin/[key]', params: { key: 'states' } });
  });

  it('shows nothing extra without admin.resources', async () => {
    mockCaps = ['promotions.read'];
    const { ui, resources } = setup();
    await ui(<MoreScreen />);
    expect(screen.getByText('Promotions')).toBeTruthy();
    expect(screen.queryByText('Payments')).toBeNull();
    expect(resources.manifest).not.toHaveBeenCalled();
  });

  it('keeps working when the manifest fails', async () => {
    const { ui } = setup({
      manifest: jest.fn(async () => {
        throw new SpreeError({ kind: 'server', status: 500, message: 'Boom.' });
      }),
    });
    await ui(<MoreScreen />);
    expect(
      await screen.findByText(/Couldn't load this store's own admin types/, {}, { timeout: 4000 }),
    ).toBeTruthy();
    expect(screen.getByText('Promotions')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });
});

describe('list screen', () => {
  it('searches, filters and opens a record', async () => {
    mockParams = { key: 'refund_reasons' };
    const { ui, resources } = setup();
    await ui(<ListScreen />);
    expect(await screen.findByText('Damaged')).toBeTruthy();
    expect(screen.getByText('Active: Yes · Position: 2')).toBeTruthy();
    expect(resources.list).toHaveBeenLastCalledWith('refund_reasons', { perPage: 25, cursor: null });
    await fireEvent.press(screen.getByText('No'));
    await waitFor(() =>
      expect(resources.list).toHaveBeenLastCalledWith('refund_reasons', {
        perPage: 25,
        cursor: null,
        filters: { active: false },
      }),
    );
    await fireEvent.changeText(screen.getByLabelText('Search refund reasons'), ' dam ');
    await waitFor(() =>
      expect(resources.list).toHaveBeenLastCalledWith('refund_reasons', {
        perPage: 25,
        cursor: null,
        query: 'dam',
        filters: { active: false },
      }),
    );
    await fireEvent.press(await screen.findByText('Damaged'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/more/admin/[key]/[id]',
      params: { key: 'refund_reasons', id: '4' },
    });
  });
});

describe('record form', () => {
  it('saves only the changed fields', async () => {
    mockParams = { key: 'refund_reasons', id: '4' };
    const { ui, resources } = setup();
    await ui(<RecordScreen />);
    const name = await screen.findByLabelText('Name, required');
    expect(screen.getByText('{"lat":1}')).toBeTruthy();
    expect(screen.getByLabelText('Geo: {"lat":1}')).toBeTruthy();
    expect(screen.queryByLabelText('Created at')).toBeNull();
    await fireEvent.changeText(name, 'Broken');
    await fireEvent.press(screen.getByLabelText('Lost'));
    await fireEvent(screen.getByLabelText('Active'), 'valueChange', false);
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() =>
      expect(resources.update).toHaveBeenCalledWith('refund_reasons', '4', {
        name: 'Broken',
        kind: 'lost',
        active: false,
      }),
    );
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('blocks invalid input and shows the store’s field errors', async () => {
    mockParams = { key: 'refund_reasons', id: '4' };
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { ui, resources } = setup({
      update: jest.fn(async () => {
        throw new SpreeError({
          kind: 'invalid',
          status: 422,
          message: 'Name has already been taken',
          fieldErrors: { name: ['has already been taken'] },
        });
      }),
    });
    await ui(<RecordScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Position'), 'two');
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText('Enter a whole number.')).toBeTruthy();
    expect(resources.update).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Position'), '5');
    await fireEvent.changeText(screen.getByLabelText('Name, required'), 'Lost');
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText('Has already been taken')).toBeTruthy();
    expect(alert).toHaveBeenCalledWith("Couldn't save", 'Name has already been taken');
  });

  it('runs a confirmed action and shows its message', async () => {
    mockParams = { key: 'refund_reasons', id: '4' };
    const alert = answerAlerts('Retire');
    const { ui, resources } = setup();
    await ui(<RecordScreen />);
    await fireEvent.press(await screen.findByText('Retire'));
    expect(alert).toHaveBeenCalledWith('Retire', 'Stop offering this reason?', expect.any(Array));
    await waitFor(() => expect(resources.perform).toHaveBeenCalledWith('refund_reasons', '4', 'retire'));
    expect(await screen.findByText('Retired.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Retire')).toBeNull());
  });

  it('deletes after confirming', async () => {
    mockParams = { key: 'refund_reasons', id: '4' };
    answerAlerts('Delete');
    const { ui, resources } = setup();
    await ui(<RecordScreen />);
    await fireEvent.press(await screen.findByText('Delete'));
    await waitFor(() => expect(resources.remove).toHaveBeenCalledWith('refund_reasons', '4'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('creates with a reference chosen in the picker sheet', async () => {
    mockParams = { key: 'states' };
    const { ui, resources } = setup({
      create: jest.fn(async () => ({ id: '77', title: 'Yukon', subtitle: null, values: {}, actions: [] })),
    });
    await ui(<NewScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Name, required'), 'Yukon');
    await fireEvent.press(screen.getByText('Create'));
    expect(await screen.findByText('Required.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Country, required: none chosen'));
    const [{ params }] = mockPush.mock.calls.at(-1) as [{ params: Record<string, string> }];
    expect(params).toMatchObject({ resource: 'countries', label: 'Country', selected: '', optional: '' });
    await act(async () => {
      resolvePick(params.request as string, { id: '38', title: 'Canada' });
    });
    expect(await screen.findByText('Canada')).toBeTruthy();
    await fireEvent.press(screen.getByText('Create'));
    await waitFor(() =>
      expect(resources.create).toHaveBeenCalledWith('states', { name: 'Yukon', country_id: '38' }),
    );
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/more/admin/[key]/[id]',
        params: { key: 'states', id: '77' },
      }),
    );
  });

  it('the picker lists the target type and returns the pick', async () => {
    mockParams = { resource: 'countries', label: 'Country', request: 'r1', selected: '38', optional: '1' };
    const { ui, resources } = setup();
    const picked = jest.fn();
    jest.spyOn(require('@/admin-types/picker'), 'resolvePick').mockImplementation(picked);
    await ui(<PickSheet />);
    await waitFor(() => expect(resources.list).toHaveBeenCalled());
    expect(await screen.findByText('United States')).toBeTruthy();
    expect(screen.getByLabelText('Selected')).toBeTruthy();
    expect(screen.getByLabelText('Search countries')).toBeTruthy();
    expect(resources.list).toHaveBeenCalledWith('countries', { perPage: 25, cursor: null });
    await fireEvent.press(screen.getByText('United States'));
    expect(picked).toHaveBeenCalledWith('r1', { id: '233', title: 'United States' });
    expect(mockBack).toHaveBeenCalled();
  });
});
