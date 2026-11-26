import type { Session } from '@instincts/spree-api';
import {
  createAdapter,
  createTransport,
  restoreAuth,
  type StoredCredential,
  type StoreProbe,
} from '@instincts/spree-sdk';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadActiveStore, removeStore, type StoredStore, saveStore, storeIdFor } from './storage';

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
      .then((store) =>
        store ? activate(store) : setState({ status: 'signedOut', session: null, store: null }),
      )
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
