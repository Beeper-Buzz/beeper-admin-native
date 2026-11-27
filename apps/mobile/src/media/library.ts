import type { LibraryImage } from '@instincts/spree-domain';

export type LibraryFilter = 'all' | 'missingAlt';

export const LIBRARY_COLUMNS = 3;

/** What a screen reader says for a tile in the store-wide media grid. */
export function libraryImageLabel(image: Pick<LibraryImage, 'alt' | 'productName'>): string {
  const product = image.productName ?? 'Unknown product';
  return image.alt ? `${product}: ${image.alt}` : `${product}, no alt text`;
}

/** Title and body for an empty media grid. */
export function libraryEmpty(filter: LibraryFilter, query: string): [string, string] {
  if (query)
    return [
      'No matches',
      filter === 'missingAlt'
        ? `No photos without alt text on products matching “${query}”.`
        : `No photos on products matching “${query}”.`,
    ];
  return filter === 'missingAlt'
    ? ['Every photo has alt text', 'Photos without a description for screen readers appear here.']
    : ['No product photos yet', 'Add photos from a product to see them here.'];
}
