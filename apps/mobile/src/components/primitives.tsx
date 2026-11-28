import { formatMoney, type Money } from '@instincts/spree-domain';
import { layout, radius, space } from '@instincts/spree-ui';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type ViewProps,
} from 'react-native';
import { useTheme } from '@/theme/theme';
import { Text } from './text';

/**
 * Root of a form sheet (`presentation: 'formSheet'`, `sheetAllowedDetents: 'fitToContents'`):
 * sized by its content, not the screen, and with no safe-area inset at the top.
 */
/**
 * A form sheet's root. Sized by its content for `fitToContents` sheets; `fill` stretches it to a
 * fixed-detent sheet so a list inside can take the remaining height (flex: 1).
 */
export function Sheet({ style, fill, ...rest }: ViewProps & { fill?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        { backgroundColor: colors.bg, padding: layout.gutter, paddingTop: space[5], gap: space[4] },
        fill ? { flex: 1 } : null,
        style,
      ]}
      {...rest}
    />
  );
}

export function Screen({ style, ...rest }: ViewProps) {
  const { colors } = useTheme();
  return <View style={[{ flex: 1, backgroundColor: colors.bg }, style]} {...rest} />;
}

export function MoneyText({
  value,
  size = 'body',
  font = 'mono',
}: {
  value: Money;
  size?: 'body' | 'callout' | 'title2' | 'title1' | 'hero';
  font?: 'mono' | 'display';
}) {
  const negative = value.amount.startsWith('-');
  return (
    <Text size={size} font={font} tone={negative ? 'critical' : 'ink'}>
      {formatMoney(value)}
    </Text>
  );
}

/** Spree number with its prefix as a small inverted glyph: [R]482913057. Long-press to copy comes in Phase 1. */
export function SpreeNumberText({ value }: { value: string }) {
  const { colors, fonts } = useTheme();
  // Spree 6 numbers children after the order (R1029-F1): show the child's letter as the glyph.
  const child = /^(.*)-([A-Z])(\d*)$/.exec(value);
  const prefix = child ? (child[2] ?? '') : (/^[A-Z]{1,2}/.exec(value)?.[0] ?? '');
  const rest = child ? `${child[1]}-${child[2]}${child[3]}` : value.slice(prefix.length);
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
      accessibilityLabel={`Number ${value}`}
    >
      <View
        style={{ backgroundColor: colors.ink, borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1 }}
      >
        <Text style={{ fontFamily: fonts.monoMedium, fontSize: 10, lineHeight: 13, color: colors.bg }}>
          {prefix}
        </Text>
      </View>
      <Text font="monoMedium" size="footnote">
        {rest}
      </Text>
    </View>
  );
}

export type BadgeTone = 'positive' | 'attention' | 'critical' | 'info' | 'neutral';

/** Status badge: dot plus label, never colour alone. */
export function Badge({ tone, label }: { tone: BadgeTone; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.badge, { borderColor: colors.line, backgroundColor: colors.surface }]}>
      <View style={[styles.dot, { backgroundColor: colors[tone] }]} />
      <Text size="caption" font="uiMedium">
        {label}
      </Text>
    </View>
  );
}

export function Button({
  title,
  loading,
  disabled,
  variant = 'primary',
  size = 'regular',
  ...rest
}: PressableProps & {
  title: string;
  loading?: boolean;
  variant?: 'primary' | 'plain' | 'tonal' | 'destructive';
  /** `small`: inline row actions (Capture, Refund, Mark shipped). */
  size?: 'regular' | 'small';
}) {
  const { colors } = useTheme();
  const primary = variant === 'primary';
  const background =
    variant === 'primary' ? colors.accent : variant === 'tonal' ? colors.surface : 'transparent';
  const ink =
    variant === 'primary' ? colors.onAccent : variant === 'destructive' ? colors.critical : colors.accentInk;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        size === 'small' ? styles.smallButton : styles.button,
        { backgroundColor: background },
        variant === 'tonal' && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
        { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.onAccent : colors.ink} />
      ) : (
        <Text font="uiSemibold" size={size === 'small' ? 'footnote' : 'callout'} style={{ color: ink }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  required,
  style,
  ...rest
}: TextInputProps & {
  label: string;
  error?: string | null;
  /** Marks the label with an asterisk and says "required" to screen readers. */
  required?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ gap: space[1] }}>
      <Text size="footnote" font="uiMedium" tone="muted">
        {required ? `${label} *` : label}
      </Text>
      <TextInput
        accessibilityLabel={required ? `${label}, required` : label}
        placeholderTextColor={colors.inkMuted}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.critical : colors.line,
            color: colors.ink,
            fontFamily: fonts.ui,
          },
          // Callers add to the input's look (e.g. a taller multiline field); they never replace it.
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text size="footnote" tone="critical">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ padding: space[8], gap: space[2], alignItems: 'center' }}>
      <Text size="title3" font="uiSemibold" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      <Text tone="muted" style={{ textAlign: 'center', maxWidth: 320 }}>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.badge,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  smallButton: {
    minHeight: 32,
    paddingHorizontal: space[3],
    borderRadius: radius.badge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    minHeight: layout.hitTarget + 4,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[4],
  },
  input: {
    minHeight: layout.hitTarget,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space[3],
    fontSize: 16,
  },
});
