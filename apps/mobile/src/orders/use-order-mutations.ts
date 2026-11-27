import type { Order } from '@instincts/spree-domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/trpc';

/**
 * Order actions. Each returns the order as it now is: put it in the detail cache (under the
 * key the screen used, number or id) and refresh lists and Home.
 */
export function useOrderMutations(cacheId: string) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const onSuccess = (order: Order) => {
    qc.setQueryData(trpc.orders.get.queryKey({ id: cacheId }), order);
    void qc.invalidateQueries(trpc.orders.list.pathFilter());
    void qc.invalidateQueries(trpc.dashboard.pathFilter());
  };
  return {
    ship: useMutation(trpc.orders.ship.mutationOptions({ onSuccess })),
    capture: useMutation(trpc.orders.capture.mutationOptions({ onSuccess })),
    cancel: useMutation(trpc.orders.cancel.mutationOptions({ onSuccess })),
    refund: useMutation(trpc.orders.refund.mutationOptions({ onSuccess })),
  };
}
