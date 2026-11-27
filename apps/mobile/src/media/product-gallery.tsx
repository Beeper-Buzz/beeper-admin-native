import { missingAlt, type ProductImage } from '@instincts/spree-domain';
import { radius, space } from '@instincts/spree-ui';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Badge, Button } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';
import { addedImage, explainDenied, photoLabel, useGalleryMutations } from './gallery';
import { type PhotoSource, pickPhoto } from './pick';

const COLUMNS = 3;

/** A product's photos: a grid to open each one, and Take photo / Choose photo to add more. */
export function ProductGallery({ productId }: { productId: string }) {
  const trpc = useTRPC();
  const { colors } = useTheme();
  const gallery = useQuery(trpc.media.list.queryOptions({ product: { id: productId } }));
  const { upload } = useGalleryMutations(productId);
  const [picking, setPicking] = useState(false);
  const images = gallery.data ?? [];

  const open = (image: ProductImage) =>
    router.push({ pathname: '/products/photo', params: { id: productId, image: image.id } });

  const add = async (source: PhotoSource) => {
    setPicking(true);
    try {
      const result = await pickPhoto(source);
      if (result.status === 'denied') return explainDenied(source, result);
      if (result.status !== 'picked') return;
      const before = images;
      const after = await upload.mutateAsync({ product: { id: productId }, file: result.photo });
      // Straight to the new photo, where alt text and the variant are set.
      const added = addedImage(before, after);
      if (added) open(added);
    } catch (e) {
      Alert.alert("Couldn't add the photo", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setPicking(false);
    }
  };
  const busy = picking || upload.isPending;

  return (
    <View style={{ gap: space[2] }}>
      <Label>{images.length ? `Photos (${images.length})` : 'Photos'}</Label>
      {gallery.isPending ? (
        <ActivityIndicator />
      ) : gallery.error ? (
        <Text size="footnote" tone="critical">
          {gallery.error.message}
        </Text>
      ) : images.length === 0 ? (
        <Text size="footnote" tone="muted">
          No photos yet. The first photo is the one your store shows first.
        </Text>
      ) : (
        <View style={styles.grid}>
          {images.map((image, i) => (
            <Pressable
              key={image.id}
              accessibilityRole="button"
              accessibilityLabel={`${photoLabel(i, images.length)}${image.alt ? `: ${image.alt}` : ', no alt text'}`}
              accessibilityHint="Edit alt text, order or variant, or delete"
              onPress={() => open(image)}
              style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Image
                source={{ uri: image.thumbUrl ?? image.url }}
                accessibilityIgnoresInvertColors
                style={[styles.image, { backgroundColor: colors.surface, borderColor: colors.line }]}
                contentFit="cover"
              />
              <View style={styles.badges} pointerEvents="none">
                {i === 0 ? <Badge tone="info" label="Main" /> : null}
                {missingAlt(image) ? <Badge tone="attention" label="No alt" /> : null}
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
        <Button
          title="Take photo"
          size="small"
          variant="tonal"
          disabled={busy}
          accessibilityLabel="Take a product photo with the camera"
          onPress={() => void add('camera')}
        />
        <Button
          title="Choose photo"
          size="small"
          variant="tonal"
          disabled={busy}
          accessibilityLabel="Choose a product photo from your library"
          onPress={() => void add('library')}
        />
        {busy ? <ActivityIndicator accessibilityLabel="Uploading photo" /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  tile: { width: `${100 / COLUMNS - 3}%`, aspectRatio: 1 },
  image: { flex: 1, borderRadius: radius.badge, borderWidth: StyleSheet.hairlineWidth },
  badges: { position: 'absolute', left: 4, top: 4, gap: 2, alignItems: 'flex-start' },
});
