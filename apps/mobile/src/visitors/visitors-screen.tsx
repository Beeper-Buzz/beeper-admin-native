import { layout, space } from '@instincts/spree-ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { FilterChips } from '@/components/filter-chips';
import { EmptyState, Screen } from '@/components/primitives';
import { Text } from '@/components/text';
import { useCan } from '@/session/session';
import { CartRow, VisitorRow } from './rows';
import { CART_FILTERS, type CartFilter, useCarts, useLiveVisitors, useMessageVisitor } from './use-visitors';

type Segment = 'live' | 'carts';

/**
 * Visitors and carts: Live (online sessions, refreshed every 15 s, with Message) and Carts (active
 * and abandoned, each opening its order). Each segment shows only with its capability.
 */
export function VisitorsScreen() {
  const can = useCan();
  const hasVisitors = can('visitors');
  const hasCarts = can('carts');
  const hasInbox = can('inbox');
  const segments: (readonly [Segment, string])[] = [
    ...(hasVisitors ? [['live', 'Live'] as const] : []),
    ...(hasCarts ? [['carts', 'Carts'] as const] : []),
  ];
  const [segment, setSegment] = useState<Segment>(hasVisitors ? 'live' : 'carts');
  const [cartFilter, setCartFilter] = useState<CartFilter>('active');
  const live = useLiveVisitors(hasVisitors && segment === 'live');
  const carts = useCarts(cartFilter, hasCarts && segment === 'carts');
  const message = useMessageVisitor();

  if (!segments.length)
    return (
      <Screen>
        <EmptyState title="Not available" body="This store doesn't track visitors or list carts." />
      </Screen>
    );

  const header = (
    <View>
      {segments.length > 1 ? <FilterChips options={segments} value={segment} onChange={setSegment} /> : null}
      {segment === 'carts' ? (
        <FilterChips
          options={CART_FILTERS}
          value={cartFilter}
          onChange={setCartFilter}
          count={carts.data?.pages[0]?.totalCount}
        />
      ) : (
        <Text
          size="footnote"
          tone="muted"
          style={{ paddingHorizontal: layout.gutter, paddingBottom: space[2] }}
        >
          {live.data ? `${live.data.pages[0]?.totalCount ?? live.items.length} online now` : ' '}
        </Text>
      )}
    </View>
  );
  const footer = (fetching: boolean) =>
    fetching ? <ActivityIndicator style={{ margin: space[4] }} /> : <View style={{ height: space[8] }} />;

  if (segment === 'live')
    return (
      <Screen>
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          data={live.items}
          keyExtractor={(s) => s.id}
          ListHeaderComponent={header}
          renderItem={({ item, index }) => (
            <VisitorRow
              session={item}
              first={index === 0}
              onPress={() => router.push({ pathname: '/more/visitors/[id]', params: { id: item.id } })}
              onMessage={
                hasInbox
                  ? () =>
                      item.conversationId
                        ? router.push({ pathname: '/inbox/[id]', params: { id: item.conversationId } })
                        : message.mutate({ id: item.id })
                  : undefined
              }
              messaging={message.isPending && message.variables?.id === item.id}
            />
          )}
          ListEmptyComponent={
            live.isPending ? (
              <ActivityIndicator accessibilityLabel="Loading visitors" style={{ marginTop: space[8] }} />
            ) : live.error ? (
              <EmptyState title="Couldn't load visitors" body={live.error.message} />
            ) : (
              <EmptyState
                title="Nobody on the store right now"
                body="People browsing appear here within a minute."
              />
            )
          }
          onEndReached={() => live.hasNextPage && !live.isFetchingNextPage && live.fetchNextPage()}
          ListFooterComponent={footer(live.isFetchingNextPage)}
          refreshControl={
            <RefreshControl refreshing={live.isRefetching} onRefresh={() => void live.refetch()} />
          }
        />
      </Screen>
    );

  return (
    <Screen>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={carts.items}
        keyExtractor={(c) => c.number}
        ListHeaderComponent={header}
        renderItem={({ item, index }) => (
          <CartRow
            cart={item}
            first={index === 0}
            onPress={() => router.push({ pathname: '/orders/[id]', params: { id: item.number } })}
          />
        )}
        ListEmptyComponent={
          carts.isPending ? (
            <ActivityIndicator accessibilityLabel="Loading carts" style={{ marginTop: space[8] }} />
          ) : carts.error ? (
            <EmptyState title="Couldn't load carts" body={carts.error.message} />
          ) : (
            <EmptyState
              title={cartFilter === 'abandoned' ? 'No abandoned carts' : 'No carts'}
              body={
                cartFilter === 'abandoned'
                  ? 'Carts with an email left for an hour or more appear here.'
                  : 'Carts shoppers are filling appear here.'
              }
            />
          )
        }
        onEndReached={() => carts.hasNextPage && !carts.isFetchingNextPage && carts.fetchNextPage()}
        ListFooterComponent={footer(carts.isFetchingNextPage)}
        refreshControl={
          <RefreshControl refreshing={carts.isRefetching} onRefresh={() => void carts.refetch()} />
        }
      />
    </Screen>
  );
}
