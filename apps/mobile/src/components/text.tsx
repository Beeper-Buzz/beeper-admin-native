import { MAX_HERO_FONT_SCALE, type TypeStep, typeScale } from '@instincts/spree-ui';
import { Text as RNText, type TextProps } from 'react-native';
import { useTheme } from '@/theme/theme';

type Font = 'display' | 'ui' | 'uiMedium' | 'uiSemibold' | 'mono' | 'monoMedium';
type Tone = 'ink' | 'muted' | 'accent' | 'positive' | 'attention' | 'critical' | 'info';

export interface AppTextProps extends TextProps {
  size?: TypeStep;
  font?: Font;
  tone?: Tone;
}

const TONE = {
  ink: 'ink',
  muted: 'inkMuted',
  accent: 'accentInk',
  positive: 'positive',
  attention: 'attention',
  critical: 'critical',
  info: 'info',
} as const;

export function Text({ size = 'body', font = 'ui', tone = 'ink', style, ...rest }: AppTextProps) {
  const { colors, fonts } = useTheme();
  const fontSize = typeScale[size];
  return (
    <RNText
      maxFontSizeMultiplier={size === 'hero' ? MAX_HERO_FONT_SCALE : undefined}
      style={[
        {
          fontFamily: fonts[font],
          fontSize,
          lineHeight: Math.round(fontSize * (font === 'display' ? 1.08 : 1.4)),
          color: colors[TONE[tone]],
          letterSpacing: font === 'display' ? -0.02 * fontSize : 0,
          fontVariant: font.startsWith('mono') ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
      {...rest}
    />
  );
}

/** Small uppercase mono label ("SALES TODAY"). */
export function Label(props: Omit<AppTextProps, 'size' | 'font'>) {
  return (
    <Text
      size="caption"
      font="mono"
      tone="muted"
      {...props}
      style={[{ letterSpacing: 1, textTransform: 'uppercase' }, props.style]}
    />
  );
}
