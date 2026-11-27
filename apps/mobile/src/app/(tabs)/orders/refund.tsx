import { formatMoney } from '@instincts/spree-domain';
import { layout, radius, space } from '@instincts/spree-ui';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, EmptyState, Screen, TextField } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useOrderMutations } from '@/orders/use-order-mutations';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

const AMOUNT = /^\d+(\.\d{1,2})?$/;

/** Sheet: refund all or part of one payment through the store's payment gateway. */
export default function RefundSheet() {
  const { id, payment: paymentId } = useLocalSearchParams<{ id: string; payment: string }>();
  const trpc = useTRPC();
  const { colors } = useTheme();
  const { data: order } = useQuery(trpc.orders.get.queryOptions({ id }));
  const reasons = useQuery(trpc.orders.refundReasons.queryOptions());
  const { refund } = useOrderMutations(id);
  const payment = order?.payments.find((p) => p.id === paymentId);
  const [amount, setAmount] = useState(payment?.amount.amount ?? '');
  const [reasonId, setReasonId] = useState<string | null>(null);

  if (!order || !payment)
    return (
      <Screen>
        <EmptyState title="Payment not found" body="Go back to the order and try again." />
      </Screen>
    );

  const trimmed = amount.trim().replace(',', '.');
  const valid = AMOUNT.test(trimmed) && Number(trimmed) > 0;
  const label = valid ? formatMoney({ amount: trimmed, currency: payment.amount.currency }) : null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: layout.gutter, gap: space[4] }}
        keyboardShouldPersistTaps="handled"
      >
        <Text size="title2" font="display">
          Refund
        </Text>
        <Text tone="muted">
          {order.number} · {payment.sourceSummary ?? payment.methodName ?? 'Payment'} ·{' '}
          {formatMoney(payment.amount)} paid
        </Text>
        <TextField
          label={`Amount (${payment.amount.currency})`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          error={amount && !valid ? 'Enter an amount like 12.50.' : null}
        />
        {reasons.data?.length ? (
          <View style={{ gap: space[2] }}>
            <Label>Reason</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {reasons.data.map((r) => {
                const selected = (reasonId ?? reasons.data[0]?.id) === r.id;
                return (
                  <Pressable
                    key={r.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setReasonId(r.id)}
                    style={{
                      paddingHorizontal: space[3],
                      paddingVertical: space[2],
                      borderRadius: radius.badge,
                      borderWidth: 1,
                      borderColor: selected ? colors.accent : colors.line,
                      backgroundColor: selected ? colors.surface : 'transparent',
                    }}
                  >
                    <Text size="footnote" font={selected ? 'uiSemibold' : 'ui'}>
                      {r.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        <Text size="footnote" tone="muted">
          The money goes back through {payment.methodName ?? 'the payment method'}. This can't be undone.
        </Text>
        {refund.error ? (
          <Text size="footnote" tone="critical" accessibilityLiveRegion="polite">
            {refund.error.message}
          </Text>
        ) : null}
        <Button
          title={label ? `Refund ${label}` : 'Refund'}
          disabled={!valid}
          loading={refund.isPending}
          onPress={() =>
            refund.mutate(
              {
                order: { id: order.id, number: order.number },
                payment: { id: payment.id, number: payment.number },
                amount: trimmed,
                reasonId: reasonId ?? reasons.data?.[0]?.id ?? null,
              },
              { onSuccess: () => router.back() },
            )
          }
        />
      </ScrollView>
    </Screen>
  );
}
