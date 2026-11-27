import { layout, radius, space } from '@instincts/spree-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { FilterChips } from '@/components/filter-chips';
import { Badge, EmptyState, Screen, TextField } from '@/components/primitives';
import { Text } from '@/components/text';
import { useDebounced } from '@/components/use-debounced';
import { LIBRARY_COLUMNS, type LibraryFilter, libraryEmpty, libraryImageLabel } from '@/media/library';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

const FILTERS = [
  ['all', 'All photos'],
  ['missingAlt', 'Missing alt text'],
] as const satisfies readonly (readonly [LibraryFilter, string])[];

/** Every product photo in the store, newest first; tap one to open its product. */
export default function MediaScreen() {
  const trpc = useTRPC();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const list = useInfiniteQuery(
    trpc.media.library.infiniteQueryOptions(
      { missingAlt: filter === 'missingAlt', perPage: 24, ...(query ? { query } : {}) },
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
  );
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const [emptyTitle, emptyBody] = libraryEmpty(filter, query);

  return (
    <Screen>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        data={items}
        numColumns={LIBRARY_COLUMNS}
        keyExtractor={(i) => `${i.productId}:${i.id}`}
        columnWrapperStyle={{ gap: space[2], paddingHorizontal: layout.gutter }}
        contentContainerStyle={{ gap: space[2] }}
        ListHeaderComponent={
          <View>
            <View style={{ paddingHorizontal: layout.gutter, paddingTop: space[2] }}>
              <TextField
                label="Search by product"
                value={search}
                onChangeText={setSearch}
                placeholder="Product name"
                autoCorrect={false}
                clearButtonMode="while-editing"
                returnKeyType="search"
              />
            </View>
            <FilterChips
              options={FILTERS}
              value={filter}
              onChange={setFilter}
              count={list.data?.pages[0]?.totalCount}
            />
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={libraryImageLabel(item)}
            accessibilityHint="Opens the product"
            onPress={() => router.push(`/products/${item.productId}`)}
            style={({ pressed }) => ({ flex: 1 / LIBRARY_COLUMNS, gap: 4, opacity: pressed ? 0.7 : 1 })}
          >
            <View>
              <Image
                source={{ uri: item.thumbUrl ?? item.url }}
                accessibilityIgnoresInvertColors
                style={{
                  width: '100%',
                  aspectRatio: 1,
                  borderRadius: radius.badge,
                  backgroundColor: colors.surface,
                }}
                contentFit="cover"
              />
              {item.alt === null ? (
                <View style={{ position: 'absolute', left: 4, top: 4 }} pointerEvents="none">
                  <Badge tone="attention" label="No alt" />
                </View>
              ) : null}
            </View>
            <Text size="caption" tone="muted" numberOfLines={1}>
              {item.productName ?? 'Unknown product'}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          list.isPending ? (
            <ActivityIndicator style={{ marginTop: space[8] }} />
          ) : list.error ? (
            <EmptyState title="Couldn't load photos" body={list.error.message} />
          ) : (
            <EmptyState title={emptyTitle} body={emptyBody} />
          )
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator style={{ marginVertical: space[4] }} />
          ) : (
            <View style={{ height: space[8] }} />
          )
        }
        refreshControl={
          <RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />
        }
      />
    </Screen>
  );
}
