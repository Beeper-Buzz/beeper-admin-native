import * as SecureStore from 'expo-secure-store';

/** The draft order the merchant is working on, per connected store. The draft itself lives on the store. */
export interface DraftRef {
  id: string;
  number: string;
}

const keyFor = (storeId: string) => `orders.draft.${storeId}`;

export async function loadActiveDraft(storeId: string): Promise<DraftRef | null> {
  try {
    const raw = await SecureStore.getItemAsync(keyFor(storeId));
    const ref = raw ? (JSON.parse(raw) as Partial<DraftRef>) : null;
    return ref?.id && ref.number ? { id: ref.id, number: ref.number } : null;
  } catch {
    return null;
  }
}

export async function rememberDraft(storeId: string, ref: DraftRef): Promise<void> {
  await SecureStore.setItemAsync(keyFor(storeId), JSON.stringify({ id: ref.id, number: ref.number }));
}

export async function forgetDraft(storeId: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(storeId));
}
