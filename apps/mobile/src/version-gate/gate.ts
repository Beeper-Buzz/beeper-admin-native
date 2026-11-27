import { coerceVersion, isBelow } from '@instincts/spree-domain';
import type { AppVersionInfo } from '@instincts/spree-sdk';
import type { distribution } from '@/distribution';

type StoreUrls = (typeof distribution)['storeUrls'];

export type GateState =
  | { status: 'none' }
  | { status: 'required'; installed: string | null; minimum: string; updateUrl: string | null }
  | {
      status: 'recommended';
      storeId: string;
      installed: string | null;
      recommended: string;
      updateUrl: string | null;
    };

/**
 * Below `target`? The app compares versions itself when it can read both (so an older gem
 * without the booleans still works, and prerelease tags are ignored the same way everywhere),
 * and otherwise takes the store's word, which is false unless the store could compare.
 */
function below(installed: string | null, target: string | null, storeSays: boolean): boolean {
  if (!target) return false;
  if (coerceVersion(installed) && coerceVersion(target)) return isBelow(installed, target);
  return storeSays;
}

/** What to show for the store's answer. Required wins over recommended. */
export function evaluateGate(
  storeId: string,
  info: AppVersionInfo,
  installed: string | null,
  fallbackUrl: string | null,
): GateState {
  const updateUrl = info.updateUrl ?? fallbackUrl;
  if (info.minimumVersion && below(installed, info.minimumVersion, info.updateRequired)) {
    return { status: 'required', installed, minimum: info.minimumVersion, updateUrl };
  }
  if (info.recommendedVersion && below(installed, info.recommendedVersion, info.updateRecommended)) {
    return { status: 'recommended', storeId, installed, recommended: info.recommendedVersion, updateUrl };
  }
  return { status: 'none' };
}

/** The distribution's own listing for this platform, used when the store sends no link. */
export function fallbackStoreUrl(storeUrls: StoreUrls, platform: string): string | null {
  if (platform === 'ios') return storeUrls?.ios || null;
  if (platform === 'android') return storeUrls?.android || null;
  return null;
}

/**
 * A tab's first screen (`/`, `/orders`, `/more`…): nothing pushed and no form sheet open, so the
 * Update available prompt can't land on top of a half-filled form.
 */
export function isTabRoot(pathname: string | null | undefined): boolean {
  return !!pathname && /^\/[^/]*$/.test(pathname);
}
