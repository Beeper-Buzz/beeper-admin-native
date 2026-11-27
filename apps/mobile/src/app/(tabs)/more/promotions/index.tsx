import type { PromotionListFilter } from '@instincts/spree-domain';
import { layout, space } from '@instincts/spree-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { FilterChips } from '@/components/filter-chips';
import { Badge, type BadgeTone, EmptyState, Screen } from '@/components/primitives';
import { Text } from '@/components/text';
import { discountLabel } from '@/promotions/labels';
import { useCan } from '@/session/session';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

const FILTERS = [
  ['active', 'Active'],
  ['scheduled', 'Scheduled'],
  ['expired', 'Ended'],
  ['all', 'All'],
] as const satisfies readonly (readonly [PromotionListFilter, string])[];

const EMPTY: Record<PromotionListFilter, [string, string]> = {
  active: ['No active promotions', 'Create a discount code to run one now.'],
  scheduled: ['Nothing scheduled', 'Promotions with a future start date appear here.'],
  expired: ['No ended promotions', 'Promotions past their end date appear here.'],
  all: ['No promotions yet', 'Create a discount code or an automatic offer.'],
};

const STATUS: Record<string, [BadgeTone, string]> = {
  active: ['positive', 'Active'],
  scheduled: ['info', 'Scheduled'],
  expired: ['neutral', 'Ended'],
};

export default function PromotionsScreen() {
  const trpc = useTRPC();
  const can = useCan();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<PromotionListFilter>('active');
  const query = useInfiniteQuery(
    trpc.promotions.list.infiniteQueryOptions(
      { filter, perPage: 25 },
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerRight: can('promotions.write')
            ? () => (
                <Pressable accessibilityRole="button" onPress={() => router.push('/more/promotions/new')}>
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
        data={items}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={
          <FilterChips
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            count={query.data?.pages[0]?.totalCount}
          />
        }
        renderItem={({ item, index }) => {
          const [tone, label] = STATUS[item.status] ?? ['neutral', item.status];
          return (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push(`/more/promotions/${item.id}`)}
              style={({ pressed }) => [
                styles.row,
                {
                  opacity: pressed ? 0.7 : 1,
                  borderTopColor: colors.line,
                  borderTopWidth: index ? StyleSheet.hairlineWidth : 0,
                },
              ]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text font="uiSemibold" numberOfLines={1}>
                  {item.name}
                </Text>
                <Text size="footnote" font={item.code ? 'mono' : 'ui'} tone="muted" numberOfLines={1}>
                  {[item.code ? item.code.toUpperCase() : 'Automatic', discountLabel(item)].join(' · ')}
                </Text>
              </View>
              <Badge tone={tone} label={label} />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          query.isPending ? (
            <ActivityIndicator style={{ marginTop: space[8] }} />
          ) : query.error ? (
            <EmptyState title="Couldn't load promotions" body={query.error.message} />
          ) : (
            <EmptyState title={EMPTY[filter][0]} body={EMPTY[filter][1]} />
          )
        }
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={<View style={{ height: space[8] }} />}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: layout.gutter,
    paddingVertical: space[3],
  },
});
