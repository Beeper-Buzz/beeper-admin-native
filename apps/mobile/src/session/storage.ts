import type { StoredCredential, StoreProbe } from '@instincts/spree-sdk';
import * as SecureStore from 'expo-secure-store';

/** One connected store, as kept in the device keychain. */
export interface StoredStore {
  id: string;
  probe: StoreProbe;
  credential: StoredCredential;
}

const INDEX_KEY = 'stores.index';
const ACTIVE_KEY = 'stores.active';

/** SecureStore keys allow only [A-Za-z0-9._-]. */
export function storeIdFor(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9._-]/g, '_');
}

const keyFor = (id: string) => `store.${id}`;
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(key, OPTIONS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function listStoreIds(): Promise<string[]> {
  return (await readJson<string[]>(INDEX_KEY)) ?? [];
}

export async function loadStore(id: string): Promise<StoredStore | null> {
  return readJson<StoredStore>(keyFor(id));
}

export async function loadActiveStore(): Promise<StoredStore | null> {
  const id = await SecureStore.getItemAsync(ACTIVE_KEY, OPTIONS);
  return id ? loadStore(id) : null;
}

export async function saveStore(store: StoredStore, { activate = true } = {}): Promise<void> {
  await SecureStore.setItemAsync(keyFor(store.id), JSON.stringify(store), OPTIONS);
  const ids = await listStoreIds();
  if (!ids.includes(store.id))
    await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify([...ids, store.id]), OPTIONS);
  if (activate) await SecureStore.setItemAsync(ACTIVE_KEY, store.id, OPTIONS);
}

export async function removeStore(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(id), OPTIONS);
  const ids = (await listStoreIds()).filter((x) => x !== id);
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(ids), OPTIONS);
  if ((await SecureStore.getItemAsync(ACTIVE_KEY, OPTIONS)) === id)
    await SecureStore.deleteItemAsync(ACTIVE_KEY, OPTIONS);
}
