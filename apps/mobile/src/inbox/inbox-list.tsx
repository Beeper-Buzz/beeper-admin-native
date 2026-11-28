import { layout, space } from '@instincts/spree-ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { FilterChips } from '@/components/filter-chips';
import { EmptyState, Screen, TextField } from '@/components/primitives';
import { useDebounced } from '@/components/use-debounced';
import { ConversationRow } from './conversation-row';
import { INBOX_FILTERS, type InboxFilter } from './inbox-state';
import { useConversationList } from './use-inbox';

const EMPTY: Record<InboxFilter, [string, string]> = {
  open: ['Inbox zero', 'New conversations from your storefront chat appear here.'],
  mine: ['Nothing assigned to you', 'Assign a conversation to yourself from its customer sheet.'],
  unassigned: ['Everything has an owner', 'Conversations nobody has picked up appear here.'],
  closed: ['No closed conversations', 'Conversations you close move here.'],
};

/** The inbox: Open, Mine, Unassigned and Closed tabs, search, and the list, polled for changes. */
export function InboxList() {
  const [filter, setFilter] = useState<InboxFilter>('open');
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const list = useConversationList(filter, query);

  return (
    <Screen>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        data={list.items}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={
          <View>
            <View style={{ paddingHorizontal: layout.gutter, paddingTop: space[2] }}>
              <TextField
                label="Search conversations"
                value={search}
                onChangeText={setSearch}
                placeholder="Name, email or message"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                returnKeyType="search"
              />
            </View>
            <FilterChips
              options={INBOX_FILTERS}
              value={filter}
              onChange={setFilter}
              count={list.data?.pages[0]?.totalCount}
            />
          </View>
        }
        renderItem={({ item, index }) => (
          <ConversationRow
            conversation={item}
            first={index === 0}
            onPress={() => router.push({ pathname: '/inbox/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          list.isPending ? (
            <ActivityIndicator accessibilityLabel="Loading conversations" style={{ marginTop: space[8] }} />
          ) : list.error ? (
            <EmptyState title="Couldn't load the inbox" body={list.error.message} />
          ) : query ? (
            <EmptyState title="No matches" body={`No conversation matches “${query}”.`} />
          ) : (
            <EmptyState title={EMPTY[filter][0]} body={EMPTY[filter][1]} />
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
