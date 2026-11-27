import { Promotion, type PromotionDiscount, type PromotionListFilter } from '@instincts/spree-domain';
import type { PaginatedResponse } from '@spree/admin-sdk';
import { SpreeError } from '../../errors';
import type { PromotionDiscountInput, PromotionsPort, PromotionUpdate } from '../../ports';
import { assertSchedule, normalizeDecimal, promotionStatus } from '../../promotions/shared';
import type { QueryObject } from '../../query';
import type { Transport } from '../../transport';

const BASE = '/api/v3/admin/promotions';

export interface V3PromotionAction {
  id: string;
  type: string;
  calculator: { type: string; preferences: Record<string, unknown> } | null;
}

export interface V3Promotion {
  id: string;
  name: string;
  description: string | null;
  code: string | null;
  kind?: string;
  starts_at: string | null;
  expires_at: string | null;
  usage_limit: number | null;
  created_at: string | null;
  updated_at: string | null;
  actions?: V3PromotionAction[];
}

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** One order discount the app understands, or `other` with a readable label. */
export function v3Discount(actions: V3PromotionAction[] | undefined): {
  discount: PromotionDiscount | null;
  editable: boolean;
  action: V3PromotionAction | null;
} {
  if (!actions || actions.length === 0) return { discount: null, editable: true, action: null };
  const [only] = actions;
  if (actions.length === 1 && only && only.type === 'create_adjustment') {
    const c = only.calculator;
    if (c?.type === 'flat_percent_item_total')
      return {
        discount: { type: 'percent', amount: normalizeDecimal(String(c.preferences.flat_percent ?? '0')) },
        editable: true,
        action: only,
      };
    if (c?.type === 'flat_rate')
      return {
        discount: {
          type: 'fixed',
          amount: normalizeDecimal(String(c.preferences.amount ?? '0')),
          currency: (c.preferences.currency as string | undefined) ?? null,
        },
        editable: true,
        action: only,
      };
    return {
      discount: { type: 'other', label: humanize(c?.type ?? 'Order discount') },
      editable: true,
      action: only,
    };
  }
  return {
    discount: { type: 'other', label: actions.map((a) => humanize(a.type)).join(', ') },
    editable: false,
    action: null,
  };
}

export function mapV3Promotion(p: V3Promotion, now: Date = new Date()): Promotion {
  const { discount, editable } = v3Discount(p.actions);
  return Promotion.parse({
    id: p.id,
    name: p.name,
    description: p.description || null,
    code: p.code || null,
    status: promotionStatus(p.starts_at, p.expires_at, now),
    startsAt: p.starts_at,
    expiresAt: p.expires_at,
    usageLimit: p.usage_limit,
    usageCount: null,
    discount,
    editableDiscount: editable,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  });
}

/** Ransack for the status filters (starts_at / expires_at are whitelisted on Spree 6). */
export function v3StatusQuery(filter: PromotionListFilter | undefined, now: Date): QueryObject {
  const t = now.toISOString();
  switch (filter) {
    case 'scheduled':
      return { starts_at_gt: t };
    case 'expired':
      return { expires_at_lteq: t };
    case 'active':
      return {
        g: {
          0: { m: 'or', starts_at_null: 1, starts_at_lteq: t },
          1: { m: 'or', expires_at_null: 1, expires_at_gt: t },
        },
      };
    default:
      return {};
  }
}

function calculator(d: PromotionDiscountInput) {
  return d.type === 'percent'
    ? { type: 'flat_percent_item_total', preferences: { flat_percent: d.amount } }
    : {
        type: 'flat_rate',
        preferences: { amount: d.amount, ...(d.currency ? { currency: d.currency } : {}) },
      };
}

function attributes(patch: PromotionUpdate): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  if (patch.name !== undefined) b.name = patch.name;
  if (patch.description !== undefined) b.description = patch.description || null;
  if (patch.code !== undefined) {
    b.code = patch.code || null;
    b.kind = patch.code ? 'coupon_code' : 'automatic';
  }
  if (patch.startsAt !== undefined) b.starts_at = patch.startsAt;
  if (patch.expiresAt !== undefined) b.expires_at = patch.expiresAt;
  if (patch.usageLimit !== undefined) b.usage_limit = patch.usageLimit;
  return b;
}

export function adminV3Promotions(
  transport: Transport,
  clock: () => Date = () => new Date(),
): PromotionsPort {
  const fetchOne = async (id: string) => {
    const res = await transport.request<V3Promotion>({
      path: `${BASE}/${encodeURIComponent(id)}`,
      query: { expand: 'actions' },
    });
    return res.data;
  };
  return {
    async list(params) {
      const q: Record<string, unknown> = { ...v3StatusQuery(params.filter, clock()) };
      if (params.query) q.name_or_code_cont = params.query;
      const res = await transport.request<PaginatedResponse<V3Promotion>>({
        path: BASE,
        query: {
          q: q as QueryObject,
          page: params.cursor ? Number(params.cursor) : 1,
          limit: params.perPage ?? 25,
          sort: '-created_at',
          expand: 'actions',
        },
      });
      const { data, meta } = res.data;
      const now = clock();
      return {
        items: data.map((p) => mapV3Promotion(p, now)),
        nextCursor: meta.next ? String(meta.next) : null,
        totalCount: meta.count,
      };
    },

    async get(id) {
      return mapV3Promotion(await fetchOne(id), clock());
    },

    async create(input) {
      assertSchedule(input.startsAt, input.expiresAt);
      const res = await transport.request<V3Promotion>({
        method: 'POST',
        path: BASE,
        body: {
          kind: input.code ? 'coupon_code' : 'automatic',
          ...attributes(input),
          actions: [{ type: 'create_adjustment', calculator: calculator(input.discount) }],
        },
      });
      return mapV3Promotion(await fetchOne(res.data.id), clock());
    },

    async update(promotion, patch) {
      const current = await fetchOne(promotion.id);
      assertSchedule(
        patch.startsAt !== undefined ? patch.startsAt : current.starts_at,
        patch.expiresAt !== undefined ? patch.expiresAt : current.expires_at,
      );
      const b = attributes(patch);
      if (patch.discount) {
        const { editable, action } = v3Discount(current.actions);
        if (!editable)
          throw new SpreeError({
            kind: 'invalid',
            status: 422,
            message: "This promotion has actions the app can't edit; change its discount in Spree admin.",
          });
        // `actions` replaces the whole set: keep the one discount by id so it's updated in place.
        b.actions = [
          {
            ...(action ? { id: action.id } : {}),
            type: 'create_adjustment',
            calculator: calculator(patch.discount),
          },
        ];
      }
      await transport.request({
        method: 'PATCH',
        path: `${BASE}/${encodeURIComponent(promotion.id)}`,
        body: b,
      });
      return mapV3Promotion(await fetchOne(promotion.id), clock());
    },
  };
}
