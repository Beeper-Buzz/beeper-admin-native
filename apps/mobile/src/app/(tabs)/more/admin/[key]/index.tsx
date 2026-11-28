import { layout, space } from '@instincts/spree-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { type FilterChoice, type FilterChoices, filterValues } from '@/admin-types/filters';
import { ListFilters } from '@/admin-types/list-filters';
import { TreeScreen } from '@/admin-types/tree/tree-screen';
import { treeView } from '@/admin-types/tree/tree-type';
import { useAdminType } from '@/admin-types/use-admin-types';
import { listDetail } from '@/admin-types/values';
import { ListRow } from '@/components/list-row';
import { EmptyState, Screen, TextField } from '@/components/primitives';
import { Text } from '@/components/text';
import { useDebounced } from '@/components/use-debounced';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

/** Records of one host-described admin type: search, filters, infinite list. */
export default function AdminTypeListScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const trpc = useTRPC();
  const { colors } = useTheme();
  const { type, types, isPending, error } = useAdminType(key);
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const [chosen, setChosen] = useState<FilterChoices>({});
  const values = type ? filterValues(type.filters, chosen, types ?? []) : {};
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
    // A tree view (gem 0.7, the menu builder) loads its own tree instead.
    enabled: !!type && !treeView(type),
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

  if (treeView(type))
    return (
      <Screen>
        <TreeScreen type={type} types={types ?? []} />
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
            <ListFilters
              type={type}
              types={types ?? []}
              choices={chosen}
              onChange={(name: string, choice: FilterChoice) => setChosen((c) => ({ ...c, [name]: choice }))}
              count={list.data?.pages[0]?.totalCount}
            />
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
