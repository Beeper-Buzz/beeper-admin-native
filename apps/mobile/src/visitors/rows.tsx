import {
  type Cart,
  formatMoney,
  isAbandoned,
  type VisitorSession,
  visitorName,
} from '@instincts/spree-domain';
import { layout, space } from '@instincts/spree-ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge, Button } from '@/components/primitives';
import { Text } from '@/components/text';
import { duration, shortUrl, timeAgo } from '@/components/time';
import { useTheme } from '@/theme/theme';

const DEVICES: Record<string, string> = { mobile: 'Phone', desktop: 'Desktop', tablet: 'Tablet' };

export function deviceLabel(device: VisitorSession['device']): string | null {
  return device && device !== 'unknown' ? (DEVICES[device] ?? null) : null;
}

/** "Bags · /t/bags" (the page's title, else its path). */
export function pageLabel(s: Pick<VisitorSession, 'currentTitle' | 'currentUrl'>): string {
  return s.currentTitle?.trim() || shortUrl(s.currentUrl) || 'Unknown page';
}

/** "2 items · $49.00". */
export function cartLabel(cart: { itemCount: number; total: Cart['total'] }): string {
  return [
    `${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'}`,
    cart.total ? formatMoney(cart.total) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** One live session: who, the page they're on, how long, device, cart, and Message. */
export function VisitorRow({
  session: s,
  first,
  now = Date.now(),
  onPress,
  onMessage,
  messaging,
}: {
  session: VisitorSession;
  first?: boolean;
  now?: number;
  onPress: () => void;
  /** Absent when the store has no inbox. */
  onMessage?: (() => void) | undefined;
  messaging?: boolean;
}) {
  const { colors } = useTheme();
  const name = visitorName(s);
  const onSite = duration(s.startedAt, new Date(now).toISOString());
  const detail = [
    onSite ? `${onSite} on the store` : null,
    deviceLabel(s.device),
    s.country,
    `${s.pageViews} pages`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View
      style={[
        styles.row,
        { borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderTopColor: colors.line },
      ]}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${name}, on ${pageLabel(s)}, ${detail}${s.cart ? `, cart ${cartLabel(s.cart)}` : ''}`}
        onPress={onPress}
        style={({ pressed }) => ({ flex: 1, gap: 2, opacity: pressed ? 0.7 : 1 })}
      >
        <Text font="uiSemibold" numberOfLines={1}>
          {name}
        </Text>
        <Text size="footnote" numberOfLines={1}>
          {pageLabel(s)}
        </Text>
        <Text size="caption" tone="muted" numberOfLines={2}>
          {detail}
        </Text>
        {s.cart ? (
          <Text size="caption" font="mono" tone="accent">
            Cart: {cartLabel(s.cart)}
          </Text>
        ) : null}
        {!s.online ? (
          <Text size="caption" tone="muted">
            Seen {timeAgo(s.lastSeenAt, now)} ago
          </Text>
        ) : null}
      </Pressable>
      {onMessage ? (
        <Button
          size="small"
          variant="tonal"
          title={s.conversationId ? 'Open chat' : 'Message'}
          accessibilityLabel={`${s.conversationId ? 'Open the chat with' : 'Message'} ${name}`}
          loading={messaging}
          onPress={onMessage}
        />
      ) : null}
    </View>
  );
}

/** One cart: email, items, total, when, and Active or Abandoned; opens the order. */
export function CartRow({
  cart,
  first,
  now = Date.now(),
  onPress,
}: {
  cart: Cart;
  first?: boolean;
  now?: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const abandoned = isAbandoned(cart, now);
  const items = cart.items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)).join(', ');
  const when = timeAgo(cart.updatedAt, now);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[
        cart.email ?? 'Guest',
        abandoned ? 'abandoned' : 'active',
        cartLabel(cart),
        items,
        when ? `updated ${when === 'now' ? 'just now' : `${when} ago`}` : null,
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint="Opens the order"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: colors.line,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Text font="uiSemibold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {cart.email ?? 'Guest'}
          </Text>
          <Badge tone={abandoned ? 'attention' : 'positive'} label={abandoned ? 'Abandoned' : 'Active'} />
        </View>
        <Text size="footnote" tone="muted" numberOfLines={2}>
          {items || cartLabel(cart)}
        </Text>
        <Text size="caption" tone="muted" font="mono">
          {[cart.number, cartLabel(cart), when].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text tone="muted">›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: layout.gutter,
    paddingVertical: space[3],
  },
});
