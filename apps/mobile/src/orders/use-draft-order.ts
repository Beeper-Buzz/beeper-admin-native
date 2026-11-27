import type { Order } from '@instincts/spree-domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useStoreId } from '@/session/session';
import { useTRPC } from '@/trpc/trpc';
import { type DraftRef, forgetDraft, rememberDraft } from './active-draft';

/**
 * Creating an order. Every step returns the draft as it now is: cache it under its number (the
 * review screen's key), and remember it as the draft in progress until it is placed or discarded.
 */
export function useDraftOrder() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const storeId = useStoreId();

  const remember = useCallback(
    (ref: DraftRef) => (storeId ? rememberDraft(storeId, ref) : Promise.resolve()),
    [storeId],
  );
  const forget = useCallback(() => (storeId ? forgetDraft(storeId) : Promise.resolve()), [storeId]);
  const cache = (order: Order) => qc.setQueryData(trpc.orders.get.queryKey({ id: order.number }), order);
  const saved = (order: Order) => {
    cache(order);
    void remember({ id: order.id, number: order.number });
  };

  return {
    forget,
    create: useMutation(trpc.orders.createDraft.mutationOptions({ onSuccess: saved })),
    update: useMutation(trpc.orders.updateDraft.mutationOptions({ onSuccess: saved })),
    selectRate: useMutation(trpc.orders.selectShippingRate.mutationOptions({ onSuccess: cache })),
    place: useMutation(
      trpc.orders.place.mutationOptions({
        onSuccess: (order) => {
          cache(order);
          void forget();
          void qc.invalidateQueries(trpc.orders.list.pathFilter());
          void qc.invalidateQueries(trpc.dashboard.pathFilter());
        },
      }),
    ),
    discard: useMutation(
      trpc.orders.discardDraft.mutationOptions({
        onSuccess: ({ discarded }) => {
          qc.removeQueries({ queryKey: trpc.orders.get.queryKey({ id: discarded }) });
          void forget();
        },
      }),
    ),
  };
}
