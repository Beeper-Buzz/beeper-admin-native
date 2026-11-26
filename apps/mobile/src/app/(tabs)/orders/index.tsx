import type { OrderListFilter } from '@instincts/spree-domain';
import { layout, radius, space } from '@instincts/spree-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { OrderRow } from '@/components/order-row';
import { EmptyState, Screen } from '@/components/primitives';
import { Text } from '@/components/text';
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
  const { colors } = useTheme();
  const [filter, setFilter] = useState<OrderListFilter>('unfulfilled');
  const query = useInfiniteQuery(
    trpc.orders.list.infiniteQueryOptions(
      { filter, perPage: 25 },
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
  );
  const orders = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={orders}
        keyExtractor={(o) => o.id}
        renderItem={({ item }) => (
          <OrderRow order={item} onPress={() => router.push(`/orders/${item.number}`)} />
        )}
        ListHeaderComponent={
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              gap: space[2],
              paddingHorizontal: layout.gutter,
              paddingVertical: space[3],
            }}
          >
            {FILTERS.map(([key, label]) => {
              const on = key === filter;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => setFilter(key)}
                  style={{
                    paddingHorizontal: space[3],
                    paddingVertical: 6,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: on ? colors.ink : colors.line,
                    backgroundColor: on ? colors.ink : colors.surface,
                  }}
                >
                  <Text size="footnote" font="uiMedium" style={{ color: on ? colors.bg : colors.ink }}>
                    {label}
                    {on && query.data?.pages[0]?.totalCount !== undefined
                      ? ` ${query.data.pages[0].totalCount}`
                      : ''}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
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
