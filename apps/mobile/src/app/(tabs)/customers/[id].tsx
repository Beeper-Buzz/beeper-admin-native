import { cityLine, displayName } from '@instincts/spree-domain';
import { layout, radius, space } from '@instincts/spree-ui';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { OrderRow } from '@/components/order-row';
import { EmptyState, MoneyText, Screen } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useCan } from '@/session/session';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trpc = useTRPC();
  const can = useCan();
  const { colors } = useTheme();
  const { data: customer, error, isPending } = useQuery(trpc.customers.get.queryOptions({ id }));
  const orders = useQuery({
    ...trpc.orders.list.queryOptions({ filter: 'all', query: customer?.email ?? '', perPage: 10 }),
    enabled: !!customer?.email && can('orders.read'),
  });

  if (isPending)
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: space[8] }} />
      </Screen>
    );
  if (error || !customer)
    return (
      <Screen>
        <EmptyState title="Couldn't load this customer" body={error?.message ?? 'Try again.'} />
      </Screen>
    );

  const a = customer.defaultAddress;
  // Search matches on email; keep only this customer's orders.
  const theirs = (orders.data?.items ?? []).filter(
    (o) => o.email?.toLowerCase() === customer.email.toLowerCase(),
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: displayName(customer) }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: layout.gutter, gap: space[4] }}
      >
        <View style={{ gap: space[1] }}>
          <Text size="title2" font="display">
            {displayName(customer)}
          </Text>
          <Text
            tone="accent"
            accessibilityRole="link"
            onPress={() => void Linking.openURL(`mailto:${customer.email}`)}
          >
            {customer.email}
          </Text>
          {customer.phone ? (
            <Text
              tone="accent"
              accessibilityRole="link"
              onPress={() => void Linking.openURL(`tel:${customer.phone}`)}
            >
              {customer.phone}
            </Text>
          ) : null}
        </View>

        <View style={styles.stats}>
          <View style={[styles.stat, { borderColor: colors.line, backgroundColor: colors.surface }]}>
            <Label>Orders</Label>
            <Text size="title2" font="display">
              {customer.ordersCount ?? '–'}
            </Text>
          </View>
          <View style={[styles.stat, { borderColor: colors.line, backgroundColor: colors.surface }]}>
            <Label>Spent</Label>
            {customer.totalSpent ? (
              <MoneyText value={customer.totalSpent} size="title2" font="display" />
            ) : (
              <Text size="title2" font="display">
                –
              </Text>
            )}
          </View>
        </View>

        {a ? (
          <View style={{ gap: space[1] }}>
            <Label>Address</Label>
            <Text tone="muted">
              {[a.address1, a.address2, cityLine(a), a.zipcode].filter(Boolean).join('\n')}
            </Text>
          </View>
        ) : null}

        {can('orders.read') ? (
          <View style={{ gap: space[1] }}>
            <Label>Recent orders</Label>
            {orders.isPending ? (
              <ActivityIndicator />
            ) : theirs.length ? (
              <View style={{ marginHorizontal: -layout.gutter }}>
                {theirs.map((o) => (
                  <OrderRow key={o.id} order={o} onPress={() => router.push(`/orders/${o.number}`)} />
                ))}
              </View>
            ) : (
              <Text tone="muted">No orders yet.</Text>
            )}
          </View>
        ) : null}
        <Text size="footnote" tone="muted">
          Customer since {new Date(customer.createdAt).toLocaleDateString()}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: space[3] },
  stat: {
    flex: 1,
    gap: 2,
    padding: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
  },
});
