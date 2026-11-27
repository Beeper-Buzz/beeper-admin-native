import type { AppVersionInfo } from '@instincts/spree-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { distribution } from '@/distribution';
import { versionGateBreadcrumb } from '@/observability/sentry';
import { useTRPCClient } from '@/trpc/trpc';
import { evaluateGate, fallbackStoreUrl, type GateState } from './gate';
import { installedVersion } from './installed-version';

/** Coming back to the foreground checks again at most this often. */
export const FOREGROUND_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export interface GateStore {
  id: string;
  capabilities: readonly string[];
}

type CheckReason = 'launch' | 'sign-in' | 'store-updated' | 'foreground';

interface Answer {
  storeId: string;
  installed: string | null;
  info: AppVersionInfo;
}

/**
 * The connected store's version gate for this app (companion gem 0.6, `app.versionGate`).
 *
 * Checks when a store is connected at launch, after sign-in, when the store gains the capability,
 * and on returning to the foreground at most every 30 minutes. Nothing waits on it: the app shows
 * at once and the gate or prompt appears when the answer comes. No capability, no call. Fails
 * open: until an answer arrives, or when the first check fails, there is no gate; a later failed
 * check keeps the last answer for that store.
 */
export function useVersionGate(store: GateStore | null): GateState {
  const client = useTRPCClient();
  const storeId = store?.id ?? null;
  const capable = !!store?.capabilities.includes('app.versionGate');
  const [answer, setAnswer] = useState<Answer | null>(null);

  const current = useRef({ storeId, capable });
  const lastCheckAt = useRef(0);
  const previousStore = useRef<string | null | undefined>(undefined);

  const check = useCallback(
    async (reason: CheckReason) => {
      const { storeId: id, capable: can } = current.current;
      if (!id || !can) return;
      lastCheckAt.current = Date.now();
      const installed = installedVersion();
      const info = await client.app.version
        .query({ platform: Platform.OS, version: installed })
        .catch(() => null);
      // A different store by now: this answer isn't its.
      if (current.current.storeId !== id) return;
      if (!info) {
        versionGateBreadcrumb('Version check failed; the gate stays open', { reason, installed });
        return;
      }
      versionGateBreadcrumb('Version checked', {
        reason,
        installed,
        minimum: info.minimumVersion,
        recommended: info.recommendedVersion,
      });
      setAnswer({ storeId: id, installed, info });
    },
    [client],
  );

  // Declared first so the checks below read this render's store.
  useEffect(() => {
    current.current = { storeId, capable };
  }, [storeId, capable]);

  useEffect(() => {
    const previous = previousStore.current;
    previousStore.current = storeId;
    if (!storeId || !capable) return;
    void check(previous === undefined ? 'launch' : previous === storeId ? 'store-updated' : 'sign-in');
  }, [storeId, capable, check]);

  useEffect(() => {
    let last: string | null | undefined = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const returning = next === 'active' && last !== 'active';
      last = next;
      if (returning && Date.now() - lastCheckAt.current >= FOREGROUND_CHECK_INTERVAL_MS) {
        void check('foreground');
      }
    });
    return () => sub.remove();
  }, [check]);

  if (!answer || !storeId || !capable || answer.storeId !== storeId) return { status: 'none' };
  return evaluateGate(
    storeId,
    answer.info,
    answer.installed,
    fallbackStoreUrl(distribution.storeUrls, Platform.OS),
  );
}
