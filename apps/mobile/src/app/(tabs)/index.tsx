import { layout, radius, space } from '@instincts/spree-ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MoneyText, Screen } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useCan, useSession } from '@/session/session';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';
import { VisitorsCard } from '@/visitors/home-card';

export default function HomeScreen() {
  const trpc = useTRPC();
  const { colors } = useTheme();
  const { state } = useSession();
  const can = useCan();
  const hasSummary = state.store?.probe.capabilities.includes('analytics.summary') ?? false;
  const summary = useQuery({ ...trpc.dashboard.summary.queryOptions(), enabled: hasSummary });
  const [unfulfilled, unpaid] = useQueries({
    queries: [
      trpc.orders.list.queryOptions({ filter: 'unfulfilled', perPage: 1 }),
      trpc.orders.list.queryOptions({ filter: 'unpaid', perPage: 1 }),
    ],
  });
  const storeName =
    state.store?.probe.storeName ?? state.store?.probe.baseUrl.replace(/^https?:\/\//, '') ?? '';
  const todo: [number | undefined, string, string, 'attention' | 'info'][] = [
    [
      summary.data?.ordersToFulfill ?? unfulfilled?.data?.totalCount,
      'orders to fulfil',
      'unfulfilled',
      'attention',
    ],
    [summary.data?.paymentsDue ?? unpaid?.data?.totalCount, 'payments due', 'unpaid', 'attention'],
    ...(summary.data
      ? [
          [summary.data.lowStockVariants, 'variants low on stock', 'low-stock', 'info'] as [
            number,
            string,
            string,
            'info',
          ],
        ]
      : []),
  ];

  return (
    <Screen>
      {/* automatic insets keep the content clear of the status bar and the floating tab bar
          (with only a top safe area, the last rows scrolled under the tab bar out of reach). */}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: layout.gutter, gap: space[5], paddingBottom: space[8] }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <View style={[styles.mark, { backgroundColor: colors.ink }]}>
            <Text font="display" size="footnote" style={{ color: colors.bg }}>
              {storeName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text font="uiSemibold" numberOfLines={1}>
            {storeName}
          </Text>
        </View>
        {summary.data ? (
          <View style={{ gap: space[1] }}>
            <Label>Sales today</Label>
            <MoneyText value={summary.data.today.sales} size="hero" font="display" />
            <Text size="footnote" font="mono" tone="muted">
              {summary.data.today.orders} {summary.data.today.orders === 1 ? 'order' : 'orders'}
            </Text>
          </View>
        ) : null}
        <VisitorsCard hasVisitors={can('visitors')} hasCarts={can('carts')} />
        <View style={{ gap: space[2] }}>
          <Label>To do</Label>
          <View style={[styles.list, { borderColor: colors.line, backgroundColor: colors.line }]}>
            {todo.map(([count, label, filter, tone]) => (
              <Pressable
                key={filter}
                accessibilityRole="button"
                onPress={() =>
                  filter === 'low-stock'
                    ? router.navigate({ pathname: '/products', params: { filter: 'lowStock' } })
                    : router.navigate({ pathname: '/orders', params: { filter } })
                }
                style={({ pressed }) => [
                  styles.todo,
                  { backgroundColor: pressed ? colors.surfaceSunk : colors.surface },
                ]}
              >
                <View style={[styles.dot, { backgroundColor: colors[tone] }]} />
                <Text font="display" size="title3" style={{ minWidth: 28 }}>
                  {count ?? '–'}
                </Text>
                <Text style={{ flex: 1 }}>{label}</Text>
                <Text tone="muted">›</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {hasSummary ? null : (
          <Text size="footnote" tone="muted">
            Install the spree_admin_native gem on your store for today's sales, low stock and order
            notifications.
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  mark: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  list: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    overflow: 'hidden',
    gap: StyleSheet.hairlineWidth,
  },
  todo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    minHeight: layout.rowMinHeight,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
