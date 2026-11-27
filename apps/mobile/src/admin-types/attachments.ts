import { formatBytes } from '@instincts/spree-domain';
import { useMutation } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Alert, Linking } from 'react-native';
import { pickPhoto } from '@/media/pick';
import { useTRPC } from '@/trpc/trpc';
import type { AttachmentDraft } from './values';

/** The gem refuses uploads above this (413); checked before uploading when the picker knows the size. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** A file on the device, ready to upload. */
export interface PickedFile {
  uri: string;
  name: string;
  type: string;
  size: number | null;
}

export type FilePick =
  | { status: 'picked'; file: PickedFile }
  | { status: 'canceled' }
  | { status: 'denied'; canAskAgain: boolean };

/** Chooses a photo from the library, resized and saved as JPEG as product photos are. */
export async function pickImageFile(): Promise<FilePick> {
  const result = await pickPhoto('library');
  if (result.status !== 'picked') return result;
  return { status: 'picked', file: { ...result.photo, size: null } };
}

/** Chooses any file through the system document picker. */
export async function pickDocumentFile(): Promise<FilePick> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { status: 'canceled' };
  return {
    status: 'picked',
    file: {
      uri: asset.uri,
      name: asset.name || 'file',
      type: asset.mimeType || 'application/octet-stream',
      size: typeof asset.size === 'number' ? asset.size : null,
    },
  };
}

/**
 * Picking and uploading for an image or file field. `choose` resolves to the new attachment
 * (with the blob's `signedId`, and the local file to show a photo straight away), or null when
 * nothing was attached; failures are explained in an alert.
 */
export function useAttachmentUpload(label: string) {
  const trpc = useTRPC();
  const upload = useMutation(trpc.resources.upload.mutationOptions());
  const [picking, setPicking] = useState(false);

  const choose = async (kind: 'image' | 'file'): Promise<AttachmentDraft | null> => {
    setPicking(true);
    try {
      const picked = await (kind === 'image' ? pickImageFile() : pickDocumentFile());
      if (picked.status === 'denied') {
        explainDenied(picked.canAskAgain);
        return null;
      }
      if (picked.status !== 'picked') return null;
      const { file } = picked;
      if (file.size !== null && file.size > MAX_UPLOAD_BYTES) {
        Alert.alert(
          'This file is too big',
          `${file.name} is ${formatBytes(file.size)}. The store takes files up to ${formatBytes(MAX_UPLOAD_BYTES)}.`,
        );
        return null;
      }
      const blob = await upload.mutateAsync({ file: { uri: file.uri, name: file.name, type: file.type } });
      return {
        // A fresh photo shows from the device; a file opens from the store.
        url: kind === 'image' ? file.uri : blob.url,
        filename: blob.filename || file.name,
        contentType: blob.contentType ?? file.type,
        byteSize: blob.byteSize ?? file.size,
        signedId: blob.signedId,
      };
    } catch (e) {
      Alert.alert(`Couldn't upload ${label.toLowerCase()}`, e instanceof Error ? e.message : 'Try again.');
      return null;
    } finally {
      setPicking(false);
    }
  };
  return { choose, busy: picking || upload.isPending };
}

function explainDenied(canAskAgain: boolean) {
  Alert.alert(
    'No access to your photos',
    canAskAgain
      ? 'Allow access to your photos to choose one.'
      : 'Allow access to your photos in Settings to choose one.',
    canAskAgain
      ? [{ text: 'OK' }]
      : [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
        ],
  );
}

/** "terms.pdf · 47 KB". */
export function fileSummary(draft: Pick<AttachmentDraft, 'filename' | 'byteSize'>): string {
  const size = formatBytes(draft.byteSize);
  return [draft.filename ?? 'File', size].filter(Boolean).join(' · ');
}
