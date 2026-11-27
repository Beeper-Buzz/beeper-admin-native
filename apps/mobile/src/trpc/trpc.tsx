import { type AppRouter, appRouter, type Session } from '@instincts/spree-api';
import { shouldRetry } from '@instincts/spree-sdk';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, localLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reportApiError } from '@/observability/sentry';

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

/**
 * The router runs inside the app (ADR 0002). Each call reads the current session from a ref,
 * so switching stores doesn't rebuild the client.
 */
/** True for a tRPC error whose Spree kind is `auth` (revoked device, expired or rejected key). */
export function isAuthError(error: unknown): boolean {
  return (error as { data?: { spreeKind?: string | null } } | null)?.data?.spreeKind === 'auth';
}

export function ApiProvider({
  session,
  onAuthError,
  children,
}: {
  session: Session | null;
  /** Called when a signed-in request is refused: the device was signed out or the key revoked. */
  onAuthError?: () => void;
  children: ReactNode;
}) {
  const sessionRef = useRef(session);
  const onAuthErrorRef = useRef(onAuthError);
  useEffect(() => {
    onAuthErrorRef.current = onAuthError;
  }, [onAuthError]);
  // A layout effect, so the new session is in place before any child's effects run: a child that
  // calls the client from an effect right after sign-in (the version gate) would otherwise send
  // the previous session, null, and be refused.
  useLayoutEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Only signed-in requests can fail with `auth`; sign-in mistakes surface as their own errors.
        // Server errors also go to Sentry (observability/sentry.ts decides which are defects).
        queryCache: new QueryCache({
          onError: (e) => {
            reportApiError(e);
            if (isAuthError(e) && sessionRef.current) onAuthErrorRef.current?.();
          },
        }),
        mutationCache: new MutationCache({
          onError: (e) => {
            reportApiError(e);
            if (isAuthError(e) && sessionRef.current) onAuthErrorRef.current?.();
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (count, error) => shouldRetry(count, (error as { cause?: unknown }).cause ?? error),
          },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        localLink({
          router: appRouter,
          createContext: async () => ({ session: sessionRef.current }),
        }),
      ],
    }),
  );

  // Different store, different data: drop the cache when the store changes. Never on mount:
  // child effects run first, so clearing here would orphan the queries screens just started.
  const storeUrl = session?.probe.baseUrl ?? null;
  const lastStoreUrl = useRef(storeUrl);
  useEffect(() => {
    if (lastStoreUrl.current === storeUrl) return;
    lastStoreUrl.current = storeUrl;
    // reset, not clear: wipe the old store's data and refetch what's on screen without
    // detaching mounted observers.
    void queryClient.resetQueries();
  }, [storeUrl, queryClient]);

  // Drop queries (and their GC timers) when the provider goes away.
  useEffect(() => () => queryClient.clear(), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
