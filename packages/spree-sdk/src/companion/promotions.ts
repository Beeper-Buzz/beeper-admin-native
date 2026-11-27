import { Promotion, type PromotionDiscount } from '@instincts/spree-domain';
import type { ListPromotionsParams, PromotionsPort, PromotionUpdate } from '../ports';
import { assertSchedule, normalizeDecimal } from '../promotions/shared';
import type { Transport } from '../transport';

/** Promotions on Spree 4.2–4.3 through the companion gem (0.2+); API v1 only shows one by id. */
const BASE = '/api/admin_native/v1/promotions';

export interface GemPromotion {
  id: string;
  name: string;
  description: string | null;
  code: string | null;
  status: string;
  starts_at: string | null;
  expires_at: string | null;
  usage_limit: number | null;
  usage_count: number | null;
  discount:
    | { type: 'percent'; amount: string }
    | { type: 'fixed'; amount: string; currency?: string | null }
    | { type: 'other'; label: string }
    | null;
  editable_discount: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export function mapGemPromotion(p: GemPromotion): Promotion {
  let discount: PromotionDiscount | null = null;
  if (p.discount?.type === 'percent')
    discount = { type: 'percent', amount: normalizeDecimal(p.discount.amount) };
  else if (p.discount?.type === 'fixed')
    discount = {
      type: 'fixed',
      amount: normalizeDecimal(p.discount.amount),
      currency: p.discount.currency ?? null,
    };
  else if (p.discount?.type === 'other') discount = { type: 'other', label: p.discount.label };
  return Promotion.parse({
    id: p.id,
    name: p.name,
    description: p.description || null,
    code: p.code || null,
    status: p.status,
    startsAt: p.starts_at,
    expiresAt: p.expires_at,
    usageLimit: p.usage_limit,
    usageCount: p.usage_count,
    discount,
    editableDiscount: p.editable_discount,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  });
}

function body(patch: PromotionUpdate): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  if (patch.name !== undefined) b.name = patch.name;
  if (patch.description !== undefined) b.description = patch.description ?? '';
  if (patch.code !== undefined) b.code = patch.code ?? '';
  if (patch.startsAt !== undefined) b.starts_at = patch.startsAt;
  if (patch.expiresAt !== undefined) b.expires_at = patch.expiresAt;
  if (patch.usageLimit !== undefined) b.usage_limit = patch.usageLimit;
  if (patch.discount) b.discount = { type: patch.discount.type, amount: patch.discount.amount };
  return b;
}

export function companionPromotions(transport: Transport): PromotionsPort {
  const one = async (path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', payload?: unknown) => {
    const res = await transport.request<{ data: GemPromotion }>({ method, path, body: payload });
    return mapGemPromotion(res.data.data);
  };
  return {
    async list(params: ListPromotionsParams) {
      const page = params.cursor ? Number(params.cursor) : 1;
      const perPage = params.perPage ?? 25;
      const res = await transport.request<{
        data: GemPromotion[];
        meta: { page: number; per_page: number; total_count: number };
      }>({
        path: BASE,
        query: {
          q: params.query || undefined,
          status: params.filter && params.filter !== 'all' ? params.filter : undefined,
          page,
          per_page: perPage,
        },
      });
      const { data, meta } = res.data;
      return {
        items: data.map(mapGemPromotion),
        nextCursor: page * perPage < meta.total_count ? String(page + 1) : null,
        totalCount: meta.total_count,
      };
    },
    get: (id) => one(`${BASE}/${encodeURIComponent(id)}`),
    async create(input) {
      assertSchedule(input.startsAt, input.expiresAt);
      return one(BASE, 'POST', body(input));
    },
    async update(promotion, patch) {
      if (patch.startsAt !== undefined || patch.expiresAt !== undefined) {
        const current = await one(`${BASE}/${encodeURIComponent(promotion.id)}`);
        assertSchedule(
          patch.startsAt !== undefined ? patch.startsAt : current.startsAt,
          patch.expiresAt !== undefined ? patch.expiresAt : current.expiresAt,
        );
      }
      return one(`${BASE}/${encodeURIComponent(promotion.id)}`, 'PATCH', body(patch));
    },
  };
}
