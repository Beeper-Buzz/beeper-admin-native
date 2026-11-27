import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, EmptyState, Screen, Sheet, SpreeNumberText, TextField } from '@/components/primitives';
import { Text } from '@/components/text';
import { useOrderMutations } from '@/orders/use-order-mutations';
import { useTRPC } from '@/trpc/trpc';

/** Sheet: mark one shipment shipped, with an optional tracking number or link. */
export default function ShipSheet() {
  const { id, fulfillment: fulfillmentId } = useLocalSearchParams<{ id: string; fulfillment: string }>();
  const trpc = useTRPC();
  const { data: order } = useQuery(trpc.orders.get.queryOptions({ id }));
  const { ship } = useOrderMutations(id);
  const [tracking, setTracking] = useState('');
  const fulfillment = order?.fulfillments.find((f) => f.id === fulfillmentId);

  if (!order || !fulfillment)
    return (
      <Screen>
        <EmptyState title="Shipment not found" body="Go back to the order and try again." />
      </Screen>
    );

  return (
    <Sheet>
      <Text size="title2" font="display">
        Mark shipped
      </Text>
      <Text tone="muted">
        {order.number} · <SpreeNumberText value={fulfillment.number} />
        {fulfillment.methodName ? ` · ${fulfillment.methodName}` : ''}
      </Text>
      <TextField
        label="Tracking number or link (optional)"
        value={tracking}
        onChangeText={setTracking}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="done"
        placeholder="1Z999AA10123456784"
      />
      {ship.error ? (
        <Text size="footnote" tone="critical" accessibilityLiveRegion="polite">
          {ship.error.message}
        </Text>
      ) : null}
      <Button
        title="Mark shipped"
        loading={ship.isPending}
        onPress={() =>
          ship.mutate(
            {
              order: { id: order.id, number: order.number },
              fulfillment: { id: fulfillment.id, number: fulfillment.number },
              tracking: tracking.trim() || null,
            },
            { onSuccess: () => router.back() },
          )
        }
      />
    </Sheet>
  );
}
