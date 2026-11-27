import type { AdminFilter } from '@instincts/spree-domain';
import { layout, space } from '@instincts/spree-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useAdminType } from '@/admin-types/use-admin-types';
import { listDetail } from '@/admin-types/values';
import { FilterChips } from '@/components/filter-chips';
import { ListRow } from '@/components/list-row';
import { EmptyState, Screen, TextField } from '@/components/primitives';
import { Text } from '@/components/text';
import { useDebounced } from '@/components/use-debounced';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

const ALL = '*';

/** A filter's chosen option as the store's value (`true`, `'draft'`), skipping "All". */
function filterValues(filters: AdminFilter[], chosen: Record<string, string>) {
  const out: Record<string, string | number | boolean> = {};
  for (const f of filters) {
    const key = chosen[f.name];
    const option = key && key !== ALL ? f.options.find((o) => String(o.value) === key) : undefined;
    if (option) out[f.name] = option.value;
  }
  return out;
}

/** Records of one host-described admin type: search, filter chips, infinite list. */
export default function AdminTypeListScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const trpc = useTRPC();
  const { colors } = useTheme();
  const { type, isPending, error } = useAdminType(key);
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const filters = type ? type.filters.filter((f) => f.options.length) : [];
  const values = filterValues(filters, chosen);
  const list = useInfiniteQuery({
    ...trpc.resources.list.infiniteQueryOptions(
      {
        key,
        perPage: 25,
        ...(query && type?.searchable ? { query } : {}),
        ...(Object.keys(values).length ? { filters: values } : {}),
      },
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
    enabled: !!type,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const narrowed = !!query || Object.keys(values).length > 0;

  if (!type)
    return (
      <Screen>
        {isPending ? (
          <ActivityIndicator style={{ marginTop: space[8] }} />
        ) : (
          <EmptyState
            title="Not available"
            body={error?.message ?? "This store doesn't offer this admin type any more."}
          />
        )}
      </Screen>
    );

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: type.label,
          headerRight: type.create
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`New in ${type.label}`}
                  onPress={() =>
                    router.push({ pathname: '/more/admin/[key]/new', params: { key: type.key } })
                  }
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
        keyboardShouldPersistTaps="handled"
        data={items}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={
          <View>
            {type.searchable ? (
              <View style={{ paddingHorizontal: layout.gutter, paddingTop: space[2] }}>
                <TextField
                  label={`Search ${type.label.toLowerCase()}`}
                  value={search}
                  onChangeText={setSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  returnKeyType="search"
                />
              </View>
            ) : null}
            {filters.map((f, i) => (
              <View key={f.name} accessibilityLabel={`Filter by ${f.label}`}>
                <FilterChips
                  options={[
                    [ALL, filters.length > 1 ? `Any ${f.label.toLowerCase()}` : 'All'] as const,
                    ...f.options.map((o) => [String(o.value), o.label] as const),
                  ]}
                  value={chosen[f.name] ?? ALL}
                  onChange={(k) => setChosen((c) => ({ ...c, [f.name]: k }))}
                  count={i === filters.length - 1 ? list.data?.pages[0]?.totalCount : undefined}
                />
              </View>
            ))}
            {!filters.length && list.data?.pages[0]?.totalCount !== undefined ? (
              <Text
                size="footnote"
                tone="muted"
                style={{ paddingHorizontal: layout.gutter, paddingVertical: space[2] }}
              >
                {list.data.pages[0].totalCount} {list.data.pages[0].totalCount === 1 ? 'record' : 'records'}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => (
          <ListRow
            first={index === 0}
            title={item.title}
            subtitle={item.subtitle}
            detail={listDetail(type, item)}
            onPress={() =>
              router.push({ pathname: '/more/admin/[key]/[id]', params: { key: type.key, id: item.id } })
            }
          />
        )}
        ListEmptyComponent={
          list.isPending ? (
            <ActivityIndicator style={{ marginTop: space[8] }} />
          ) : list.error ? (
            <EmptyState title={`Couldn't load ${type.label.toLowerCase()}`} body={list.error.message} />
          ) : (
            <EmptyState
              title={narrowed ? 'No matches' : 'Nothing here yet'}
              body={
                narrowed
                  ? 'Try another search or filter.'
                  : type.create
                    ? 'Tap New to add the first one.'
                    : 'Records added in the store appear here.'
              }
            />
          )
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator style={{ margin: space[4] }} />
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
