import { layout, space } from '@instincts/spree-ui';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { Button, Screen } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { type DraftRef, loadActiveDraft } from '@/orders/active-draft';
import { AddressFields, CustomerPicker, ItemPicker, LineEditor, Toggle } from '@/orders/draft-fields';
import {
  addLine,
  asGuest,
  type DraftForm,
  emptyForm,
  formFromOrder,
  setQuantity,
  toDraftInput,
  validate,
  withCustomer,
} from '@/orders/draft-form';
import { useDraftOrder } from '@/orders/use-draft-order';
import { useStoreId } from '@/session/session';
import { useTRPC } from '@/trpc/trpc';

/**
 * New order, step 1: customer, products and addresses. Continuing saves a draft on the store
 * (created once, then updated) and opens the review, where shipping and payment are chosen.
 * A draft left unfinished is picked up again the next time this screen opens.
 */
export default function NewOrderScreen() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const storeId = useStoreId();
  const draftOrder = useDraftOrder();
  const [form, setForm] = useState<DraftForm>(emptyForm);
  const [draft, setDraft] = useState<DraftRef | null>(null);
  const [loading, setLoading] = useState(true);
  const [touched, setTouched] = useState(false);

  // Resume the draft in progress, if the store still has it as a draft.
  useEffect(() => {
    let live = true;
    (async () => {
      const ref = storeId ? await loadActiveDraft(storeId) : null;
      if (!ref) return;
      try {
        const order = await qc.fetchQuery(trpc.orders.get.queryOptions({ id: ref.number }));
        if (!live) return;
        if (order.status === 'draft') {
          setDraft({ id: order.id, number: order.number });
          setForm(formFromOrder(order));
        } else await draftOrder.forget();
      } catch {
        await draftOrder.forget();
      }
    })().finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [storeId, qc, trpc, draftOrder.forget]);

  const errors = validate(form);
  const shown = touched ? errors : {};
  const saving = draftOrder.create.isPending || draftOrder.update.isPending;
  const error = draftOrder.create.error?.message ?? draftOrder.update.error?.message ?? null;

  const next = () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    const input = toDraftInput(form);
    const review = (order: { id: string; number: string }) => {
      setDraft({ id: order.id, number: order.number });
      router.push({ pathname: '/orders/draft', params: { id: order.number } });
    };
    if (draft) draftOrder.update.mutate({ ...input, order: draft }, { onSuccess: review });
    else draftOrder.create.mutate(input, { onSuccess: review });
  };

  const discard = () => {
    if (!draft) return router.back();
    Alert.alert(`Discard draft ${draft.number}?`, 'The store deletes the draft and its items.', [
      { text: 'Keep draft', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => draftOrder.discard.mutate({ order: draft }, { onSuccess: () => router.back() }),
      },
    ]);
  };

  if (loading)
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: space[8] }} />
      </Screen>
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: draft ? `Draft ${draft.number}` : 'New order' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: layout.gutter, gap: space[5] }}
      >
        {draft ? (
          <Text size="footnote" tone="muted">
            Continuing the draft you started. It is saved on your store until you place or discard it.
          </Text>
        ) : null}

        <View style={{ gap: space[2] }}>
          <Label>Customer</Label>
          <CustomerPicker
            customer={form.customer}
            email={form.email}
            error={shown.email ?? null}
            onCustomer={(c) => setForm((f) => withCustomer(f, c))}
            onGuest={(email) => setForm((f) => asGuest(f, email))}
            onClear={() => setForm((f) => ({ ...f, customer: null, email: '' }))}
          />
        </View>

        <View style={{ gap: space[2] }}>
          <Label>Products</Label>
          <LineEditor
            lines={form.lines}
            error={shown.lines ?? null}
            onQuantity={(variantId, q) => setForm((f) => setQuantity(f, variantId, q))}
          />
          <ItemPicker onAdd={(line) => setForm((f) => addLine(f, line))} />
        </View>

        <AddressFields
          title="Ship to"
          prefix="ship"
          value={form.ship}
          errors={shown}
          onChange={(ship) => setForm((f) => ({ ...f, ship }))}
        />
        <Toggle
          label="Bill to the shipping address"
          value={form.billSame}
          onChange={(billSame) => setForm((f) => ({ ...f, billSame }))}
        />
        {form.billSame ? null : (
          <AddressFields
            title="Bill to"
            prefix="bill"
            value={form.bill}
            errors={shown}
            onChange={(bill) => setForm((f) => ({ ...f, bill }))}
          />
        )}

        {touched && Object.keys(errors).length ? (
          <Text size="footnote" tone="critical" accessibilityLiveRegion="polite">
            Check the highlighted fields.
          </Text>
        ) : null}
        {error ? (
          <Text size="footnote" tone="critical" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button title="Continue to shipping and payment" loading={saving} onPress={next} />
        <Button
          title={draft ? 'Discard draft' : 'Cancel'}
          variant={draft ? 'destructive' : 'plain'}
          loading={draftOrder.discard.isPending}
          onPress={discard}
        />
        <View style={{ height: space[8] }} />
      </ScrollView>
    </Screen>
  );
}
