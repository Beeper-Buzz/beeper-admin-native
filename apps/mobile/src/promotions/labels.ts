import { formatMoney, type Promotion } from '@instincts/spree-domain';

/** "20% off", "$5.00 off", or the store's own label for other discounts. */
export function discountLabel(p: Pick<Promotion, 'discount'>): string {
  const d = p.discount;
  if (!d) return 'No discount';
  if (d.type === 'percent') return `${d.amount}% off`;
  if (d.type === 'fixed')
    return `${d.currency ? formatMoney({ amount: d.amount, currency: d.currency }) : d.amount} off`;
  return d.label;
}
