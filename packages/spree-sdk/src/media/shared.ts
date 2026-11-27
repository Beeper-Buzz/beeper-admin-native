import type { ProductImage } from '@instincts/spree-domain';
import { SpreeError } from '../errors';
import type { MediaFile } from '../ports';

/** Adds a picked file to multipart form data: a React Native file reference, or bytes. */
export function appendFile(form: FormData, field: string, file: MediaFile): void {
  if ('blob' in file) {
    form.append(field, file.blob, file.name);
  } else {
    // React Native's FormData uploads `{ uri, name, type }` from disk; the DOM types don't know it.
    form.append(field, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  }
}

export function notFound(imageId: string): SpreeError {
  return new SpreeError({ kind: 'notFound', status: 404, message: `Image ${imageId} not found.` });
}

/** The image being moved and the one whose place it takes, or null when nothing would change. */
export function moveTarget(
  gallery: ProductImage[],
  imageId: string,
  toIndex: number,
): { image: ProductImage; target: ProductImage } | null {
  const from = gallery.findIndex((i) => i.id === imageId);
  const image = gallery[from];
  if (!image) throw notFound(imageId);
  const to = Math.max(0, Math.min(gallery.length - 1, Math.trunc(toIndex)));
  const target = gallery[to];
  if (to === from || !target) return null;
  return { image, target };
}

/** Trimmed alt text, with empty meaning none. */
export function cleanAlt(alt: string | null | undefined): string | null {
  return alt?.trim() || null;
}
