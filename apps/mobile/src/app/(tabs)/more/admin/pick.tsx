import { layout, space } from '@instincts/spree-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { forgetPick, resolvePick } from '@/admin-types/picker';
import { useAdminType } from '@/admin-types/use-admin-types';
import { ListRow } from '@/components/list-row';
import { EmptyState, Sheet, TextField } from '@/components/primitives';
import { Text } from '@/components/text';
import { useDebounced } from '@/components/use-debounced';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

/** Form sheet listing a reference field's target type, with search; picking returns to the form. */
export default function ReferencePickerSheet() {
  const { resource, label, request, selected, optional } = useLocalSearchParams<{
    resource: string;
    label: string;
    request: string;
    selected?: string;
    optional?: string;
  }>();
  const trpc = useTRPC();
  const { colors } = useTheme();
  const { type } = useAdminType(resource);
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const list = useInfiniteQuery({
    ...trpc.resources.list.infiniteQueryOptions(
      { key: resource, perPage: 25, ...(query && type?.searchable ? { query } : {}) },
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
    enabled: !!type,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  // Closing the sheet without a pick leaves the field as it was.
  useEffect(() => () => forgetPick(request), [request]);

  const pick = (choice: { id: string; title: string } | null) => {
    resolvePick(request, choice);
    router.back();
  };
  const check = (id: string) =>
    id === selected ? (
      <Text accessibilityLabel="Selected" style={{ color: colors.accentInk }}>
        ✓
      </Text>
    ) : null;

  return (
    <Sheet fill>
      <Text size="title3" font="uiSemibold" accessibilityRole="header">
        Choose {label?.toLowerCase() || type?.label.toLowerCase()}
      </Text>
      {type?.searchable ? (
        <TextField
          label={`Search ${type.label.toLowerCase()}`}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      ) : null}
      <FlatList
        style={{ flex: 1, marginHorizontal: -layout.gutter }}
        keyboardShouldPersistTaps="handled"
        data={items}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={
          optional ? (
            <ListRow first title="None" onPress={() => pick(null)} trailing={check('')} />
          ) : undefined
        }
        renderItem={({ item, index }) => (
          <ListRow
            first={!optional && index === 0}
            title={item.title}
            subtitle={item.subtitle}
            onPress={() => pick({ id: item.id, title: item.title })}
            trailing={check(item.id)}
          />
        )}
        ListEmptyComponent={
          list.isPending ? (
            <ActivityIndicator style={{ margin: space[4] }} />
          ) : (
            <EmptyState
              title={list.error ? "Couldn't load them" : 'No matches'}
              body={
                list.error?.message ?? (query ? 'Try another search.' : 'There is nothing to choose yet.')
              }
            />
          )
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          list.isFetchingNextPage ? <ActivityIndicator style={{ margin: space[3] }} /> : <View />
        }
      />
    </Sheet>
  );
}
