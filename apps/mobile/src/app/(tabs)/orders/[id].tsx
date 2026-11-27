import { layout, radius, space } from '@instincts/spree-ui';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { customerLabel, orderBadges } from '@/components/order-row';
import { Badge, Button, EmptyState, MoneyText, Screen, SpreeNumberText } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useOrderMutations } from '@/orders/use-order-mutations';
import { useCan } from '@/session/session';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trpc = useTRPC();
  const { colors } = useTheme();
  const { data: order, error, isPending } = useQuery(trpc.orders.get.queryOptions({ id }));
  const can = useCan();
  const actions = useOrderMutations(id);
  const actionError =
    actions.capture.error?.message ?? actions.cancel.error?.message ?? actions.ship.error?.message ?? null;

  if (isPending)
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: space[8] }} />
      </Screen>
    );
  if (error || !order)
    return (
      <Screen>
        <EmptyState title="Couldn't load this order" body={error?.message ?? 'Try again.'} />
      </Screen>
    );

  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.line }];
  const ref = { id: order.id, number: order.number };
  const canCancel =
    can('orders.cancel') &&
    order.status === 'placed' &&
    order.fulfillments.every((f) => f.status !== 'fulfilled' && f.status !== 'delivered');
  const confirmCancel = () =>
    Alert.alert(
      `Cancel ${order.number}?`,
      'The store cancels the order and releases its stock. Captured payments are refunded or voided the way your store handles cancellations.',
      [
        { text: 'Keep order', style: 'cancel' },
        { text: 'Cancel order', style: 'destructive', onPress: () => actions.cancel.mutate({ order: ref }) },
      ],
    );
  const address = order.shipAddress;
  return (
    <Screen>
      <Stack.Screen options={{ title: order.number }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: layout.gutter, gap: space[4] }}
      >
        <View style={{ gap: space[2] }}>
          <SpreeNumberText value={order.number} />
          <View style={{ flexDirection: 'row', gap: space[1], flexWrap: 'wrap' }}>
            {orderBadges(order).map(([tone, label]) => (
              <Badge key={label} tone={tone} label={label} />
            ))}
          </View>
          <MoneyText value={order.total} size="title1" font="display" />
          <Text tone="muted">
            {customerLabel(order)}
            {order.email ? ` · ${order.email}` : ''}
          </Text>
        </View>

        <View style={card}>
          {order.lineItems.map((li, i) => (
            <View
              key={li.id}
              style={[
                styles.line,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
              ]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={2}>{li.name}</Text>
                <Text size="caption" font="mono" tone="muted">
                  {[li.sku ? `SKU ${li.sku}` : null, li.optionsText, `×${li.quantity}`]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <MoneyText value={li.total} />
            </View>
          ))}
        </View>

        {address ? (
          <View style={{ gap: space[1] }}>
            <Label>Ship to</Label>
            <Text>{[address.firstName, address.lastName].filter(Boolean).join(' ')}</Text>
            <Text tone="muted">
              {[
                address.address1,
                address.address2,
                `${address.city} ${address.stateCode ?? ''} ${address.zipcode ?? ''}`.trim(),
                address.countryIso,
              ]
                .filter(Boolean)
                .join('\n')}
            </Text>
          </View>
        ) : null}

        {order.payments.length ? (
          <View style={{ gap: space[1] }}>
            <Label>Payments</Label>
            {order.payments.map((p) => (
              <View key={p.id} style={{ gap: space[2] }}>
                <View style={styles.kv}>
                  <Text style={{ flex: 1 }}>
                    {p.sourceSummary ?? p.methodName ?? 'Payment'} · {p.status}
                  </Text>
                  <MoneyText value={p.amount} />
                </View>
                <View style={styles.actions}>
                  {can('orders.capture') &&
                  // A manual payment (Check) recorded on a placed order waits in `checkout` until captured.
                  (p.status === 'pending' || (p.status === 'checkout' && order.status === 'placed')) &&
                  p.canCapture !== false ? (
                    <Button
                      title="Capture"
                      size="small"
                      variant="tonal"
                      loading={actions.capture.isPending && actions.capture.variables?.payment.id === p.id}
                      onPress={() =>
                        actions.capture.mutate({ order: ref, payment: { id: p.id, number: p.number } })
                      }
                    />
                  ) : null}
                  {can('orders.refund') && p.status === 'completed' ? (
                    <Button
                      title="Refund"
                      size="small"
                      variant="tonal"
                      onPress={() =>
                        router.push({ pathname: '/orders/refund', params: { id, payment: p.id } })
                      }
                    />
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {order.fulfillments.length ? (
          <View style={{ gap: space[1] }}>
            <Label>Shipments</Label>
            {order.fulfillments.map((s) => (
              <View key={s.id} style={{ gap: space[2] }}>
                <View style={styles.kv}>
                  <SpreeNumberText value={s.number} />
                  <Text tone="muted" style={{ flexShrink: 1, textAlign: 'right' }}>
                    {[s.methodName, s.status, s.trackingNumber].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {can('shipments.ship') && s.status === 'ready' ? (
                  <View style={styles.actions}>
                    <Button
                      title="Mark shipped"
                      size="small"
                      variant="tonal"
                      onPress={() =>
                        router.push({ pathname: '/orders/ship', params: { id, fulfillment: s.id } })
                      }
                    />
                  </View>
                ) : can('shipments.ship') && s.status === 'pending' && order.status === 'placed' ? (
                  <Text size="footnote" tone="muted">
                    Ships once the order is paid.
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
        {actionError ? (
          <Text size="footnote" tone="critical" accessibilityLiveRegion="polite">
            {actionError}
          </Text>
        ) : null}
        {canCancel ? (
          <Button
            title="Cancel order"
            variant="destructive"
            loading={actions.cancel.isPending}
            onPress={confirmCancel}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, overflow: 'hidden' },
  line: { flexDirection: 'row', gap: space[3], padding: space[3], alignItems: 'center' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3] },
  actions: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
});
