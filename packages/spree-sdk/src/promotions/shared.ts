import type { PromotionStatus } from '@instincts/spree-domain';
import { SpreeError } from '../errors';

/** Active now, starts later, or ended, from the schedule (both APIs store only dates). */
export function promotionStatus(
  startsAt: string | null,
  expiresAt: string | null,
  now: Date = new Date(),
): PromotionStatus {
  if (startsAt && Date.parse(startsAt) > now.getTime()) return 'scheduled';
  if (expiresAt && Date.parse(expiresAt) <= now.getTime()) return 'expired';
  return 'active';
}

/** Rejects a schedule that ends before it starts before anything is sent (Spree 6 half-applies a failed PATCH). */
export function assertSchedule(startsAt: string | null | undefined, expiresAt: string | null | undefined) {
  if (!startsAt || !expiresAt) return;
  if (Date.parse(expiresAt) <= Date.parse(startsAt)) {
    throw new SpreeError({
      kind: 'invalid',
      status: 422,
      message: 'The end date must be after the start date.',
      fieldErrors: { expiresAt: ['must be after the start date'] },
    });
  }
}

/** "5.00" / "5.0" / "5" → "5", "12.50" → "12.5": one spelling per value across APIs. */
export function normalizeDecimal(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}
