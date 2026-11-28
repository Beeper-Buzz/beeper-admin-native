import type { Conversation, ConversationDetail, Message } from '@instincts/spree-domain';
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useAppActive, usePoll } from '@/components/use-poll';
import { useCan } from '@/session/session';
import { useTRPC, useTRPCClient } from '@/trpc/trpc';
import { filterParams, type InboxFilter, mergeConversations, mergeMessages, pollSince } from './inbox-state';

/** Spec §6.2: an open conversation polls every 5 s, the list every 20 s; both pause in the background. */
export const CONVERSATION_POLL_MS = 5_000;
export const LIST_POLL_MS = 20_000;
/** The tab badge refreshes this often while the app is open. */
export const SUMMARY_POLL_MS = 60_000;
const PAGE = 50;

type Page = { items: Conversation[]; nextCursor: string | null; totalCount?: number };

/** `{ open, unassigned, unread }` for the tab badge; nothing without `inbox`. */
export function useInboxSummary() {
  const trpc = useTRPC();
  const enabled = useCan()('inbox');
  const active = useAppActive();
  return useQuery({
    ...trpc.inbox.summary.queryOptions(),
    enabled,
    refetchInterval: enabled && active ? SUMMARY_POLL_MS : false,
  });
}

/**
 * The conversation list for a filter tab and search, with changes polled every 20 s through
 * `updated_since` while the screen is in front and the app in the foreground.
 */
export function useConversationList(filter: InboxFilter, query: string) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const qc = useQueryClient();
  const focused = useIsFocused();
  const input = { ...filterParams(filter), perPage: 25, ...(query ? { query } : {}) };
  const options = trpc.inbox.list.infiniteQueryOptions(input, {
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const list = useInfiniteQuery(options);
  const loadedAt = useRef(Date.now());

  usePoll(
    async () => {
      const data = qc.getQueryData<InfiniteData<Page>>(options.queryKey);
      if (!data) return;
      const loaded = data.pages.flatMap((p) => p.items);
      const changed = await client.inbox.list.query({
        ...input,
        perPage: 100,
        updatedSince: pollSince(loaded, loadedAt.current),
      });
      const fresh = changed.items.filter((c) => {
        const was = loaded.find((l) => l.id === c.id);
        return !was || was.updatedAt !== c.updatedAt || was.status !== c.status || was.unread !== c.unread;
      });
      if (!fresh.length) return;
      const pages = mergeConversations(data.pages, fresh, filter);
      qc.setQueryData<InfiniteData<Page>>(options.queryKey, {
        ...data,
        pages: data.pages.map((p, i) => ({ ...p, items: pages[i] ?? [] })),
      });
      void qc.invalidateQueries(trpc.inbox.summary.queryFilter());
    },
    LIST_POLL_MS,
    focused && list.isSuccess,
  );

  return { ...list, items: list.data?.pages.flatMap((p) => p.items) ?? [] };
}

/** One conversation with its customer context. */
export function useConversation(id: string) {
  const trpc = useTRPC();
  return useQuery(trpc.inbox.get.queryOptions({ id }));
}

/**
 * A conversation's messages, oldest first: the latest page, then new ones polled every 5 s with
 * `after` while the screen is in front (and the app in the foreground), and older ones on demand
 * with `before`. New inbound messages are marked read, which clears the badge.
 */
export function useMessages(id: string) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const qc = useQueryClient();
  const focused = useIsFocused();
  const queryKey = trpc.inbox.messages.queryKey({ id });
  const messages = useQuery({
    ...trpc.inbox.messages.queryOptions({ id }),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [olderDone, setOlderDone] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const lastRead = useRef<string | null>(null);

  const read = useMutation(
    trpc.inbox.read.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries(trpc.inbox.summary.queryFilter());
        void qc.invalidateQueries(trpc.inbox.list.pathFilter());
      },
    }),
  );
  // Marks read when the newest inbound message is unread and hasn't been marked from here yet.
  const { mutate: markRead } = read;
  useEffect(() => {
    const inbound = [...(messages.data ?? [])].reverse().find((m) => m.direction === 'inbound');
    if (!inbound || inbound.readAt || inbound.id === lastRead.current) return;
    lastRead.current = inbound.id;
    markRead({ id });
  }, [messages.data, id, markRead]);

  const add = (incoming: readonly Message[]) => {
    const now = qc.getQueryData<Message[]>(queryKey) ?? [];
    const merged = mergeMessages(now, incoming);
    qc.setQueryData(queryKey, merged);
    return merged;
  };

  usePoll(
    async () => {
      const now = qc.getQueryData<Message[]>(queryKey) ?? [];
      const last = now[now.length - 1];
      const newer = await client.inbox.messages.query(last ? { id, after: last.id } : { id });
      if (!newer.some((m) => !now.some((n) => n.id === m.id))) return;
      add(newer);
      void qc.invalidateQueries(trpc.inbox.get.queryFilter({ id }));
    },
    CONVERSATION_POLL_MS,
    focused && messages.isSuccess,
  );

  const loadOlder = async () => {
    const now = qc.getQueryData<Message[]>(queryKey) ?? [];
    const first = now[0];
    if (!first || olderDone || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const older = await client.inbox.messages.query({ id, before: first.id, limit: PAGE });
      if (older.length < PAGE) setOlderDone(true);
      add(older);
    } catch {
      // Scrolling back again retries.
    } finally {
      setLoadingOlder(false);
    }
  };

  return {
    ...messages,
    messages: messages.data ?? [],
    add,
    loadOlder,
    loadingOlder,
    hasOlder: !olderDone && (messages.data?.length ?? 0) > 0,
  };
}

/** Assign, snooze, close and reopen; the conversation, list and badge follow. */
export function useConversationUpdate(id: string) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return useMutation(
    trpc.inbox.update.mutationOptions({
      onSuccess: (conversation) => {
        qc.setQueryData<ConversationDetail>(trpc.inbox.get.queryKey({ id }), (old) =>
          old ? { ...old, ...conversation } : old,
        );
        void qc.invalidateQueries(trpc.inbox.list.pathFilter());
        void qc.invalidateQueries(trpc.inbox.summary.queryFilter());
      },
    }),
  );
}
