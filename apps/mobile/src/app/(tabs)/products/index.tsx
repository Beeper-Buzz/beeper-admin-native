import { isLowStock, sellableVariants } from '@instincts/spree-domain';
import { layout, radius, space } from '@instincts/spree-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { FilterChips } from '@/components/filter-chips';
import { ListRow } from '@/components/list-row';
import { Badge, EmptyState, MoneyText, Screen, TextField } from '@/components/primitives';
import { useDebounced } from '@/components/use-debounced';
import { stockLine } from '@/products/products';
import { useCan } from '@/session/session';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

type Filter = 'all' | 'active' | 'draft' | 'archived' | 'lowStock';
const STATUS_FILTERS = [
  ['all', 'All'],
  ['active', 'Active'],
  ['draft', 'Draft'],
  ['archived', 'Archived'],
] as const satisfies readonly (readonly [Filter, string])[];
const LOW_STOCK = ['lowStock', 'Low stock'] as const;

export default function ProductsScreen() {
  const trpc = useTRPC();
  const { colors } = useTheme();
  const can = useCan();
  const filters = can('inventory.lowStock') ? [...STATUS_FILTERS, LOW_STOCK] : STATUS_FILTERS;
  // Home's low-stock row opens this tab on ?filter=lowStock.
  const params = useLocalSearchParams<{ filter?: string }>();
  const linked = filters.find(([key]) => key === params.filter)?.[0];
  const [filter, setFilter] = useState<Filter>(linked ?? 'all');
  useEffect(() => {
    if (linked) setFilter(linked);
  }, [linked]);
  const lowStock = filter === 'lowStock';
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const list = useInfiniteQuery(
    trpc.products.list.infiniteQueryOptions(
      lowStock
        ? { lowStock: true, perPage: 25 }
        : { status: filter as Exclude<Filter, 'lowStock'>, perPage: 25, ...(query ? { query } : {}) },
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
  );
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        data={items}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={
          <View>
            {/* Low stock ignores search, so the field is hidden there. */}
            {lowStock ? null : (
              <View style={{ paddingHorizontal: layout.gutter, paddingTop: space[2] }}>
                <TextField
                  label="Search products"
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Name or SKU"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  returnKeyType="search"
                />
              </View>
            )}
            <FilterChips
              options={filters}
              value={filter}
              onChange={setFilter}
              count={list.data?.pages[0]?.totalCount}
            />
          </View>
        }
        renderItem={({ item, index }) => {
          const variant = sellableVariants(item)[0];
          const low = sellableVariants(item).some((v) => isLowStock(v));
          return (
            <ListRow
              first={index === 0}
              title={item.name}
              subtitle={stockLine(item)}
              onPress={() => router.push(`/products/${item.id}`)}
              leading={
                <Image
                  source={item.imageUrl ? { uri: item.imageUrl } : null}
                  accessibilityIgnoresInvertColors
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.badge,
                    backgroundColor: colors.surface,
                  }}
                  contentFit="cover"
                />
              }
              trailing={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  {variant?.price ? <MoneyText value={variant.price} /> : null}
                  {item.status !== 'active' ? (
                    <Badge tone="neutral" label={item.status === 'draft' ? 'Draft' : 'Archived'} />
                  ) : low ? (
                    <Badge tone="attention" label="Low stock" />
                  ) : null}
                </View>
              }
            />
          );
        }}
        ListEmptyComponent={
          list.isPending ? (
            <ActivityIndicator style={{ marginTop: space[8] }} />
          ) : list.error ? (
            <EmptyState title="Couldn't load products" body={list.error.message} />
          ) : (
            <EmptyState
              title={lowStock ? 'Nothing low on stock' : query ? 'No matches' : 'No products here'}
              body={
                lowStock
                  ? 'Products whose tracked variants run low appear here, lowest first.'
                  : query
                    ? `Nothing matches “${query}”.`
                    : 'Products with this status appear here.'
              }
            />
          )
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={<View style={{ height: space[8] }} />}
        refreshControl={
          <RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />
        }
      />
    </Screen>
  );
}
