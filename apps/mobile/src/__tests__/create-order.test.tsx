import type { Session } from '@instincts/spree-api';
import { type Customer, Order, type Product } from '@instincts/spree-domain';
import { unsupportedPromotions } from '@instincts/spree-sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import ReviewDraftScreen from '@/app/(tabs)/orders/draft';
import NewOrderScreen from '@/app/(tabs)/orders/new';
import { AppThemeProvider } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';
import orderFixture from '../../../../packages/domain/test/fixtures/order.json';

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), dismissAll: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    back: (...a: unknown[]) => mockRouter.back(...a),
    push: (...a: unknown[]) => mockRouter.push(...a),
    replace: (...a: unknown[]) => mockRouter.replace(...a),
    dismissAll: (...a: unknown[]) => mockRouter.dismissAll(...a),
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/session/session', () => ({ useCan: () => () => true, useStoreId: () => 'shop.test' }));

const usd = (amount: string) => ({ amount, currency: 'USD' });
const variant = (id: string, sku: string, optionsText: string | null, price: string, isMaster = false) => ({
  id,
  sku,
  optionsText,
  isMaster,
  price: usd(price),
  compareAtPrice: null,
  totalOnHand: 9,
  imageUrl: null,
  optionValues: [],
  images: [],
  purchasable: null,
});
const tee: Product = {
  id: 'p1',
  name: 'Logo tee',
  slug: 'logo-tee',
  status: 'active',
  description: null,
  imageUrl: null,
  updatedAt: null,
  optionTypes: [],
  images: [],
  variants: [
    variant('m', 'TEE', null, '20.00', true),
    variant('v1', 'TEE-S', 'Size: S', '20.00'),
    variant('v2', 'TEE-M', 'Size: M', '22.00'),
  ],
};
const address = {
  firstName: 'Maya',
  lastName: 'Ortiz',
  company: null,
  address1: '1 Main St',
  address2: null,
  city: 'Portland',
  zipcode: '97201',
  phone: '555-0100',
  stateCode: 'OR',
  stateName: 'Oregon',
  countryIso: 'US',
};
const maya: Customer = {
  id: 'c1',
  email: 'maya@example.com',
  firstName: 'Maya',
  lastName: 'Ortiz',
  phone: null,
  ordersCount: 2,
  totalSpent: null,
  createdAt: '2026-01-01T00:00:00Z',
  defaultAddress: address,
};

const placedFixture = Order.parse(orderFixture);
const draft: Order = {
  ...placedFixture,
  number: 'R900000001',
  status: 'draft',
  completedAt: null,
  paymentStatus: 'none',
  payments: [],
  total: usd('49.00'),
  fulfillments: placedFixture.fulfillments.map((f) => ({
    ...f,
    status: 'pending' as const,
    rates: [
      { id: 'r1', name: 'Ground', cost: usd('5.00'), selected: true },
      { id: 'r2', name: 'Express', cost: usd('15.00'), selected: false },
    ],
  })),
};
const ref = { id: draft.id, number: draft.number };

function setup(order: Order = draft) {
  const orders = {
    list: jest.fn(),
    get: jest.fn(async () => order),
    createDraft: jest.fn(async () => order),
    updateDraft: jest.fn(async () => order),
    selectShippingRate: jest.fn(async () => order),
    paymentMethods: jest.fn(async () => [
      { id: '3', name: 'Check', description: 'Pay by check.' },
      { id: '4', name: 'Cash', description: null },
    ]),
    place: jest.fn(async () => ({ ...order, status: 'placed' as const })),
    discardDraft: jest.fn(async () => undefined),
  };
  const customers = { list: jest.fn(async () => ({ items: [maya], nextCursor: null })), get: jest.fn() };
  const products = { list: jest.fn(async () => ({ items: [tee], nextCursor: null })), get: jest.fn() };
  const session = {
    probe: {
      baseUrl: 'https://shop.test',
      currency: 'USD',
      capabilities: ['orders.read', 'orders.create', 'customers.read', 'products.read'],
    },
    adapter: { family: 'admin-v3', orders, products, customers, promotions: unsupportedPromotions },
  } as unknown as Session;
  const ui = (el: React.ReactElement) =>
    render(
      <AppThemeProvider>
        <ApiProvider session={session}>{el}</ApiProvider>
      </AppThemeProvider>,
    );
  return { orders, customers, products, ui };
}

