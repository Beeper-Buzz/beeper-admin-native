import { z } from 'zod';
import { Id, IsoDateTime, tolerantEnum } from './common';

/** Derived from the schedule: active now, starts later, or ended. */
export const PromotionStatus = tolerantEnum(['active', 'scheduled', 'expired'] as const);
export type PromotionStatus = z.infer<typeof PromotionStatus>;

/** The order discount the app can show and edit. `other` covers rules and actions it can't. */
export const PromotionDiscount = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent'), amount: z.string() }),
  z.object({ type: z.literal('fixed'), amount: z.string(), currency: z.string().nullable() }),
  z.object({ type: z.literal('other'), label: z.string() }),
]);
export type PromotionDiscount = z.infer<typeof PromotionDiscount>;

export const Promotion = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  /** Coupon code; null for automatic promotions. */
  code: z.string().nullable(),
  status: PromotionStatus,
  startsAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
  usageLimit: z.number().int().positive().nullable(),
  usageCount: z.number().int().nonnegative().nullable(),
  discount: PromotionDiscount.nullable(),
  /** False when the promotion's actions are more than one order discount; edit those in Spree admin. */
  editableDiscount: z.boolean(),
  createdAt: IsoDateTime.nullable(),
  updatedAt: IsoDateTime.nullable(),
});
export type Promotion = z.infer<typeof Promotion>;

export const PromotionListFilter = z.enum(['all', 'active', 'scheduled', 'expired']);
export type PromotionListFilter = z.infer<typeof PromotionListFilter>;
