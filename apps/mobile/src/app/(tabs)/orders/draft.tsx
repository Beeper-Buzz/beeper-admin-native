import { formatMoney, isZero, negateMoney, type Order } from '@instincts/spree-domain';
import { layout, radius, space } from '@instincts/spree-ui';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, EmptyState, MoneyText, Screen } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { addressLine } from '@/orders/draft-form';
import { useDraftOrder } from '@/orders/use-draft-order';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

/** A radio row: the whole row is the control. */
function Option({
  title,
  subtitle,
  selected,
  first,
  disabled,
  onPress,
  trailing,
}: {
  title: string;
  subtitle?: string | null;
  selected: boolean;
  first?: boolean;
  disabled?: boolean;
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { opacity: pressed ? 0.7 : 1 },
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
      ]}
    >
      <View style={[styles.radio, { borderColor: selected ? colors.ink : colors.line }]}>
        {selected ? <View style={[styles.dot, { backgroundColor: colors.ink }]} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text>{title}</Text>
        {subtitle ? (
          <Text size="footnote" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: Order['total']; strong?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text font={strong ? 'uiSemibold' : 'ui'}>{label}</Text>
      <MoneyText value={value} />
    </View>
  );
}

/**
 * New order, step 2: the draft as the store prices it. Choose a shipping rate and how the
 * customer pays (a manual method, paid now or left due), then place the order.
 */
export default function ReviewDraftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trpc = useTRPC();
  const { colors } = useTheme();
  const { data: order, error, isPending } = useQuery(trpc.orders.get.queryOptions({ id }));
  const ref = order ? { id: order.id, number: order.number } : null;
  const methods = useQuery({
    ...trpc.orders.paymentMethods.queryOptions({ order: ref ?? { id, number: id } }),
    enabled: order?.status === 'draft',
  });
  const draftOrder = useDraftOrder();
  const [methodId, setMethodId] = useState<string | null>(null);
  const [paid, setPaid] = useState(true);
  const firstMethod = methods.data?.[0]?.id ?? null;
  useEffect(() => {
    if (methodId === null && firstMethod) setMethodId(firstMethod);
  }, [methodId, firstMethod]);

  if (isPending)
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: space[8] }} />
      </Screen>
    );
  if (error || !order || !ref)
    return (
      <Screen>
        <EmptyState title="Couldn't load this draft" body={error?.message ?? 'Try again.'} />
      </Screen>
    );
  if (order.status !== 'draft')
    return (
      <Screen>
        <EmptyState title={`${order.number} has been placed`} body="It is in your orders now." />
        <View style={{ paddingHorizontal: layout.gutter }}>
          <Button title="View order" onPress={() => router.replace(`/orders/${order.number}`)} />
        </View>
      </Screen>
    );

  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.line }];
  const shipments = order.fulfillments.filter((f) => f.rates.length > 0);
  const noMethods = methods.isSuccess && methods.data.length === 0;
  const payment = methodId ? { methodId, markPaid: paid } : null;
  const dueAfter = payment?.markPaid ? null : order.total;
  const actionError =
    draftOrder.place.error?.message ??
    draftOrder.selectRate.error?.message ??
    draftOrder.discard.error?.message;

  const place = () =>
    draftOrder.place.mutate(
      { order: ref, payment },
      {
        onSuccess: (placed) => {
          router.dismissAll();
          router.push(`/orders/${placed.number}`);
        },
      },
    );
  const discard = () =>
    Alert.alert(`Discard draft ${order.number}?`, 'The store deletes the draft and its items.', [
      { text: 'Keep draft', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => draftOrder.discard.mutate({ order: ref }, { onSuccess: () => router.dismissAll() }),
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: `Review ${order.number}` }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: layout.gutter, gap: space[5] }}
      >
        <View style={{ gap: space[1] }}>
          <Label>Customer</Label>
          <Text>{order.customer ? order.customer.email : `Guest · ${order.email ?? ''}`}</Text>
        </View>

        <View style={card}>
          {order.lineItems.map((li, i) => (
            <View
              key={li.id}
              style={[
                styles.line,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
              ]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={2}>{li.name}</Text>
                <Text size="caption" font="mono" tone="muted">
                  {[li.optionsText, `${li.quantity} × ${formatMoney(li.price)}`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <MoneyText value={li.total} />
            </View>
          ))}
        </View>

        <View style={{ gap: space[1] }}>
          <Label>Ship to</Label>
          <Text tone="muted">{addressLine(order.shipAddress)}</Text>
        </View>

        <View style={{ gap: space[2] }}>
          <Label>Shipping</Label>
          {shipments.length === 0 ? (
            <Text size="footnote" tone="muted">
              The store quoted no shipping rates for this address.
            </Text>
          ) : (
            shipments.map((f) => (
              <View
                key={f.id}
                style={card}
                accessibilityRole="radiogroup"
                accessibilityLabel={`Shipping for ${f.number}`}
              >
                {f.rates.map((r, i) => (
                  <Option
                    key={r.id}
                    first={i === 0}
                    title={r.name}
                    selected={r.selected}
                    disabled={draftOrder.selectRate.isPending}
                    onPress={() =>
                      r.selected ||
                      draftOrder.selectRate.mutate({
                        order: ref,
                        fulfillment: { id: f.id, number: f.number },
                        rateId: r.id,
                      })
                    }
                    trailing={<MoneyText value={r.cost} />}
                  />
                ))}
              </View>
            ))
          )}
        </View>

        <View style={{ gap: space[2] }}>
          <Label>Payment</Label>
          {methods.isPending ? <ActivityIndicator /> : null}
          {methods.error ? (
            <Text size="footnote" tone="critical">
              {methods.error.message}
            </Text>
          ) : null}
          {noMethods ? (
            <Text size="footnote" tone="muted">
              The store has no payment method that works without a card, so nothing is recorded: the whole
              total stays due.
            </Text>
          ) : null}
          {methods.data?.length ? (
            <>
              <View style={card} accessibilityRole="radiogroup" accessibilityLabel="Payment method">
                {methods.data.map((m, i) => (
                  <Option
                    key={m.id}
                    first={i === 0}
                    title={m.name}
                    subtitle={m.description}
                    selected={methodId === m.id}
                    onPress={() => setMethodId(m.id)}
                  />
                ))}
              </View>
              <View style={card} accessibilityRole="radiogroup" accessibilityLabel="Payment status">
                <Option
                  first
                  title="Paid now"
                  subtitle="The money is in hand; the payment is captured."
                  selected={paid}
                  onPress={() => setPaid(true)}
                />
                <Option
                  title="Balance due"
                  subtitle="Record the payment and capture it when it arrives."
                  selected={!paid}
                  onPress={() => setPaid(false)}
                />
              </View>
            </>
          ) : null}
        </View>

        <View style={[card, { padding: space[3], gap: space[2] }]}>
          <TotalRow label="Items" value={order.itemTotal} />
          <TotalRow label="Shipping" value={order.shipTotal} />
          {isZero(order.taxTotal) ? null : <TotalRow label="Tax" value={order.taxTotal} />}
          {isZero(order.discountTotal) ? null : (
            <TotalRow label="Discounts" value={negateMoney(order.discountTotal)} />
          )}
          <TotalRow label="Total" value={order.total} strong />
          {dueAfter ? <TotalRow label="Due after placing" value={dueAfter} /> : null}
        </View>

        {actionError ? (
          <Text size="footnote" tone="critical" accessibilityLiveRegion="polite">
            {actionError}
          </Text>
        ) : null}
        <Button
          title="Place order"
          loading={draftOrder.place.isPending}
          disabled={methods.isPending || draftOrder.selectRate.isPending || draftOrder.discard.isPending}
          onPress={place}
        />
        <Button title="Edit" variant="plain" onPress={() => router.back()} />
        <Button
          title="Discard draft"
          variant="destructive"
          loading={draftOrder.discard.isPending}
          disabled={draftOrder.place.isPending}
          onPress={discard}
        />
        <View style={{ height: space[8] }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, overflow: 'hidden' },
  line: { flexDirection: 'row', gap: space[3], padding: space[3], alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], minHeight: 44 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3] },
});
