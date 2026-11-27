import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export type PhotoSource = 'camera' | 'library';

/** A photo ready to upload: a local JPEG file. */
export interface PickedPhoto {
  uri: string;
  name: string;
  type: 'image/jpeg';
}

export type PickResult =
  | { status: 'picked'; photo: PickedPhoto }
  | { status: 'canceled' }
  /** `canAskAgain` false: the system won't ask again, only Settings can allow it. */
  | { status: 'denied'; canAskAgain: boolean };

/**
 * Longest side of an uploaded photo. Spree makes its own smaller renditions; this keeps uploads
 * quick on a phone connection without visibly losing detail on a product page.
 */
export const MAX_SIDE = 2048;
export const JPEG_QUALITY = 0.8;

/**
 * Resizes and re-encodes a picked image as JPEG. Spree 4.2 only accepts JPEG, PNG and GIF, so
 * HEIC photos from an iPhone camera would be refused as they are.
 */
export async function preparePhoto(uri: string, now = Date.now()): Promise<PickedPhoto> {
  const rendered = await ImageManipulator.manipulate(uri, {
    maxWidth: MAX_SIDE,
    maxHeight: MAX_SIDE,
  }).renderAsync();
  const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return { uri: saved.uri, name: `photo-${now}.jpg`, type: 'image/jpeg' };
}

/** Takes or chooses one photo, asking for camera access first when it's needed. */
export async function pickPhoto(source: PhotoSource): Promise<PickResult> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { status: 'denied', canAskAgain: permission.canAskAgain };
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 1 };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { status: 'canceled' };
  return { status: 'picked', photo: await preparePhoto(asset.uri) };
}
