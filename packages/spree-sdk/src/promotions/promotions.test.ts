import { describe, expect, it, vi } from 'vitest';
import {
  adminV3Promotions,
  mapV3Promotion,
  v3Discount,
  v3StatusQuery,
} from '../adapters/admin-v3/promotions';
import { companionPromotions, mapGemPromotion } from '../companion/promotions';
import { encodeQuery } from '../query';
import type { Transport } from '../transport';
import { assertSchedule, normalizeDecimal, promotionStatus } from './shared';

const NOW = new Date('2026-11-26T12:00:00Z');

describe('promotion status', () => {
  it('derives status from the schedule', () => {
    expect(promotionStatus(null, null, NOW)).toBe('active');
    expect(promotionStatus('2026-12-01T00:00:00Z', null, NOW)).toBe('scheduled');
    expect(promotionStatus('2026-01-01T00:00:00Z', '2026-11-26T12:00:00Z', NOW)).toBe('expired');
    expect(promotionStatus('2026-01-01T00:00:00Z', '2026-11-27T00:00:00Z', NOW)).toBe('active');
  });

  it('refuses an end before the start', () => {
    expect(() => assertSchedule('2026-12-02T00:00:00Z', '2026-12-01T00:00:00Z')).toThrow(/after the start/);
    expect(() => assertSchedule('2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z')).not.toThrow();
    expect(() => assertSchedule(null, '2020-01-01T00:00:00Z')).not.toThrow();
  });

  it('spells decimals one way', () => {
    expect(normalizeDecimal('20.0')).toBe('20');
    expect(normalizeDecimal('5.00')).toBe('5');
    expect(normalizeDecimal('12.50')).toBe('12.5');
  });
});

describe('Spree 6 promotions', () => {
  const pct = {
    id: 'pact_1',
    type: 'create_adjustment',
    calculator: { type: 'flat_percent_item_total', preferences: { flat_percent: '20.0' } },
  };

  it('reads one order discount as editable', () => {
    expect(v3Discount([pct])).toMatchObject({ discount: { type: 'percent', amount: '20' }, editable: true });
    expect(
      v3Discount([
        {
          id: 'a',
          type: 'create_adjustment',
          calculator: { type: 'flat_rate', preferences: { amount: '5.00', currency: 'USD' } },
        },
      ]),
    ).toMatchObject({ discount: { type: 'fixed', amount: '5', currency: 'USD' }, editable: true });
    expect(v3Discount([])).toEqual({ discount: null, editable: true, action: null });
  });

  it('labels other actions and locks their discount', () => {
    expect(v3Discount([{ id: 'a', type: 'free_shipping', calculator: null }])).toEqual({
      discount: { type: 'other', label: 'Free shipping' },
      editable: false,
      action: null,
    });
  });

  it('maps a promotion', () => {
    const p = mapV3Promotion(
      {
        id: 'promo_1',
        name: 'Spring',
        description: null,
        code: 'spring20',
        starts_at: '2026-01-01T00:00:00Z',
        expires_at: null,
        usage_limit: 100,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        actions: [pct],
      },
      NOW,
    );
    expect(p).toMatchObject({
      id: 'promo_1',
      code: 'spring20',
      status: 'active',
      usageLimit: 100,
      usageCount: null,
    });
  });

  it('filters active promotions server-side', () => {
    const q = encodeQuery({ q: v3StatusQuery('active', NOW) });
    expect(decodeURIComponent(q)).toBe(
      'q[g][0][m]=or&q[g][0][starts_at_null]=1&q[g][0][starts_at_lteq]=2026-11-26T12:00:00.000Z&' +
        'q[g][1][m]=or&q[g][1][expires_at_null]=1&q[g][1][expires_at_gt]=2026-11-26T12:00:00.000Z',
    );
    expect(v3StatusQuery('all', NOW)).toEqual({});
  });

  it('updates the existing discount in place and refuses uneditable ones', async () => {
    const promo = {
      id: 'promo_1',
      name: 'P',
      description: null,
      code: null,
      starts_at: null,
      expires_at: null,
      usage_limit: null,
      created_at: null,
      updated_at: null,
    };
    const request = vi.fn(async (req: { method?: string; path: string; body?: unknown }) => ({
      status: 200,
      headers: new Headers(),
      data: {
        ...promo,
        actions: req.path.includes('promo_2')
          ? [{ id: 'x', type: 'free_shipping', calculator: null }]
          : [pct],
      },
    }));
    const port = adminV3Promotions({ request } as unknown as Transport, () => NOW);
    await port.update({ id: 'promo_1' }, { discount: { type: 'fixed', amount: '5', currency: 'USD' } });
    const patch = request.mock.calls.find(([r]) => r.method === 'PATCH')?.[0];
    expect(patch?.body).toEqual({
      actions: [
        {
          id: 'pact_1',
          type: 'create_adjustment',
          calculator: { type: 'flat_rate', preferences: { amount: '5', currency: 'USD' } },
        },
      ],
    });
    await expect(
      port.update({ id: 'promo_2' }, { discount: { type: 'percent', amount: '10' } }),
    ).rejects.toMatchObject({
      kind: 'invalid',
    });
  });
});

describe('gem promotions (Spree 4.2–4.3)', () => {
  it('maps the gem payload', () => {
    expect(
      mapGemPromotion({
        id: '3',
        name: 'Ten off',
        description: '',
        code: 'TENOFF',
        status: 'expired',
        starts_at: null,
        expires_at: '2026-01-01T00:00:00Z',
        usage_limit: null,
        usage_count: 4,
        discount: { type: 'fixed', amount: '10.0', currency: 'USD' },
        editable_discount: true,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      }),
    ).toMatchObject({
      id: '3',
      description: null,
      status: 'expired',
      usageCount: 4,
      discount: { type: 'fixed', amount: '10' },
    });
  });

  it('pages with the total count and passes filters', async () => {
    const request = vi.fn(async () => ({
      status: 200,
      headers: new Headers(),
      data: { data: [], meta: { page: 1, per_page: 2, total_count: 5 } },
    }));
    const page = await companionPromotions({ request } as unknown as Transport).list({
      query: 'spring',
      filter: 'active',
      perPage: 2,
    });
    expect(page).toEqual({ items: [], nextCursor: '2', totalCount: 5 });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ query: { q: 'spring', status: 'active', page: 1, per_page: 2 } }),
    );
  });
});
