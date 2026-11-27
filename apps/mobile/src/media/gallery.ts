import { type Product, type ProductImage, sellableVariants } from '@instincts/spree-domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Linking } from 'react-native';
import { useTRPC } from '@/trpc/trpc';
import type { PhotoSource, PickResult } from './pick';

/**
 * Gallery writes for one product. Each returns the gallery as it now is, which replaces the cached
 * one; the product (its main image) and the store-wide media list are refetched.
 */
export function useGalleryMutations(productId: string) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const onSuccess = (gallery: ProductImage[]) => {
    qc.setQueryData(trpc.media.list.queryKey({ product: { id: productId } }), gallery);
    void qc.invalidateQueries(trpc.products.get.queryFilter({ id: productId }));
    void qc.invalidateQueries(trpc.products.list.pathFilter());
    void qc.invalidateQueries(trpc.media.library.pathFilter());
  };
  return {
    upload: useMutation(trpc.media.upload.mutationOptions({ onSuccess })),
    update: useMutation(trpc.media.update.mutationOptions({ onSuccess })),
    move: useMutation(trpc.media.move.mutationOptions({ onSuccess })),
    remove: useMutation(trpc.media.remove.mutationOptions({ onSuccess })),
  };
}

/** The image a fresh upload added: the one id the old gallery didn't have. */
export function addedImage(before: ProductImage[], after: ProductImage[]): ProductImage | undefined {
  const known = new Set(before.map((i) => i.id));
  return after.find((i) => !known.has(i.id));
}

/** "Main photo", "Photo 3 of 5". */
export function photoLabel(index: number, count: number): string {
  return index === 0 ? 'Main photo' : `Photo ${index + 1} of ${count}`;
}

/** Explains a refused permission; offers Settings when the system won't ask again. */
export function explainDenied(source: PhotoSource, result: Extract<PickResult, { status: 'denied' }>) {
  const what = source === 'camera' ? 'the camera' : 'your photos';
  Alert.alert(
    `No access to ${what}`,
    result.canAskAgain
      ? `Allow access to ${what} to add product photos.`
      : `Allow access to ${what} in Settings to add product photos.`,
    result.canAskAgain
      ? [{ text: 'OK' }]
      : [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
        ],
  );
}

/** "All variants", then each option variant, for choosing which variants a photo shows for. */
export function variantChoices(product: Product | undefined): { id: string | null; label: string }[] {
  const variants = product ? sellableVariants(product).filter((v) => !v.isMaster) : [];
  // A product without options has one variant (Spree 6) or only a master (Spree 4): nothing to pick.
  if (variants.length === 0 || (variants.length === 1 && !product?.optionTypes.length)) return [];
  return [
    { id: null, label: 'All variants' },
    ...variants.map((v) => ({ id: v.id, label: v.optionsText || v.sku || v.id })),
  ];
}
