import { layout, radius, space } from '@instincts/spree-ui';
import { Pressable, ScrollView } from 'react-native';
import { useTheme } from '@/theme/theme';
import { Text } from './text';

/** Horizontal filter tabs above a list; the selected one can show a count. */
export function FilterChips<K extends string>({
  options,
  value,
  onChange,
  count,
}: {
  options: readonly (readonly [K, string])[];
  value: K;
  onChange: (key: K) => void;
  count?: number | undefined;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space[2], paddingHorizontal: layout.gutter, paddingVertical: space[3] }}
    >
      {options.map(([key, label]) => {
        const on = key === value;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(key)}
            style={{
              paddingHorizontal: space[3],
              paddingVertical: 6,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: on ? colors.ink : colors.line,
              backgroundColor: on ? colors.ink : colors.surface,
            }}
          >
            <Text size="footnote" font="uiMedium" style={{ color: on ? colors.bg : colors.ink }}>
              {label}
              {on && count !== undefined ? ` ${count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
