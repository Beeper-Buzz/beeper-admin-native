import type { Session } from '@instincts/spree-api';
import type { LibraryImage, Product, ProductImage } from '@instincts/spree-domain';
import { unsupportedPromotions } from '@instincts/spree-sdk';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import MediaScreen from '@/app/(tabs)/more/media';
import ProductScreen from '@/app/(tabs)/products/[id]';
import PhotoSheet from '@/app/(tabs)/products/photo';
import { AppThemeProvider } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';

const mockBack = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), push: (...a: unknown[]) => mockPush(...a) },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/session/session', () => ({ useCan: () => () => true }));

const mockPicker = {
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
};
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: () => mockPicker.requestCameraPermissionsAsync(),
  launchCameraAsync: (o: unknown) => mockPicker.launchCameraAsync(o),
  launchImageLibraryAsync: (o: unknown) => mockPicker.launchImageLibraryAsync(o),
}));
const mockManipulate = jest.fn();
const mockSave = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (uri: string, options: unknown) => {
      mockManipulate(uri, options);
      return {
        renderAsync: async () => ({ saveAsync: async (o: unknown) => mockSave(o) }),
      };
    },
  },
}));

const usd = (amount: string) => ({ amount, currency: 'USD' });
const variant = (id: string, optionsText: string | null, isMaster = false) => ({
  id,
  sku: `TEE-${id}`,
  optionsText,
  isMaster,
  price: usd('20.00'),
  compareAtPrice: null,
  totalOnHand: 5,
  imageUrl: null,
  optionValues: [],
  images: [],
  purchasable: null,
});
const tee: Product = {
  id: 'p1',
  name: 'Logo tee',
  slug: 'logo-tee',
  status: 'active',
  description: null,
  imageUrl: null,
  updatedAt: null,
  optionTypes: [{ id: 'o1', name: 'size', presentation: 'Size', position: 1 }],
  images: [],
  variants: [variant('m', null, true), variant('v1', 'Size: S'), variant('v2', 'Size: M')],
};
const photo = (id: string, position: number, alt: string | null): ProductImage => ({
  id,
  url: `https://shop.test/large/${id}.jpg`,
  thumbUrl: `https://shop.test/small/${id}.jpg`,
  alt,
  position,
  variantIds: [],
});
const front = photo('i1', 1, 'Front of the tee');
const back = photo('i2', 2, null);

function setup(gallery: ProductImage[] = [front, back]) {
  const added = photo('i3', 3, null);
  const media = {
    list: jest.fn(async () => gallery),
    upload: jest.fn(async () => [...gallery, added]),
    update: jest.fn(async () => gallery),
    move: jest.fn(async () => [...gallery].reverse()),
    remove: jest.fn(async () => gallery.slice(1)),
    library: jest.fn(async () => ({
      items: [
        { ...front, productId: 'p1', productName: 'Logo tee' },
        { ...back, productId: 'p1', productName: 'Logo tee' },
      ] satisfies LibraryImage[],
      nextCursor: null,
      totalCount: 2,
    })),
  };
  const products = {
    list: jest.fn(),
    get: jest.fn(async () => tee),
    update: jest.fn(),
    updateVariant: jest.fn(),
    setStock: jest.fn(),
  };
  const session = {
    probe: {
      baseUrl: 'https://shop.test',
      currency: 'USD',
      capabilities: ['products.read', 'products.write', 'products.media', 'media.library'],
    },
    adapter: {
      family: 'admin-v3',
      orders: {},
      products,
      customers: {},
      promotions: unsupportedPromotions,
      media,
    },
  } as unknown as Session;
  const ui = (el: React.ReactElement) =>
    render(
      <AppThemeProvider>
        <ApiProvider session={session}>{el}</ApiProvider>
      </AppThemeProvider>,
    );
  return { media, ui };
}

