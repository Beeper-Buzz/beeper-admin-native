import type { Promotion } from '@instincts/spree-domain';
import { layout, radius, space } from '@instincts/spree-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { Button, EmptyState, Screen, TextField } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { type Form, formFor, fromDay, validate } from '@/promotions/form';
import { discountLabel } from '@/promotions/labels';
import { useCan } from '@/session/session';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

export default function PromotionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const trpc = useTRPC();
  const qc = useQueryClient();
  const can = useCan();
  const { colors } = useTheme();
  const existing = useQuery({ ...trpc.promotions.get.queryOptions({ id }), enabled: !isNew });
  const promotion = existing.data;
  const [form, setForm] = useState<Form>(() => formFor(undefined));
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (promotion) setForm(formFor(promotion));
  }, [promotion]);

  const done = (p: Promotion) => {
    qc.setQueryData(trpc.promotions.get.queryKey({ id: p.id }), p);
    void qc.invalidateQueries(trpc.promotions.list.pathFilter());
  };
  // The form is long and the keyboard covers its end: say so out loud when a save fails.
  const failed = (e: { message: string }) => Alert.alert("Couldn't save the promotion", e.message);
  const create = useMutation(
    trpc.promotions.create.mutationOptions({
      onSuccess: (p) => {
        done(p);
        router.back();
      },
      onError: failed,
    }),
  );
  const update = useMutation(trpc.promotions.update.mutationOptions({ onSuccess: done, onError: failed }));

  if (!isNew && existing.isPending)
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: space[8] }} />
      </Screen>
    );
  if (!isNew && !promotion)
    return (
      <Screen>
        <EmptyState title="Couldn't load this promotion" body={existing.error?.message ?? 'Try again.'} />
      </Screen>
    );

  const editableDiscount = isNew || !!promotion?.editableDiscount;
  const writable = can('promotions.write');
  const errors = validate(form, editableDiscount);
  const valid = Object.keys(errors).length === 0;
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const shown = (k: keyof Form) => (touched ? errors[k] : undefined) ?? null;
  const amount = form.amount.trim().replace(',', '.');
  const discount = { type: form.kind, amount };

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const fields = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      startsAt: fromDay(form.startsOn, 'start'),
      expiresAt: fromDay(form.endsOn, 'end'),
      usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
    };
    if (isNew) return create.mutate({ ...fields, discount });
    if (!promotion) return;
    const before = formFor(promotion);
    const changed = Object.fromEntries(
      Object.entries(fields).filter(([k]) => {
        const key =
          ({ startsAt: 'startsOn', expiresAt: 'endsOn' } as Record<string, keyof Form>)[k] ??
          (k as keyof Form);
        return form[key] !== before[key];
      }),
    );
    const discountChanged = editableDiscount && (form.kind !== before.kind || amount !== before.amount);
    update.mutate({ id: promotion.id, ...changed, ...(discountChanged ? { discount } : {}) });
  };
  const endNow = () => promotion && update.mutate({ id: promotion.id, expiresAt: new Date().toISOString() });
  const restart = () => promotion && update.mutate({ id: promotion.id, expiresAt: null });
  const error = create.error?.message ?? update.error?.message ?? null;

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New promotion' : (promotion?.name ?? '') }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: layout.gutter, gap: space[4] }}
      >
        <TextField
          label="Name"
          value={form.name}
          onChangeText={(name) => set({ name })}
          editable={writable}
          error={shown('name')}
        />
        <TextField
          label="Discount code (empty for an automatic promotion)"
          value={form.code}
          onChangeText={(code) => set({ code: code.toUpperCase() })}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={writable}
          error={shown('code')}
          placeholder="SPRING20"
        />

        <View style={{ gap: space[2] }}>
          <Label>Discount</Label>
          {editableDiscount ? (
            <>
              <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: space[2] }}>
                {(
                  [
                    ['percent', 'Percentage'],
                    ['fixed', 'Fixed amount'],
                  ] as const
                ).map(([k, label]) => {
                  const on = form.kind === k;
                  return (
                    <Pressable
                      key={k}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      disabled={!writable}
                      onPress={() => set({ kind: k })}
                      style={{
                        flex: 1,
                        alignItems: 'center',
                        paddingVertical: space[2],
                        borderRadius: radius.badge,
                        borderWidth: 1,
                        borderColor: on ? colors.ink : colors.line,
                        backgroundColor: on ? colors.ink : colors.surface,
                      }}
                    >
                      <Text size="footnote" font="uiMedium" style={{ color: on ? colors.bg : colors.ink }}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextField
                label={form.kind === 'percent' ? 'Percent off the order' : 'Amount off the order'}
                value={form.amount}
                onChangeText={(a) => set({ amount: a })}
                keyboardType="decimal-pad"
                editable={writable}
                error={shown('amount')}
                placeholder={form.kind === 'percent' ? '20' : '10.00'}
              />
            </>
          ) : (
            <Text tone="muted">
              {promotion ? discountLabel(promotion) : ''}. This promotion has rules or actions the app can't
              edit; change its discount in Spree admin.
            </Text>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <View style={{ flex: 1 }}>
            <TextField
              label="Starts (optional)"
              value={form.startsOn}
              onChangeText={(startsOn) => set({ startsOn })}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              editable={writable}
              error={shown('startsOn')}
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label="Ends (optional)"
              value={form.endsOn}
              onChangeText={(endsOn) => set({ endsOn })}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              editable={writable}
              error={shown('endsOn')}
            />
          </View>
        </View>
        <TextField
          label="Usage limit (optional)"
          value={form.usageLimit}
          onChangeText={(usageLimit) => set({ usageLimit })}
          keyboardType="number-pad"
          editable={writable}
          error={shown('usageLimit')}
        />
        {promotion?.usageCount !== null && promotion?.usageCount !== undefined ? (
          <Text size="footnote" tone="muted">
            Used {promotion.usageCount} {promotion.usageCount === 1 ? 'time' : 'times'}
            {promotion.usageLimit ? ` of ${promotion.usageLimit}` : ''}.
          </Text>
        ) : null}

        {error ? (
          <Text size="footnote" tone="critical" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {update.isSuccess && !update.isPending ? (
          <Text size="footnote" tone="muted" accessibilityLiveRegion="polite">
            Saved.
          </Text>
        ) : null}
        {writable ? (
          <>
            <Button
              title={isNew ? 'Create promotion' : 'Save'}
              loading={create.isPending || update.isPending}
              onPress={save}
            />
            {promotion?.status === 'active' ? (
              <Button title="End now" variant="destructive" disabled={update.isPending} onPress={endNow} />
            ) : promotion?.status === 'expired' ? (
              <Button
                title="Restart (remove end date)"
                variant="plain"
                disabled={update.isPending}
                onPress={restart}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
