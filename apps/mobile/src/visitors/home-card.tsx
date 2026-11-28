import { layout, radius, space } from '@instincts/spree-ui';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Label, Text } from '@/components/text';
import { useTheme } from '@/theme/theme';
import { useVisitorCounts } from './use-visitors';

/** "3 online · 2 carts", "3 online" or "2 carts"; a dash while a count is loading. */
export function visitorSummary(
  online: number | null | undefined,
  carts: number | null | undefined,
  has: { visitors: boolean; carts: boolean },
) {
  const parts: string[] = [];
  if (has.visitors) parts.push(`${online ?? '–'} online`);
  if (has.carts) parts.push(`${carts ?? '–'} ${carts === 1 ? 'cart' : 'carts'}`);
  return parts.join(' · ');
}

/** The Home card for visitors and carts; opens the Visitors screen. Nothing without either capability. */
export function VisitorsCard({ hasVisitors, hasCarts }: { hasVisitors: boolean; hasCarts: boolean }) {
  const { colors } = useTheme();
  const counts = useVisitorCounts();
  if (!counts.shown) return null;
  const text = visitorSummary(counts.online, counts.carts, { visitors: hasVisitors, carts: hasCarts });
  return (
    <View style={{ gap: space[2] }}>
      <Label>On the store</Label>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityHint="Opens visitors and carts"
        onPress={() => router.navigate('/more/visitors')}
        style={({ pressed }) => [
          styles.card,
          { borderColor: colors.line, backgroundColor: pressed ? colors.surfaceSunk : colors.surface },
        ]}
      >
        <View
          style={[
            styles.dot,
            { backgroundColor: (counts.online ?? 0) > 0 ? colors.positive : colors.neutral },
          ]}
        />
        <Text font="display" size="title3" style={{ flex: 1 }}>
          {text}
        </Text>
        <Text tone="muted">›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    minHeight: layout.rowMinHeight,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