const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
/** Presses the Alert button with this text, as the user would. */
async function pressAlertButton(text: string) {
  const buttons = alert.mock.lastCall?.[2] ?? [];
  const button = buttons.find((b) => b.text === text);
  if (!button?.onPress) throw new Error(`no "${text}" button`);
  await act(async () => button.onPress?.());
}

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
  alert.mockClear();
  mockPicker.requestCameraPermissionsAsync.mockReset();
  mockPicker.launchCameraAsync.mockReset();
  mockPicker.launchImageLibraryAsync.mockReset();
  mockManipulate.mockClear();
  mockSave.mockReset().mockResolvedValue({ uri: 'file:///cache/resized.jpg', width: 2048, height: 1536 });
});

describe('product photos', () => {
  it('shows the gallery with the main photo and missing alt text, and opens a photo', async () => {
    mockParams = { id: 'p1' };
    const { media, ui } = setup();
    await ui(<ProductScreen />);
    const main = await screen.findByLabelText('Main photo: Front of the tee');
    expect(screen.getByLabelText('Photo 2 of 2, no alt text')).toBeTruthy();
    expect(screen.getByText('Photos (2)')).toBeTruthy();
    expect(screen.getByText('Main')).toBeTruthy();
    expect(screen.getByText('No alt')).toBeTruthy();
    expect(media.list).toHaveBeenCalledWith({ id: 'p1' });
    await fireEvent.press(main);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/products/photo', params: { id: 'p1', image: 'i1' } });
  });

  it('chooses a photo, uploads it as a resized JPEG and opens it to add alt text', async () => {
    mockParams = { id: 'p1' };
    mockPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///photos/IMG_1.HEIC', width: 4032, height: 3024 }],
    });
    const { media, ui } = setup();
    await ui(<ProductScreen />);
    await fireEvent.press(await screen.findByLabelText('Choose a product photo from your library'));
    await waitFor(() => expect(media.upload).toHaveBeenCalled());
    expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledWith({ mediaTypes: 'images', quality: 1 });
    expect(mockManipulate).toHaveBeenCalledWith('file:///photos/IMG_1.HEIC', {
      maxWidth: 2048,
      maxHeight: 2048,
    });
    expect(mockSave).toHaveBeenCalledWith({ compress: 0.8, format: 'jpeg' });
    expect(media.upload).toHaveBeenCalledWith(
      { id: 'p1' },
      {
        file: {
          uri: 'file:///cache/resized.jpg',
          name: expect.stringMatching(/^photo-\d+\.jpg$/),
          type: 'image/jpeg',
        },
      },
    );
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/products/photo',
        params: { id: 'p1', image: 'i3' },
      }),
    );
  });

  it('does nothing when the picker is cancelled', async () => {
    mockParams = { id: 'p1' };
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    const { media, ui } = setup();
    await ui(<ProductScreen />);
    await fireEvent.press(await screen.findByText('Choose photo'));
    await waitFor(() => expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalled());
    expect(media.upload).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('explains a denied camera and offers Settings when it will not ask again', async () => {
    mockParams = { id: 'p1' };
    mockPicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const { media, ui } = setup();
    await ui(<ProductScreen />);
    await fireEvent.press(await screen.findByLabelText('Take a product photo with the camera'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.lastCall?.[0]).toBe('No access to the camera');
    expect(mockPicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(media.upload).not.toHaveBeenCalled();
    await pressAlertButton('Open Settings');
    expect(openSettings).toHaveBeenCalled();
  });

  it('reports a failed upload', async () => {
    mockParams = { id: 'p1' };
    mockPicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    mockPicker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///c.jpg' }] });
    const { media, ui } = setup();
    media.upload.mockRejectedValue(new Error('Attachment is not a valid image'));
    await ui(<ProductScreen />);
    await fireEvent.press(await screen.findByText('Take photo'));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Couldn't add the photo", 'Attachment is not a valid image'),
    );
  });
});

describe('photo sheet', () => {
  it('saves alt text only when it changed', async () => {
    mockParams = { id: 'p1', image: 'i2' };
    const { media, ui } = setup();
    await ui(<PhotoSheet />);
    expect(await screen.findByText('Photo 2 of 2')).toBeTruthy();
    expect(screen.queryByText('Save alt text')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Alt text'), '  Back print  ');
    await fireEvent.press(screen.getByText('Save alt text'));
    await waitFor(() => expect(media.update).toHaveBeenCalledWith({ id: 'p1' }, 'i2', { alt: 'Back print' }));
  });

  it('moves a photo earlier and makes it the main photo; the first photo cannot move earlier', async () => {
    mockParams = { id: 'p1', image: 'i2' };
    const { media, ui } = setup();
    await ui(<PhotoSheet />);
    await fireEvent.press(await screen.findByText('Move earlier'));
    await waitFor(() => expect(media.move).toHaveBeenCalledWith({ id: 'p1' }, 'i2', 0));
    // The gallery came back reversed: i2 is now the main photo.
    expect(await screen.findByText('Main photo')).toBeTruthy();
    expect(screen.getByText('Move earlier')).toBeDisabled();
    expect(screen.getByText('Make main photo')).toBeDisabled();
    await fireEvent.press(screen.getByText('Move later'));
    await waitFor(() => expect(media.move).toHaveBeenLastCalledWith({ id: 'p1' }, 'i2', 1));
  });

  it('shows a photo for one variant', async () => {
    mockParams = { id: 'p1', image: 'i1' };
    const { media, ui } = setup();
    await ui(<PhotoSheet />);
    await fireEvent.press(await screen.findByLabelText('Shown for Size: M'));
    await waitFor(() =>
      expect(media.update).toHaveBeenCalledWith({ id: 'p1' }, 'i1', { variantIds: ['v2'] }),
    );
    expect(screen.getByLabelText('Shown for All variants')).toBeDisabled();
  });

  it('deletes only after confirmation, then closes', async () => {
    mockParams = { id: 'p1', image: 'i1' };
    const { media, ui } = setup();
    await ui(<PhotoSheet />);
    await fireEvent.press(await screen.findByText('Delete photo'));
    expect(alert.mock.lastCall?.[0]).toBe('Delete this photo?');
    expect(media.remove).not.toHaveBeenCalled();
    await pressAlertButton('Delete');
    await waitFor(() => expect(media.remove).toHaveBeenCalledWith({ id: 'p1' }, 'i1'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });
});

describe('media screen', () => {
  it('lists every product photo, searches by product and filters to missing alt text', async () => {
    const { media, ui } = setup();
    await ui(<MediaScreen />);
    expect(await screen.findByLabelText('Logo tee: Front of the tee')).toBeTruthy();
    expect(screen.getByLabelText('Logo tee, no alt text')).toBeTruthy();
    expect(media.library).toHaveBeenCalledWith({ missingAlt: false, perPage: 24, cursor: null });
    await fireEvent.changeText(screen.getByLabelText('Search by product'), 'tee');
    await waitFor(() =>
      expect(media.library).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: 'tee', missingAlt: false }),
      ),
    );
    await fireEvent.press(screen.getByText('Missing alt text'));
    await waitFor(() =>
      expect(media.library).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: 'tee', missingAlt: true }),
      ),
    );
  });

  it('opens the product a photo belongs to', async () => {
    const { ui } = setup();
    await ui(<MediaScreen />);
    await fireEvent.press(await screen.findByLabelText('Logo tee, no alt text'));
    expect(mockPush).toHaveBeenCalledWith('/products/p1');
  });

  it('says when every photo has alt text', async () => {
    const { media, ui } = setup();
    media.library.mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });
    await ui(<MediaScreen />);
    await fireEvent.press(await screen.findByText('Missing alt text'));
    expect(await screen.findByText('Every photo has alt text')).toBeTruthy();
  });
});