beforeEach(async () => {
  for (const fn of Object.values(mockRouter)) fn.mockClear();
  mockParams = {};
  await SecureStore.deleteItemAsync('orders.draft.shop.test');
});

describe('new order', () => {
  it('picks a customer, prefills their address, adds a variant and saves the draft', async () => {
    const { orders, ui } = setup();
    await ui(<NewOrderScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Customer'), 'maya');
    await fireEvent.press(await screen.findByLabelText('Choose Maya Ortiz'));
    expect(screen.getByLabelText('Shipping street address').props.value).toBe('1 Main St');

    await fireEvent.changeText(screen.getByLabelText('Add products'), 'tee');
    await fireEvent.press(await screen.findByLabelText('Show variants of Logo tee'));
    await fireEvent.press(screen.getByLabelText('Add Logo tee, Size: M'));
    await fireEvent.press(screen.getByLabelText('One more Logo tee, Size: M'));
    expect(screen.getByLabelText('Quantity of Logo tee, Size: M: 2')).toBeTruthy();
    expect(screen.getAllByText('$44.00').length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByText('Continue to shipping and payment'));
    await waitFor(() =>
      expect(orders.createDraft).toHaveBeenCalledWith({
        customerId: 'c1',
        email: 'maya@example.com',
        items: [{ variantId: 'v2', quantity: 2 }],
        shipAddress: { ...address, stateName: null },
        billAddress: null,
      }),
    );
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/orders/draft', params: { id: draft.number } });
    expect(await SecureStore.getItemAsync('orders.draft.shop.test')).toBe(JSON.stringify(ref));
  });

  it('checks the form first, then orders as a guest with a separate billing address', async () => {
    const { orders, ui } = setup();
    await ui(<NewOrderScreen />);
    await fireEvent.press(await screen.findByText('Continue to shipping and payment'));
    expect(screen.getByText('Add at least one product.')).toBeTruthy();
    expect(screen.getByText('Check the highlighted fields.')).toBeTruthy();
    expect(orders.createDraft).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Customer'), 'pat@example.com');
    await fireEvent.press(await screen.findByLabelText('Order as guest pat@example.com'));
    await fireEvent.changeText(screen.getByLabelText('Add products'), 'tee');
    await fireEvent.press(await screen.findByLabelText('Show variants of Logo tee'));
    await fireEvent.press(screen.getByLabelText('Add Logo tee, Size: S'));
    const fill = async (prefix: string, values: Record<string, string>) => {
      for (const [label, v] of Object.entries(values))
        await fireEvent.changeText(screen.getByLabelText(`${prefix} ${label}`), v);
    };
    await fill('Shipping', {
      'first name': 'Pat',
      'last name': 'Guest',
      'street address': '2 Side St',
      city: 'Seattle',
      'state or province': 'wa',
      'zip or postal code': '98101',
    });
    await fireEvent(screen.getByLabelText('Bill to the shipping address'), 'valueChange', false);
    await fill('Billing', {
      'first name': 'Acme',
      'last name': 'Accounts',
      'street address': '9 Ledger Ln',
      city: 'Boston',
    });
    await fireEvent.press(screen.getByText('Continue to shipping and payment'));
    await waitFor(() => expect(orders.createDraft).toHaveBeenCalled());
    expect(orders.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: null,
        email: 'pat@example.com',
        items: [{ variantId: 'v1', quantity: 1 }],
        shipAddress: expect.objectContaining({
          firstName: 'Pat',
          city: 'Seattle',
          stateCode: 'WA',
          countryIso: 'US',
        }),
        billAddress: expect.objectContaining({ firstName: 'Acme', address1: '9 Ledger Ln', company: null }),
      }),
    );
  });

  it('resumes the draft in progress and saves changes to it', async () => {
    await SecureStore.setItemAsync('orders.draft.shop.test', JSON.stringify(ref));
    const { orders, ui } = setup();
    await ui(<NewOrderScreen />);
    expect(await screen.findByText(/Continuing the draft/)).toBeTruthy();
    expect(screen.getByText('Waxed canvas tote')).toBeTruthy();
    await fireEvent.press(screen.getByText('Continue to shipping and payment'));
    await waitFor(() =>
      expect(orders.updateDraft).toHaveBeenCalledWith(
        ref,
        expect.objectContaining({ email: 'maya@example.com' }),
      ),
    );
    expect(orders.createDraft).not.toHaveBeenCalled();
  });

  it('forgets a remembered draft that has been placed since', async () => {
    await SecureStore.setItemAsync('orders.draft.shop.test', JSON.stringify(ref));
    const { ui } = setup(placedFixture);
    await ui(<NewOrderScreen />);
    expect(await screen.findByText('Continue to shipping and payment')).toBeTruthy();
    expect(screen.queryByText(/Continuing the draft/)).toBeNull();
    expect(await SecureStore.getItemAsync('orders.draft.shop.test')).toBeNull();
  });
});

