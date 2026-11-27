import type { Session } from '@instincts/spree-api';
import type { Promotion } from '@instincts/spree-domain';
import { unsupportedCustomers, unsupportedProducts } from '@instincts/spree-sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import PromotionScreen from '@/app/(tabs)/more/promotions/[id]';
import PromotionsScreen from '@/app/(tabs)/more/promotions/index';
import { formFor, fromDay, toDay, validate } from '@/promotions/form';
import { discountLabel } from '@/promotions/labels';
import { AppThemeProvider } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';

const mockBack = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), push: (...a: unknown[]) => mockPush(...a) },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/session/session', () => ({ useCan: () => () => true }));

const spring: Promotion = {
  id: '7',
  name: 'Spring sale',
  description: null,
  code: 'spring20',
  status: 'active',
  startsAt: null,
  expiresAt: null,
  usageLimit: null,
  usageCount: 3,
  discount: { type: 'percent', amount: '20' },
  editableDiscount: true,
  createdAt: null,
  updatedAt: null,
};

function setup() {
  const promotions = {
    list: jest.fn(async () => ({ items: [spring], nextCursor: null, totalCount: 1 })),
    get: jest.fn(async () => spring),
    create: jest.fn(async () => ({ ...spring, id: '8' })),
    update: jest.fn(async () => spring),
  };
  const session = {
    probe: {
      baseUrl: 'https://shop.test',
      currency: 'USD',
      capabilities: ['promotions.read', 'promotions.write'],
    },
    adapter: {
      family: 'admin-v3',
      orders: {},
      products: unsupportedProducts,
      customers: unsupportedCustomers,
      promotions,
    },
  } as unknown as Session;
  const ui = (el: React.ReactElement) =>
    render(
      <AppThemeProvider>
        <ApiProvider session={session}>{el}</ApiProvider>
      </AppThemeProvider>,
    );
  return { promotions, ui };
}

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
});

describe('promotion form', () => {
  it('round-trips local dates and validates', () => {
    expect(toDay(fromDay('2026-12-01', 'start'))).toBe('2026-12-01');
    expect(toDay(fromDay('2026-12-01', 'end'))).toBe('2026-12-01');
    const f = formFor(undefined);
    expect(validate(f, true)).toMatchObject({ name: expect.any(String), amount: expect.any(String) });
    expect(validate({ ...f, name: 'X', amount: '150' }, true).amount).toMatch(/at most 100/);
    expect(validate({ ...f, name: 'X', kind: 'fixed', amount: '150' }, true)).toEqual({});
    expect(validate({ ...f, name: 'X', amount: '10', code: 'has space' }, true).code).toBeTruthy();
    expect(
      validate({ ...f, name: 'X', amount: '10', startsOn: '2026-12-02', endsOn: '2026-12-01' }, true).endsOn,
    ).toBe('Ends before it starts.');
    expect(validate({ ...f, name: 'X', amount: '' }, false)).toEqual({});
  });

  it('labels discounts', () => {
    expect(discountLabel(spring)).toBe('20% off');
    expect(discountLabel({ discount: { type: 'fixed', amount: '5', currency: 'USD' } })).toBe('$5.00 off');
    expect(discountLabel({ discount: { type: 'other', label: 'Free shipping' } })).toBe('Free shipping');
  });
});

describe('promotions screens', () => {
  it('lists active promotions and opens one', async () => {
    const { promotions, ui } = setup();
    await ui(<PromotionsScreen />);
    expect(await screen.findByText('Spring sale')).toBeTruthy();
    expect(screen.getByText('SPRING20 · 20% off')).toBeTruthy();
    expect(promotions.list).toHaveBeenCalledWith(expect.objectContaining({ filter: 'active' }));
    await fireEvent.press(screen.getByText('Spring sale'));
    expect(mockPush).toHaveBeenCalledWith('/more/promotions/7');
  });

  it('creates a fixed-amount code with the store currency', async () => {
    mockParams = { id: 'new' };
    const { promotions, ui } = setup();
    await ui(<PromotionScreen />);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Ten off');
    await fireEvent.changeText(
      screen.getByLabelText('Discount code (empty for an automatic promotion)'),
      'tenoff',
    );
    await fireEvent.press(screen.getByText('Fixed amount'));
    await fireEvent.changeText(screen.getByLabelText('Amount off the order'), '10');
    await fireEvent.press(screen.getByText('Create promotion'));
    await waitFor(() =>
      expect(promotions.create).toHaveBeenCalledWith({
        name: 'Ten off',
        code: 'TENOFF',
        startsAt: null,
        expiresAt: null,
        usageLimit: null,
        discount: { type: 'fixed', amount: '10', currency: 'USD' },
      }),
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('shows errors instead of saving an invalid form', async () => {
    mockParams = { id: 'new' };
    const { promotions, ui } = setup();
    await ui(<PromotionScreen />);
    await fireEvent.press(screen.getByText('Create promotion'));
    expect(screen.getByText('Give it a name.')).toBeTruthy();
    expect(promotions.create).not.toHaveBeenCalled();
  });

  it('saves only what changed, and ends a promotion now', async () => {
    mockParams = { id: '7' };
    const { promotions, ui } = setup();
    await ui(<PromotionScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Percent off the order'), '25');
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() =>
      expect(promotions.update).toHaveBeenCalledWith(
        { id: '7' },
        { discount: { type: 'percent', amount: '25' } },
      ),
    );
    await fireEvent.press(screen.getByText('End now'));
    await waitFor(() =>
      expect(promotions.update).toHaveBeenLastCalledWith({ id: '7' }, { expiresAt: expect.any(String) }),
    );
  });

  it('shows a new promotion in the list after creating it', async () => {
    mockParams = { id: 'new' };
    const { promotions, ui } = setup();
    let items = [spring];
    promotions.list.mockImplementation(async () => ({ items, nextCursor: null, totalCount: items.length }));
    promotions.create.mockImplementation(async () => {
      const created = { ...spring, id: '8', name: 'Ten off', code: 'TENOFF' };
      items = [created, spring];
      return created;
    });
    await ui(
      <>
        <PromotionsScreen />
        <PromotionScreen />
      </>,
    );
    expect(await screen.findByText('Spring sale')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Ten off');
    await fireEvent.changeText(screen.getByLabelText('Percent off the order'), '10');
    await fireEvent.press(screen.getByText('Create promotion'));
    expect(await screen.findByText('TENOFF · 20% off')).toBeTruthy();
  });
});
