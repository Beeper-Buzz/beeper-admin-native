import { describe, expect, it } from 'vitest';
import { LibraryImage, missingAlt, ProductImage } from './media';

describe('media', () => {
  it('defaults variantIds to every variant (empty)', () => {
    const image = ProductImage.parse({ id: '1', url: 'u', thumbUrl: null, alt: null, position: 1 });
    expect(image.variantIds).toEqual([]);
    expect(LibraryImage.parse({ ...image, productId: 'p1', productName: null }).productId).toBe('p1');
  });

  it('treats empty and whitespace alt text as missing', () => {
    expect(missingAlt({ alt: null })).toBe(true);
    expect(missingAlt({ alt: '  ' })).toBe(true);
    expect(missingAlt({ alt: 'Front' })).toBe(false);
  });
});
