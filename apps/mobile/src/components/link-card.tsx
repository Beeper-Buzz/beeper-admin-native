import { radius, space } from '@instincts/spree-ui';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/theme';
import { Text } from './text';

export interface LinkItem {
  key: string;
  title: string;
  subtitle?: string | null;
  leading?: ReactNode;
  onPress: () => void;
}

/** A card of navigation rows (the More screen's sections). */
export function LinkCard({ items }: { items: readonly LinkItem[] }) {
  const { colors } = useTheme();
  if (!items.length) return null;
  return (
    <View
      style={{
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.line,
        borderRadius: radius.card,
        backgroundColor: colors.surface,
      }}
    >
      {items.map((item, i) => (
        <Pressable
          key={item.key}
          accessibilityRole="link"
          accessibilityLabel={item.title}
          accessibilityHint={item.subtitle ?? undefined}
          onPress={item.onPress}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            padding: space[3],
            gap: space[3],
            opacity: pressed ? 0.7 : 1,
            borderTopWidth: i ? StyleSheet.hairlineWidth : 0,
            borderTopColor: colors.line,
          })}
        >
          {item.leading}
          <View style={{ flex: 1, gap: 2 }}>
            <Text font="uiSemibold">{item.title}</Text>
            {item.subtitle ? (
              <Text size="footnote" tone="muted">
                {item.subtitle}
              </Text>
            ) : null}
          </View>
          <Text tone="muted">›</Text>
        </Pressable>
      ))}
    </View>
  );
}
