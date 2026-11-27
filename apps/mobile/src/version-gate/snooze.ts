import * as SecureStore from 'expo-secure-store';

/** "Not now" on the Update available prompt: quiet for a day, per store and per recommended version. */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;

export interface Snooze {
  version: string;
  until: number;
}

/** Store ids are already SecureStore-safe ([A-Za-z0-9._-], see session/storage.ts). */
const keyFor = (storeId: string) => `versionGate.snooze.${storeId}`;

export async function loadSnooze(storeId: string): Promise<Snooze | null> {
  try {
    const raw = await SecureStore.getItemAsync(keyFor(storeId));
    const value = raw ? (JSON.parse(raw) as Partial<Snooze>) : null;
    return typeof value?.version === 'string' && typeof value.until === 'number'
      ? { version: value.version, until: value.until }
      : null;
  } catch {
    return null;
  }
}

export async function snooze(storeId: string, version: string, now = Date.now()): Promise<void> {
  try {
    await SecureStore.setItemAsync(keyFor(storeId), JSON.stringify({ version, until: now + SNOOZE_MS }));
  } catch {
    // Not worth an error: the prompt comes back next session at worst.
  }
}

/** A newer recommended version isn't covered by an older one's snooze. */
export function isSnoozed(s: Snooze | null, version: string, now = Date.now()): boolean {
  return !!s && s.version === version && now < s.until;
}

/** Prompts shown this app session, as `storeId@version`, so each shows at most once per session. */
const promptedThisSession = new Set<string>();

export const promptKey = (storeId: string, version: string) => `${storeId}@${version}`;
export const wasPrompted = (key: string) => promptedThisSession.has(key);
export const markPrompted = (key: string) => void promptedThisSession.add(key);
/** Tests only. */
export const resetPromptedForTests = () => promptedThisSession.clear();
