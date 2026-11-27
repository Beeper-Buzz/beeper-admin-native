import type { Session } from '@instincts/spree-api';
import { Order, type Product } from '@instincts/spree-domain';
import { unsupportedPromotions } from '@instincts/spree-sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import CustomerScreen from '@/app/(tabs)/customers/[id]';
import CustomersScreen from '@/app/(tabs)/customers/index';
import ProductScreen from '@/app/(tabs)/products/[id]';
import ProductsScreen from '@/app/(tabs)/products/index';
import VariantSheet from '@/app/(tabs)/products/variant';
import { AppThemeProvider } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';
import orderFixture from '../../../../packages/domain/test/fixtures/order.json';

const mockBack = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), push: (...a: unknown[]) => mockPush(...a) },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/session/session', () => ({ useCan: () => () => true }));

const usd = (amount: string) => ({ amount, currency: 'USD' });

import OrdersScreen from '@/app/(tabs)/orders/index';

const tee: Product = {
  id: 'p1',
  name: 'Logo tee',
  slug: 'logo-tee',
  status: 'active',
  description: 'Soft cotton.',
  imageUrl: null,
  updatedAt: null,
  optionTypes: [],
  images: [],
  variants: [
    {
      id: 'm',
      sku: 'TEE',
      optionsText: null,
      isMaster: true,
      price: usd('20.00'),
      compareAtPrice: null,
      totalOnHand: null,
      imageUrl: null,
      optionValues: [],
      images: [],
      purchasable: null,
    },
    {
      id: 'v1',
      sku: 'TEE-S',
      optionsText: 'Size: S',
      isMaster: false,
      price: usd('20.00'),
      compareAtPrice: null,
      totalOnHand: 1,
      imageUrl: null,
      optionValues: [],
      images: [],
      purchasable: null,
    },
    {
      id: 'v2',
      sku: 'TEE-M',
      optionsText: 'Size: M',
      isMaster: false,
      price: usd('22.00'),
      compareAtPrice: null,
      totalOnHand: 9,
      imageUrl: null,
      optionValues: [],
      images: [],
      purchasable: null,
    },
  ],
};
const maya = {
  id: 'c1',
  email: 'maya@example.com',
  firstName: 'Maya',
  lastName: 'Ortiz',
  phone: null,
  ordersCount: 2,
  totalSpent: usd('184.00'),
  createdAt: '2026-01-01T00:00:00Z',
  defaultAddress: null,
};
const order = Order.parse(orderFixture);

function setup() {
  const products = {
    list: jest.fn(async () => ({ items: [tee], nextCursor: null, totalCount: 1 })),
    get: jest.fn(async () => tee),
    update: jest.fn(async () => ({ ...tee, status: 'draft' as const })),
    updateVariant: jest.fn(async () => tee),
    setStock: jest.fn(async () => tee),
  };
  const customers = {
    list: jest.fn(async () => ({ items: [maya], nextCursor: null })),
    get: jest.fn(async () => maya),
  };
  const orders = {
    list: jest.fn(async () => ({
      items: [
        { ...order, email: 'MAYA@example.com' },
        { ...order, id: 'x', email: 'other@example.com' },
      ],
      nextCursor: null,
    })),
  };
  const session = {
    probe: {
      baseUrl: 'https://shop.test',
      currency: 'USD',
      capabilities: [
        'orders.read',
        'products.read',
        'products.write',
        'inventory.adjust',
        'inventory.lowStock',
        'customers.read',
      ],
    },
    adapter: { family: 'api-v1', orders, products, customers, promotions: unsupportedPromotions },
  } as unknown as Session;
  const ui = (el: React.ReactElement) =>
    render(
      <AppThemeProvider>
        <ApiProvider session={session}>{el}</ApiProvider>
      </AppThemeProvider>,
    );
  return { products, customers, orders, ui };
}

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
});

