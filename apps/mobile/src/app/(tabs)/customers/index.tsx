import { displayName } from '@instincts/spree-domain';
import { space } from '@instincts/spree-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { ListRow } from '@/components/list-row';
import { EmptyState, MoneyText, Screen, TextField } from '@/components/primitives';
import { Text } from '@/components/text';
import { useDebounced } from '@/components/use-debounced';
import { useTRPC } from '@/trpc/trpc';

export default function CustomersScreen() {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const list = useInfiniteQuery(
    trpc.customers.list.infiniteQueryOptions(
      { perPage: 25, ...(query ? { query } : {}) },
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
        keyExtractor={(c) => c.id}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 16, paddingVertical: space[2] }}>
            <TextField
              label="Search customers"
              value={search}
              onChangeText={setSearch}
              placeholder="Email or name"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
          </View>
        }
        renderItem={({ item, index }) => {
          const name = displayName(item);
          return (
            <ListRow
              first={index === 0}
              title={name}
              subtitle={name === item.email ? null : item.email}
              onPress={() => router.push(`/customers/${item.id}`)}
              trailing={
                item.totalSpent ? (
                  <MoneyText value={item.totalSpent} />
                ) : item.ordersCount !== null ? (
                  <Text size="footnote" tone="muted">
                    {item.ordersCount} {item.ordersCount === 1 ? 'order' : 'orders'}
                  </Text>
                ) : null
              }
            />
          );
        }}
        ListEmptyComponent={
          list.isPending ? (
            <ActivityIndicator style={{ marginTop: space[8] }} />
          ) : list.error ? (
            <EmptyState title="Couldn't load customers" body={list.error.message} />
          ) : (
            <EmptyState
              title={query ? 'No matches' : 'No customers yet'}
              body={query ? `Nobody matches “${query}”.` : 'People who sign up or order appear here.'}
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
