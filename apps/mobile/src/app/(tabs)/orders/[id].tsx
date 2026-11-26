import { layout, radius, space } from '@instincts/spree-ui';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { customerLabel, orderBadges } from '@/components/order-row';
import { Badge, EmptyState, MoneyText, Screen, SpreeNumberText } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trpc = useTRPC();
  const { colors } = useTheme();
  const { data: order, error, isPending } = useQuery(trpc.orders.get.queryOptions({ id }));

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
              <View key={p.id} style={styles.kv}>
                <Text>
                  {p.sourceSummary ?? p.methodName ?? 'Payment'} · {p.status}
                </Text>
                <MoneyText value={p.amount} />
              </View>
            ))}
          </View>
        ) : null}

        {order.fulfillments.length ? (
          <View style={{ gap: space[1] }}>
            <Label>Shipments</Label>
            {order.fulfillments.map((s) => (
              <View key={s.id} style={styles.kv}>
                <SpreeNumberText value={s.number} />
                <Text tone="muted">
                  {[s.methodName, s.status, s.trackingNumber].filter(Boolean).join(' · ')}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <Text size="footnote" tone="muted">
          Fulfil, capture and refund arrive in v0.1.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, overflow: 'hidden' },
  line: { flexDirection: 'row', gap: space[3], padding: space[3], alignItems: 'center' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3] },
});
