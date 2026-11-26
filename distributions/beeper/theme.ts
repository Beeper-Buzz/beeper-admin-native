import { defineTheme } from '@spree-native/ui';

/** Beeper Δ8 tokens, from BeeperNative tailwind.config.js / ThemeObject.ts (fork spec §4). */
export const theme = defineTheme({
  name: 'beeper',
  defaultScheme: 'dark',
  dark: {
    bg: '#000000',
    surface: '#111111',
    surfaceSunk: '#1A1A1A',
    ink: '#F1F0E8',
    inkMuted: '#999999',
    line: '#333333',
    accent: '#FF008A',
    // White on hot pink is 3.7:1; black passes AA.
    onAccent: '#000000',
    accentInk: '#FF69B4',
    positive: '#33FF66',
    attention: '#FFB400',
    critical: '#FF5252',
    info: '#55C1FF',
    neutral: '#999999',
  },
  light: { accent: '#FF008A', onAccent: '#000000', accentInk: '#A3005A' },
  fonts: { display: 'PressStart2P_400Regular', ui: 'Barlow_500Medium', mono: 'IBMPlexMono_400Regular' },
});
