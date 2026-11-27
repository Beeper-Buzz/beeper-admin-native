import type { Session } from '@instincts/spree-api';
import {
  createAdapter,
  createTransport,
  probeStore,
  restoreAuth,
  type StoredCredential,
  type StoreProbe,
} from '@instincts/spree-sdk';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadActiveStore, loadStore, removeStore, type StoredStore, saveStore, storeIdFor } from './storage';

type SessionState =
  | { status: 'loading'; session: null; store: null }
  | { status: 'signedOut'; session: null; store: null }
  | { status: 'ready'; session: Session; store: StoredStore };

interface SessionApi {
  state: SessionState;
  connect(probe: StoreProbe, credential: StoredCredential): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionApi | null>(null);

/** Build the router's Session (probe + adapter) from what the keychain holds. */
export function buildSession(store: StoredStore, onRotate: (c: StoredCredential) => void): Session {
  const transport = createTransport({ baseUrl: store.probe.baseUrl });
  const auth = restoreAuth(transport, store.credential, { onChange: onRotate });
  return {
    probe: store.probe,
    adapter: createAdapter(store.probe.preferredApi, transport.withAuth(auth), {
      companion: store.probe.gem !== null,
    }),
  };
}

/**
 * A fresh probe to adopt, or null to keep the stored one. Features follow the store (a gem
 * install or upgrade lights up refunds, push, summaries) without reconnecting. A store that
 * moved to another API family needs a new sign-in, so that change isn't adopted here.
 */
export function refreshedProbe(stored: StoreProbe, fresh: StoreProbe): StoreProbe | null {
  if (fresh.preferredApi !== stored.preferredApi) return null;
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const changed =
    !same(stored.capabilities, fresh.capabilities) ||
    !same(stored.authMethods, fresh.authMethods) ||
    stored.gem?.version !== fresh.gem?.version ||
    stored.spreeVersion !== fresh.spreeVersion ||
    stored.storeName !== fresh.storeName ||
    stored.currency !== fresh.currency;
  return changed ? { ...fresh, baseUrl: stored.baseUrl } : null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading', session: null, store: null });

  const activate = useCallback((store: StoredStore) => {
    const session = buildSession(store, (credential) => {
      void saveStore({ ...store, credential }, { activate: false });
    });
    setState({ status: 'ready', session, store });
  }, []);

  useEffect(() => {
    loadActiveStore()
      .then((store) => {
        if (!store) return setState({ status: 'signedOut', session: null, store: null });
        activate(store);
        // Re-check what the store supports in the background; offline or slow stores keep the stored probe.
        probeStore({ baseUrl: store.probe.baseUrl, timeoutMs: 10_000 })
          .then(async (fresh) => {
            const probe = refreshedProbe(store.probe, fresh);
            if (!probe) return;
            // The credential may have rotated meanwhile (JWT refresh); keep the newest one.
            const latest = (await loadStore(store.id)) ?? store;
            const updated = { ...latest, probe };
            await saveStore(updated, { activate: false });
            activate(updated);
          })
          .catch(() => {});
      })
      .catch(() => setState({ status: 'signedOut', session: null, store: null }));
  }, [activate]);

  const api = useMemo<SessionApi>(
    () => ({
      state,
      async connect(probe, credential) {
        const store: StoredStore = { id: storeIdFor(probe.baseUrl), probe, credential };
        await saveStore(store);
        activate(store);
      },
      async signOut() {
        if (state.store) await removeStore(state.store.id);
        setState({ status: 'signedOut', session: null, store: null });
      },
    }),
    [state, activate],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}

/** Whether the connected store supports a capability (`orders.refund`, `promotions.write`…). */
export function useCan(): (capability: string) => boolean {
  const { state } = useSession();
  const capabilities = state.store?.probe.capabilities;
  return (capability: string) => !!capabilities?.includes(capability as never);
}
