import type { Session } from '@instincts/spree-api';
import { Order } from '@instincts/spree-domain';
import { unsupportedCustomers, unsupportedProducts, unsupportedPromotions } from '@instincts/spree-sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import OrderScreen from '@/app/(tabs)/orders/[id]';
import RefundSheet from '@/app/(tabs)/orders/refund';
import ShipSheet from '@/app/(tabs)/orders/ship';
import { AppThemeProvider } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';
import fixture from '../../../../packages/domain/test/fixtures/order.json';

const mockBack = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), push: (...a: unknown[]) => mockPush(...a) },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/session/session', () => ({ useCan: () => () => true }));

const base = Order.parse(fixture);
const ref = { id: base.id, number: base.number };
/** One pending card payment and one ready shipment. */
const pending: Order = {
  ...base,
  paymentStatus: 'authorized',
  payments: base.payments.map((p) => ({ ...p, status: 'pending', canCapture: true })),
};
const captured: Order = { ...pending, paymentStatus: 'paid', payments: base.payments };

function setup(order: Order) {
  const orders = {
    list: jest.fn(),
    get: jest.fn(async () => order),
    ship: jest.fn(async () => ({ ...order, fulfillmentStatus: 'fulfilled' as const })),
    capture: jest.fn(async () => captured),
    cancel: jest.fn(async () => ({ ...order, status: 'canceled' as const })),
    refund: jest.fn(async () => order),
    refundReasons: jest.fn(async () => [
      { id: '1', name: 'Return processing' },
      { id: '2', name: 'Damaged' },
    ]),
  };
  const session = {
    probe: {
      baseUrl: 'https://shop.test',
      currency: 'USD',
      capabilities: ['orders.read', 'orders.capture', 'orders.cancel', 'orders.refund', 'shipments.ship'],
    },
    adapter: {
      family: 'api-v1',
      orders,
      products: unsupportedProducts,
      customers: unsupportedCustomers,
      promotions: unsupportedPromotions,
    },
  } as unknown as Session;
  const ui = (el: React.ReactElement) =>
    render(
      <AppThemeProvider>
        <ApiProvider session={session}>{el}</ApiProvider>
      </AppThemeProvider>,
    );
  return { orders, ui };
}

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
  mockParams = { id: base.number };
});

describe('order actions', () => {
  it('captures a pending payment and then offers a refund', async () => {
    const { orders, ui } = setup(pending);
    await ui(<OrderScreen />);
    await fireEvent.press(await screen.findByText('Capture'));
    await waitFor(() => expect(orders.capture).toHaveBeenCalledWith(ref, { id: '9', number: 'P7K2M4ZD' }));
    expect(await screen.findByText('Refund')).toBeTruthy();
    expect(screen.queryByText('Capture')).toBeNull();
  });

  it('opens the ship and refund sheets for the right shipment and payment', async () => {
    const { ui } = setup(captured);
    await ui(<OrderScreen />);
    await fireEvent.press(await screen.findByText('Mark shipped'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/orders/ship',
      params: { id: base.number, fulfillment: '5' },
    });
    await fireEvent.press(screen.getByText('Refund'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/orders/refund',
      params: { id: base.number, payment: '9' },
    });
  });

  it('cancels only after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const { orders, ui } = setup(captured);
    await ui(<OrderScreen />);
    await fireEvent.press(await screen.findByText('Cancel order'));
    expect(orders.cancel).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]?.[2] ?? [];
    buttons.find((b) => b.style === 'destructive')?.onPress?.();
    await waitFor(() => expect(orders.cancel).toHaveBeenCalledWith(ref));
    alert.mockRestore();
  });

  it('ships with a trimmed tracking number and closes the sheet', async () => {
    mockParams = { id: base.number, fulfillment: '5' };
    const { orders, ui } = setup(captured);
    await ui(<ShipSheet />);
    await fireEvent.changeText(await screen.findByLabelText('Tracking number or link (optional)'), ' 1Z999 ');
    await fireEvent.press(screen.getByRole('button', { name: 'Mark shipped' }));
    await waitFor(() =>
      expect(orders.ship).toHaveBeenCalledWith(ref, { id: '5', number: 'H38120471' }, { tracking: '1Z999' }),
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('refunds part of a payment with the chosen reason', async () => {
    mockParams = { id: base.number, payment: '9' };
    const { orders, ui } = setup(captured);
    await ui(<RefundSheet />);
    const amount = await screen.findByLabelText('Amount (USD)');
    await fireEvent.changeText(amount, '12,5');
    await fireEvent.press(await screen.findByText('Damaged'));
    await fireEvent.press(screen.getByText('Refund $12.50'));
    await waitFor(() =>
      expect(orders.refund).toHaveBeenCalledWith(ref, {
        payment: { id: '9', number: 'P7K2M4ZD' },
        amount: '12.5',
        reasonId: '2',
      }),
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('blocks refunds that are not an amount', async () => {
    mockParams = { id: base.number, payment: '9' };
    const { orders, ui } = setup(captured);
    await ui(<RefundSheet />);
    await fireEvent.changeText(await screen.findByLabelText('Amount (USD)'), 'abc');
    expect(screen.getByText('Enter an amount like 12.50.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Refund' }));
    expect(orders.refund).not.toHaveBeenCalled();
  });
});
