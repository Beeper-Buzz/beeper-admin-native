import { sellableVariants } from '@instincts/spree-domain';
import { layout, radius, space } from '@instincts/spree-ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ListRow } from '@/components/list-row';
import { Button, EmptyState, MoneyText, Screen, TextField } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { ProductGallery } from '@/media/product-gallery';
import { useProductSaved } from '@/products/products';
import { useCan } from '@/session/session';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

type Status = 'active' | 'draft' | 'archived';
const STATUSES: [Status, string][] = [
  ['active', 'Active'],
  ['draft', 'Draft'],
  ['archived', 'Archived'],
];

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trpc = useTRPC();
  const can = useCan();
  const { colors } = useTheme();
  const saved = useProductSaved();
  const { data: product, error, isPending } = useQuery(trpc.products.get.queryOptions({ id }));
  const update = useMutation(trpc.products.update.mutationOptions({ onSuccess: saved }));
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  useEffect(() => {
    if (!product) return;
    setName(product.name);
    setDescription(product.description ?? '');
  }, [product]);

  if (isPending)
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: space[8] }} />
      </Screen>
    );
  if (error || !product)
    return (
      <Screen>
        <EmptyState title="Couldn't load this product" body={error?.message ?? 'Try again.'} />
      </Screen>
    );

  const writable = can('products.write');
  const dirty =
    name.trim() !== product.name || (description.trim() || null) !== (product.description ?? null);
  const variants = sellableVariants(product);

  return (
    <Screen>
      <Stack.Screen options={{ title: product.name }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: layout.gutter, gap: space[4] }}
      >
        {can('products.media') ? (
          <ProductGallery productId={product.id} />
        ) : product.imageUrl ? (
          <Image
            source={{ uri: product.imageUrl }}
            accessibilityIgnoresInvertColors
            style={{
              width: '100%',
              aspectRatio: 1.6,
              borderRadius: radius.card,
              backgroundColor: colors.surface,
            }}
            contentFit="cover"
          />
        ) : null}

        <View style={{ gap: space[2] }}>
          <Label>Status</Label>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: space[2] }}>
            {STATUSES.map(([k, label]) => {
              const on = product.status === k;
              return (
                <Pressable
                  key={k}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: !writable }}
                  disabled={!writable || on || update.isPending}
                  onPress={() => update.mutate({ product: { id: product.id }, status: k })}
                  style={[
                    styles.segment,
                    {
                      borderColor: on ? colors.ink : colors.line,
                      backgroundColor: on ? colors.ink : colors.surface,
                    },
                  ]}
                >
                  <Text size="footnote" font="uiMedium" style={{ color: on ? colors.bg : colors.ink }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text size="footnote" tone="muted">
            {product.status === 'active'
              ? 'Shown in your store.'
              : product.status === 'draft'
                ? 'Hidden from your store until you make it active.'
                : 'Retired: hidden and no longer sold.'}
          </Text>
        </View>

        <TextField label="Name" value={name} onChangeText={setName} editable={writable} />
        <TextField
          label="Description"
          value={description}
          onChangeText={setDescription}
          editable={writable}
          multiline
          style={{ minHeight: 96, textAlignVertical: 'top' }}
        />
        {update.error ? (
          <Text size="footnote" tone="critical" accessibilityLiveRegion="polite">
            {update.error.message}
          </Text>
        ) : null}
        {writable && dirty ? (
          <Button
            title="Save"
            loading={update.isPending}
            disabled={!name.trim()}
            onPress={() =>
              update.mutate({
                product: { id: product.id },
                ...(name.trim() !== product.name ? { name: name.trim() } : {}),
                ...((description.trim() || null) !== (product.description ?? null)
                  ? { description: description.trim() || null }
                  : {}),
              })
            }
          />
        ) : null}

        <View style={{ gap: space[1] }}>
          <Label>{variants.length > 1 ? `${variants.length} variants` : 'Price and stock'}</Label>
          <View style={[styles.card, { borderColor: colors.line, backgroundColor: colors.surface }]}>
            {variants.map((v, i) => (
              <ListRow
                key={v.id}
                first={i === 0}
                title={v.optionsText || product.name}
                subtitle={[
                  v.sku ? `SKU ${v.sku}` : null,
                  v.totalOnHand === null ? 'Not tracked' : `${v.totalOnHand} in stock`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={v.price ? <MoneyText value={v.price} /> : null}
                {...(can('products.write') || can('inventory.adjust')
                  ? {
                      onPress: () =>
                        router.push({
                          pathname: '/products/variant',
                          params: { id: product.id, variant: v.id },
                        }),
                    }
                  : {})}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space[2],
    borderRadius: radius.badge,
    borderWidth: 1,
  },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, overflow: 'hidden' },
});
