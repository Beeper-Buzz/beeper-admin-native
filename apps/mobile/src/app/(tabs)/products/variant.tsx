import { radius, space } from '@instincts/spree-ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, EmptyState, Screen, Sheet, TextField } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useProductSaved } from '@/products/products';
import { useCan } from '@/session/session';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

const PRICE = /^\d+(\.\d{1,2})?$/;
const clean = (v: string) => v.trim().replace(',', '.');

/** Sheet: one variant's price, compare-at price, SKU and on-hand stock. */
export default function VariantSheet() {
  const { id, variant: variantId } = useLocalSearchParams<{ id: string; variant: string }>();
  const trpc = useTRPC();
  const can = useCan();
  const { colors } = useTheme();
  const saved = useProductSaved();
  const { data: product } = useQuery(trpc.products.get.queryOptions({ id }));
  const variant = product?.variants.find((v) => v.id === variantId);
  const [price, setPrice] = useState(variant?.price?.amount ?? '');
  const [compareAt, setCompareAt] = useState(variant?.compareAtPrice?.amount ?? '');
  const [sku, setSku] = useState(variant?.sku ?? '');
  const [stock, setStock] = useState(
    variant?.totalOnHand === null || !variant ? '' : String(variant.totalOnHand),
  );
  // Fill the form once the variant is known (the sheet can open before the product loads).
  const filled = useRef(false);
  useEffect(() => {
    if (!variant || filled.current) return;
    filled.current = true;
    setPrice(variant.price?.amount ?? '');
    setCompareAt(variant.compareAtPrice?.amount ?? '');
    setSku(variant.sku ?? '');
    setStock(variant.totalOnHand === null ? '' : String(variant.totalOnHand));
  }, [variant]);
  const updateVariant = useMutation(trpc.products.updateVariant.mutationOptions({ onSuccess: saved }));
  const setStockCount = useMutation(trpc.products.setStock.mutationOptions({ onSuccess: saved }));

  if (!product || !variant)
    return (
      <Screen>
        <EmptyState title="Variant not found" body="Go back to the product and try again." />
      </Screen>
    );

  const canPrice = can('products.write');
  const canStock = can('inventory.adjust');
  const priceError =
    price && !(PRICE.test(clean(price)) && Number(clean(price)) > 0) ? 'Enter a price like 19.99.' : null;
  const compareError =
    compareAt && !(PRICE.test(clean(compareAt)) && Number(clean(compareAt)) > 0)
      ? 'Enter a price, or leave empty.'
      : null;
  const stockError = stock && !/^\d+$/.test(stock.trim()) ? 'A whole number.' : null;

  const variantPatch = {
    ...(price && clean(price) !== variant.price?.amount ? { price: clean(price) } : {}),
    ...(clean(compareAt) !== (variant.compareAtPrice?.amount ?? '')
      ? { compareAtPrice: compareAt ? clean(compareAt) : null }
      : {}),
    ...(sku.trim() !== (variant.sku ?? '') ? { sku: sku.trim() || null } : {}),
  };
  const stockChanged = stock !== '' && Number(stock) !== variant.totalOnHand;
  const nothing = Object.keys(variantPatch).length === 0 && !stockChanged;
  const busy = updateVariant.isPending || setStockCount.isPending;
  const error = updateVariant.error?.message ?? setStockCount.error?.message ?? null;
  const currency = variant.price?.currency ?? '';

  const save = async () => {
    try {
      if (Object.keys(variantPatch).length)
        await updateVariant.mutateAsync({
          product: { id: product.id },
          variantId: variant.id,
          ...variantPatch,
        });
      if (stockChanged)
        await setStockCount.mutateAsync({
          product: { id: product.id },
          variantId: variant.id,
          countOnHand: Number(stock),
        });
      router.back();
    } catch {
      // Shown below from the mutation's error.
    }
  };
  const step = (by: number) => setStock((s) => String(Math.max(0, (Number(s) || 0) + by)));

  return (
    <Sheet>
      <Text size="title2" font="display" numberOfLines={2}>
        {variant.optionsText || product.name}
      </Text>
      {canPrice ? (
        <>
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <View style={{ flex: 1 }}>
              <TextField
                label={`Price${currency ? ` (${currency})` : ''}`}
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                error={priceError}
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label="Compare-at price"
                value={compareAt}
                onChangeText={setCompareAt}
                keyboardType="decimal-pad"
                error={compareError}
                placeholder="Optional"
              />
            </View>
          </View>
          <TextField
            label="SKU"
            value={sku}
            onChangeText={setSku}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </>
      ) : null}
      {canStock && variant.totalOnHand !== null ? (
        <View style={{ gap: space[2] }}>
          <Label>On hand</Label>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space[2] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="One less"
              onPress={() => step(-1)}
              style={{
                padding: space[3],
                borderRadius: radius.badge,
                borderWidth: 1,
                borderColor: colors.line,
              }}
            >
              <Text font="uiSemibold">−</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <TextField
                label="Stock count"
                value={stock}
                onChangeText={setStock}
                keyboardType="number-pad"
                error={stockError}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="One more"
              onPress={() => step(1)}
              style={{
                padding: space[3],
                borderRadius: radius.badge,
                borderWidth: 1,
                borderColor: colors.line,
              }}
            >
              <Text font="uiSemibold">+</Text>
            </Pressable>
          </View>
          <Text size="footnote" tone="muted">
            Sets the count at your default stock location.
          </Text>
        </View>
      ) : null}
      {error ? (
        <Text size="footnote" tone="critical" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button
        title="Save"
        loading={busy}
        disabled={nothing || !!priceError || !!compareError || !!stockError}
        onPress={save}
      />
    </Sheet>
  );
}
