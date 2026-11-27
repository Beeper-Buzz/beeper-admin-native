import type { OrderListFilter } from '@instincts/spree-domain';
import { space } from '@instincts/spree-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { FilterChips } from '@/components/filter-chips';
import { OrderRow } from '@/components/order-row';
import { EmptyState, Screen } from '@/components/primitives';
import { Text } from '@/components/text';
import { useCan } from '@/session/session';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

const FILTERS: [OrderListFilter, string][] = [
  ['unfulfilled', 'Unfulfilled'],
  ['unpaid', 'Unpaid'],
  ['open', 'Open'],
  ['all', 'All'],
];

const EMPTY: Record<OrderListFilter, [string, string]> = {
  unfulfilled: ['Nothing to ship', 'Paid orders waiting to be fulfilled appear here.'],
  unpaid: ['No payments due', 'Orders with a balance due appear here.'],
  open: ['No open orders', 'Orders that need any action appear here.'],
  all: ['No orders yet', 'Completed orders from your store appear here.'],
};

export default function OrdersScreen() {
  const trpc = useTRPC();
  const can = useCan();
  const { colors } = useTheme();
  // Home's to-do rows open this tab on a filter (?filter=unpaid).
  const params = useLocalSearchParams<{ filter?: string }>();
  const linked = FILTERS.find(([key]) => key === params.filter)?.[0];
  const [filter, setFilter] = useState<OrderListFilter>(linked ?? 'unfulfilled');
  useEffect(() => {
    if (linked) setFilter(linked);
  }, [linked]);
  const query = useInfiniteQuery(
    trpc.orders.list.infiniteQueryOptions(
      { filter, perPage: 25 },
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
  );
  const orders = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerRight: can('orders.create')
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="New order"
                  onPress={() => router.push('/orders/new')}
                >
                  <Text font="uiSemibold" style={{ color: colors.accentInk }}>
                    New
                  </Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={orders}
        keyExtractor={(o) => o.id}
        renderItem={({ item }) => (
          <OrderRow order={item} onPress={() => router.push(`/orders/${item.number}`)} />
        )}
        ListHeaderComponent={
          <FilterChips
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            count={query.data?.pages[0]?.totalCount}
          />
        }
        ListEmptyComponent={
          query.isPending ? (
            <ActivityIndicator style={{ marginTop: space[8] }} />
          ) : query.error ? (
            <EmptyState title="Couldn't load orders" body={query.error.message} />
          ) : (
            <EmptyState title={EMPTY[filter][0]} body={EMPTY[filter][1]} />
          )
        }
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <ActivityIndicator style={{ margin: space[4] }} />
          ) : (
            <View style={{ height: space[8] }} />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => {
              void query.refetch();
            }}
          />
        }
      />
    </Screen>
  );
}