describe('products', () => {
  it('lists with stock, flags low stock and searches by name or SKU', async () => {
    const { products, ui } = setup();
    await ui(<ProductsScreen />);
    expect(await screen.findByText('Logo tee')).toBeTruthy();
    expect(screen.getByText('2 variants · 10 in stock')).toBeTruthy();
    // The filter chip and the row's badge.
    expect(screen.getAllByText('Low stock')).toHaveLength(2);
    await fireEvent.changeText(screen.getByLabelText('Search products'), 'TEE-M');
    await waitFor(() =>
      expect(products.list).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'TEE-M' })),
    );
    await fireEvent.press(screen.getByText('Logo tee'));
    expect(mockPush).toHaveBeenCalledWith('/products/p1');
  });

  it('opens on the low-stock filter from Home and hides search there', async () => {
    mockParams = { filter: 'lowStock' };
    const { products, ui } = setup();
    await ui(<ProductsScreen />);
    await waitFor(() =>
      expect(products.list).toHaveBeenCalledWith(expect.objectContaining({ lowStock: true })),
    );
    expect(screen.queryByLabelText('Search products')).toBeNull();
    expect(screen.getByRole('tab', { name: /Low stock/ })).toBeTruthy();
    mockParams = {};
  });

  it('changes status and saves only edited fields', async () => {
    mockParams = { id: 'p1' };
    const { products, ui } = setup();
    await ui(<ProductScreen />);
    await fireEvent.press(await screen.findByText('Draft'));
    await waitFor(() => expect(products.update).toHaveBeenCalledWith({ id: 'p1' }, { status: 'draft' }));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Logo tee v2');
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() =>
      expect(products.update).toHaveBeenLastCalledWith({ id: 'p1' }, { name: 'Logo tee v2' }),
    );
  });

  it('opens a variant and saves price, then stock', async () => {
    mockParams = { id: 'p1' };
    const { ui } = setup();
    await ui(<ProductScreen />);
    await fireEvent.press(await screen.findByText('Size: S'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/products/variant',
      params: { id: 'p1', variant: 'v1' },
    });
  });

  it('variant sheet sends the price change and the new stock count', async () => {
    mockParams = { id: 'p1', variant: 'v1' };
    const { products, ui } = setup();
    await ui(<VariantSheet />);
    await fireEvent.changeText(await screen.findByLabelText('Price (USD)'), '24,50');
    await fireEvent.press(screen.getByLabelText('One more'));
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() =>
      expect(products.updateVariant).toHaveBeenCalledWith({ id: 'p1' }, 'v1', { price: '24.50' }),
    );
    await waitFor(() => expect(products.setStock).toHaveBeenCalledWith({ id: 'p1' }, 'v1', 2));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });
});

describe('customers', () => {
  it('lists customers with spend and searches', async () => {
    const { customers, ui } = setup();
    await ui(<CustomersScreen />);
    expect(await screen.findByText('Maya Ortiz')).toBeTruthy();
    expect(screen.getByText('$184.00')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search customers'), 'maya');
    await waitFor(() =>
      expect(customers.list).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'maya' })),
    );
  });

  it("shows a customer's own orders only", async () => {
    mockParams = { id: 'c1' };
    const { orders, ui } = setup();
    await ui(<CustomerScreen />);
    expect(await screen.findByText('maya@example.com')).toBeTruthy();
    await waitFor(() =>
      expect(orders.list).toHaveBeenCalledWith(expect.objectContaining({ query: 'maya@example.com' })),
    );
    expect(await screen.findAllByLabelText(`Number ${order.number}`)).toHaveLength(1);
  });
});

describe('orders list', () => {
  it("opens on Home's filter", async () => {
    mockParams = { filter: 'unpaid' };
    const { orders, ui } = setup();
    await ui(<OrdersScreen />);
    await waitFor(() =>
      expect(orders.list).toHaveBeenCalledWith(expect.objectContaining({ filter: 'unpaid' })),
    );
    mockParams = {};
  });
});