describe('review and place', () => {
  beforeEach(() => {
    mockParams = { id: draft.number };
  });

  it('chooses a rate, leaves a balance due with a manual method, places and opens the order', async () => {
    await SecureStore.setItemAsync('orders.draft.shop.test', JSON.stringify(ref));
    const { orders, ui } = setup();
    await ui(<ReviewDraftScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Express' }));
    await waitFor(() =>
      expect(orders.selectShippingRate).toHaveBeenCalledWith(ref, { id: '5', number: 'H38120471' }, 'r2'),
    );
    expect(await screen.findByRole('radio', { name: 'Check', checked: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Cash' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Balance due' }));
    expect(screen.getByText('Due after placing')).toBeTruthy();
    await fireEvent.press(screen.getByText('Place order'));
    await waitFor(() =>
      expect(orders.place).toHaveBeenCalledWith(ref, { payment: { methodId: '4', markPaid: false } }),
    );
    expect(mockRouter.dismissAll).toHaveBeenCalled();
    expect(mockRouter.push).toHaveBeenCalledWith(`/orders/${draft.number}`);
    expect(await SecureStore.getItemAsync('orders.draft.shop.test')).toBeNull();
  });

  it('places with nothing recorded when the store has no manual method', async () => {
    const { orders, ui } = setup();
    orders.paymentMethods.mockResolvedValueOnce([]);
    await ui(<ReviewDraftScreen />);
    expect(await screen.findByText(/no payment method that works without a card/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Place order'));
    await waitFor(() => expect(orders.place).toHaveBeenCalledWith(ref, { payment: null }));
  });

  it('discards only after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const { orders, ui } = setup();
    await ui(<ReviewDraftScreen />);
    await fireEvent.press(await screen.findByText('Discard draft'));
    expect(orders.discardDraft).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]?.[2] ?? [];
    buttons.find((b) => b.style === 'destructive')?.onPress?.();
    await waitFor(() => expect(orders.discardDraft).toHaveBeenCalledWith(ref));
    await waitFor(() => expect(mockRouter.dismissAll).toHaveBeenCalled());
    alert.mockRestore();
  });

  it('shows a placed order instead of the review', async () => {
    const { ui } = setup(placedFixture);
    mockParams = { id: placedFixture.number };
    await ui(<ReviewDraftScreen />);
    await fireEvent.press(await screen.findByText('View order'));
    expect(mockRouter.replace).toHaveBeenCalledWith(`/orders/${placedFixture.number}`);
  });
});
