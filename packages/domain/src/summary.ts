import { z } from 'zod';
import { Money } from './money';

const OptionalCount = z.number().int().nonnegative().nullable().catch(null).default(null);

/** Home screen numbers (companion gem `GET /summary`, or Spree 6 dashboard counters later). */
export const StoreSummary = z.object({
  currency: z.string().length(3),
  timeZone: z.string().nullable(),
  today: z.object({ orders: z.number().int().nonnegative(), sales: Money }),
  ordersToFulfill: z.number().int().nonnegative(),
  paymentsDue: z.number().int().nonnegative(),
  lowStockVariants: z.number().int().nonnegative(),
  generatedAt: z.iso.datetime({ offset: true }),
  /** Gem 0.7, with `visitors`: storefront sessions seen in the last 2 minutes; null without. */
  visitorsOnline: OptionalCount,
  /** Gem 0.7, with `carts`: carts with items; null without. */
  activeCarts: OptionalCount,
});
export type StoreSummary = z.infer<typeof StoreSummary>;
