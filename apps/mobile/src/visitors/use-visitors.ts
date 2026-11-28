import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { router, useIsFocused } from 'expo-router';
import { Alert } from 'react-native';
import { useAppActive } from '@/components/use-poll';
import { useCan } from '@/session/session';
import { useTRPC } from '@/trpc/trpc';

/** Spec §6.3: the Live segment refreshes every 15 s (paused in the background). */
export const LIVE_POLL_MS = 15_000;

export type CartFilter = 'active' | 'abandoned' | 'all';
export const CART_FILTERS: readonly (readonly [CartFilter, string])[] = [
  ['active', 'Active'],
  ['abandoned', 'Abandoned'],
  ['all', 'All'],
];
/** "Active" carts: changed within the last hour (the gem's `active_cart_minutes`). */
export const ACTIVE_MINUTES = 60;

/** The carts query for a filter chip: `abandoned` uses the gem's own verdict. */
export function cartParams(filter: CartFilter) {
  if (filter === 'active') return { activeWithin: ACTIVE_MINUTES };
  if (filter === 'abandoned') return { abandoned: true };
  return {};
}

/** Online sessions, refreshed every 15 s while the screen is in front and the app open. */
export function useLiveVisitors(enabled: boolean) {
  const trpc = useTRPC();
  const focused = useIsFocused();
  const active = useAppActive();
  const query = useInfiniteQuery({
    ...trpc.visitors.list.infiniteQueryOptions(
      { online: true, perPage: 50 },
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
    enabled,
    refetchInterval: enabled && focused && active ? LIVE_POLL_MS : false,
  });
  return { ...query, items: query.data?.pages.flatMap((p) => p.items) ?? [] };
}

export function useCarts(filter: CartFilter, enabled: boolean) {
  const trpc = useTRPC();
  const query = useInfiniteQuery({
    ...trpc.carts.list.infiniteQueryOptions(
      { ...cartParams(filter), perPage: 25 },
      { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ),
    enabled,
  });
  return { ...query, items: query.data?.pages.flatMap((p) => p.items) ?? [] };
}

/**
 * "N online · M carts" for the Home card: the summary's counts (gem 0.7) when it has them, else
 * the totals of one-row lists. null for a part the store can't count.
 */
export function useVisitorCounts() {
  const trpc = useTRPC();
  const can = useCan();
  const hasVisitors = can('visitors');
  const hasCarts = can('carts');
  const summaryEnabled = can('analytics.summary') && (hasVisitors || hasCarts);
  const summary = useQuery({ ...trpc.dashboard.summary.queryOptions(), enabled: summaryEnabled });
  // Fall back to list totals only once the summary has answered without the count.
  const settled = !summaryEnabled || summary.isSuccess || summary.isError;
  const fromSummary = summary.data;
  const online = useQuery({
    ...trpc.visitors.list.queryOptions({ online: true, perPage: 1 }),
    enabled: hasVisitors && settled && (fromSummary?.visitorsOnline ?? null) === null,
  });
  const carts = useQuery({
    ...trpc.carts.list.queryOptions({ activeWithin: ACTIVE_MINUTES, perPage: 1 }),
    enabled: hasCarts && settled && (fromSummary?.activeCarts ?? null) === null,
  });
  return {
    shown: hasVisitors || hasCarts,
    online: hasVisitors ? (fromSummary?.visitorsOnline ?? online.data?.totalCount ?? null) : null,
    carts: hasCarts ? (fromSummary?.activeCarts ?? carts.data?.totalCount ?? null) : null,
  };
}

/** Message a visitor: starts (or finds) the conversation, then opens it in the Inbox. */
export function useMessageVisitor() {
  const trpc = useTRPC();
  return useMutation(
    trpc.visitors.startConversation.mutationOptions({
      onSuccess: ({ conversationId }) =>
        router.push({ pathname: '/inbox/[id]', params: { id: conversationId } }),
      onError: (e) => Alert.alert("Couldn't start a conversation", e.message),
    }),
  );
}
