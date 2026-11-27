import { radius, space } from '@instincts/spree-ui';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Button, EmptyState, Screen, Sheet, TextField } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { photoLabel, useGalleryMutations, variantChoices } from '@/media/gallery';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

/** Sheet: one product photo's alt text, place in the gallery, variant, and delete. */
export default function PhotoSheet() {
  const { id, image: imageId } = useLocalSearchParams<{ id: string; image: string }>();
  const trpc = useTRPC();
  const { colors } = useTheme();
  const ref = { id };
  const { data: gallery } = useQuery(trpc.media.list.queryOptions({ product: ref }));
  const { data: product } = useQuery(trpc.products.get.queryOptions({ id }));
  const { update, move, remove } = useGalleryMutations(id);
  const index = gallery?.findIndex((i) => i.id === imageId) ?? -1;
  const image = gallery?.[index];
  const [alt, setAlt] = useState(image?.alt ?? '');
  // Fill the field once the photo is known (the sheet can open before the gallery loads).
  const filled = useRef(false);
  useEffect(() => {
    if (!image || filled.current) return;
    filled.current = true;
    setAlt(image.alt ?? '');
  }, [image]);

  if (!gallery || !image)
    return (
      <Screen>
        <EmptyState title="Photo not found" body="Go back to the product and try again." />
      </Screen>
    );

  const count = gallery.length;
  const busy = update.isPending || move.isPending || remove.isPending;
  const error = update.error?.message ?? move.error?.message ?? remove.error?.message ?? null;
  const altChanged = (alt.trim() || null) !== image.alt;
  const choices = variantChoices(product);
  const shownFor = image.variantIds[0] ?? null;
  const goTo = (toIndex: number) => move.mutate({ product: ref, imageId: image.id, toIndex });

  const confirmDelete = () =>
    Alert.alert('Delete this photo?', 'It is removed from the product and your store.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => remove.mutate({ product: ref, imageId: image.id }, { onSuccess: () => router.back() }),
      },
    ]);

  return (
    <Sheet>
      <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
        <Image
          source={{ uri: image.thumbUrl ?? image.url }}
          accessibilityIgnoresInvertColors
          style={{ width: 88, height: 88, borderRadius: radius.badge, backgroundColor: colors.surface }}
          contentFit="cover"
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text size="title3" font="uiSemibold">
            {photoLabel(index, count)}
          </Text>
          {product ? (
            <Text size="footnote" tone="muted" numberOfLines={2}>
              {product.name}
            </Text>
          ) : null}
        </View>
      </View>

      <TextField
        label="Alt text"
        value={alt}
        onChangeText={setAlt}
        placeholder="What the photo shows, for screen readers and search"
        maxLength={255}
        returnKeyType="done"
      />
      {altChanged ? (
        <Button
          title="Save alt text"
          loading={update.isPending}
          disabled={busy}
          onPress={() => update.mutate({ product: ref, imageId: image.id, alt: alt.trim() || null })}
        />
      ) : null}

      {count > 1 ? (
        <View style={{ gap: space[2] }}>
          <Label>Order</Label>
          <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
            <Button
              title="Move earlier"
              size="small"
              variant="tonal"
              disabled={busy || index === 0}
              onPress={() => goTo(index - 1)}
            />
            <Button
              title="Move later"
              size="small"
              variant="tonal"
              disabled={busy || index === count - 1}
              onPress={() => goTo(index + 1)}
            />
            <Button
              title="Make main photo"
              size="small"
              variant="tonal"
              disabled={busy || index === 0}
              onPress={() => goTo(0)}
            />
          </View>
        </View>
      ) : null}

      {choices.length ? (
        <View style={{ gap: space[2] }}>
          <Label>Shown for</Label>
          <View
            accessibilityRole="radiogroup"
            style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}
          >
            {choices.map((option) => {
              const on = option.id === shownFor;
              return (
                <Pressable
                  key={option.id ?? 'all'}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: busy }}
                  accessibilityLabel={`Shown for ${option.label}`}
                  disabled={busy || on}
                  onPress={() =>
                    update.mutate({
                      product: ref,
                      imageId: image.id,
                      variantIds: option.id ? [option.id] : [],
                    })
                  }
                  style={{
                    paddingHorizontal: space[3],
                    paddingVertical: 6,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: on ? colors.ink : colors.line,
                    backgroundColor: on ? colors.ink : colors.surface,
                  }}
                >
                  <Text size="footnote" font="uiMedium" style={{ color: on ? colors.bg : colors.ink }}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {image.variantIds.length > 1 ? (
            <Text size="footnote" tone="muted">
              Shown for {image.variantIds.length} variants. Picking one replaces them.
            </Text>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <Text size="footnote" tone="critical" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button title="Delete photo" variant="destructive" disabled={busy} onPress={confirmDelete} />
    </Sheet>
  );
}
