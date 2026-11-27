import { type Product, sellableVariants } from '@instincts/spree-domain';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/trpc';

/** "3 variants · 12 in stock", or the single variant's SKU and stock. */
export function stockLine(p: Product): string {
  const variants = sellableVariants(p);
  const tracked = variants.filter((v) => v.totalOnHand !== null);
  const stock = tracked.length ? `${tracked.reduce((n, v) => n + (v.totalOnHand ?? 0), 0)} in stock` : null;
  const lead = variants.length > 1 ? `${variants.length} variants` : (variants[0]?.sku ?? null);
  return [lead, stock].filter(Boolean).join(' · ');
}

/** Puts a changed product in the detail cache and refreshes product lists. */
export function useProductSaved() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return (p: Product) => {
    qc.setQueryData(trpc.products.get.queryKey({ id: p.id }), p);
    void qc.invalidateQueries(trpc.products.list.pathFilter());
  };
}
