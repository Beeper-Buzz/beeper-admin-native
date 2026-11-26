import { cityLine, type Order } from '@instincts/spree-domain';
import { layout, space } from '@instincts/spree-ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/theme';
import { Badge, type BadgeTone, MoneyText, SpreeNumberText } from './primitives';
import { Text } from './text';

const PAYMENT: Partial<Record<Order['paymentStatus'], [BadgeTone, string]>> = {
  unpaid: ['attention', 'Payment due'],
  partially_paid: ['attention', 'Partially paid'],
  authorized: ['attention', 'Authorized'],
  paid: ['positive', 'Paid'],
  partially_refunded: ['info', 'Partially refunded'],
  refunded: ['neutral', 'Refunded'],
  overcharged: ['info', 'Credit owed'],
  voided: ['neutral', 'Voided'],
  failed: ['critical', 'Payment failed'],
};
const FULFILLMENT: Partial<Record<Order['fulfillmentStatus'], [BadgeTone, string]>> = {
  unfulfilled: ['attention', 'Unfulfilled'],
  partial: ['info', 'Partially shipped'],
  backorder: ['attention', 'Backordered'],
  fulfilled: ['positive', 'Shipped'],
  delivered: ['positive', 'Delivered'],
};

/** Payment badge first, then fulfilment (design-language.md). Canceled orders show one badge. */
export function orderBadges(order: Order): [BadgeTone, string][] {
  if (order.status === 'canceled') return [['critical', 'Canceled']];
  return [PAYMENT[order.paymentStatus], FULFILLMENT[order.fulfillmentStatus]].filter(
    (b): b is [BadgeTone, string] => !!b,
  );
}

export function customerLabel(order: Order): string {
  const a = order.shipAddress ?? order.billAddress;
  const name = a ? [a.firstName, a.lastName].filter(Boolean).join(' ') : '';
  return name || order.email || 'Guest';
}

export function OrderRow({ order, onPress }: { order: Order; onPress: () => void }) {
  const { colors } = useTheme();
  const address = order.shipAddress ?? order.billAddress;
  const when = order.completedAt ?? order.createdAt;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.number}, ${customerLabel(order)}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfaceSunk : colors.surface, borderBottomColor: colors.line },
      ]}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text font="uiSemibold" numberOfLines={1}>
          {customerLabel(order)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <SpreeNumberText value={order.number} />
          <Text size="footnote" tone="muted" numberOfLines={1}>
            {[
              address ? cityLine(address) : null,
              new Date(when).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: space[1], marginTop: 2, flexWrap: 'wrap' }}>
          {orderBadges(order).map(([tone, label]) => (
            <Badge key={label} tone={tone} label={label} />
          ))}
        </View>
      </View>
      <MoneyText value={order.total} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[3],
    paddingHorizontal: layout.gutter,
    paddingVertical: space[3],
    minHeight: layout.rowMinHeight,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
