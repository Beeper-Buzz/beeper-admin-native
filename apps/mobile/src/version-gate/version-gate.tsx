import { usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { distribution } from '@/distribution';
import { isTabRoot } from './gate';
import { UpdateAvailablePrompt } from './update-available';
import { UpdateRequiredScreen } from './update-required';
import { type GateStore, useVersionGate } from './use-version-gate';

/**
 * The store's app version gate around the navigator (root layout, inside ApiProvider).
 *
 * Below the minimum it renders the Update required screen instead of `children`: form sheets are
 * native modals above the root view that no overlay can cover, so the navigator, and every
 * screen and sheet in it, is unmounted until the gate lifts (Switch store, or the store lowers
 * its minimum). Below the recommended version it adds the Update available prompt, which waits
 * for a tab's first screen.
 */
export function VersionGate({
  store,
  storeName,
  onSwitchStore,
  children,
}: {
  store: GateStore | null;
  storeName: string | null;
  onSwitchStore: () => void;
  children: ReactNode;
}) {
  const gate = useVersionGate(store);
  const pathname = usePathname();

  if (gate.status === 'required') {
    return (
      <UpdateRequiredScreen
        appName={distribution.name}
        storeName={storeName}
        installed={gate.installed}
        minimum={gate.minimum}
        updateUrl={gate.updateUrl}
        onSwitchStore={onSwitchStore}
      />
    );
  }
  return (
    <>
      {children}
      {gate.status === 'recommended' ? (
        <UpdateAvailablePrompt
          appName={distribution.name}
          storeId={gate.storeId}
          installed={gate.installed}
          recommended={gate.recommended}
          updateUrl={gate.updateUrl}
          canShow={isTabRoot(pathname)}
        />
      ) : null}
    </>
  );
}
