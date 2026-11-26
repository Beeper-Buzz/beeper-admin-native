import { type ColorScheme, counterTheme, fonts, type Palette, type Theme } from '@instincts/spree-ui';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

export interface ResolvedTheme {
  scheme: ColorScheme;
  colors: Palette;
  fonts: {
    display: string;
    displayMedium: string;
    ui: string;
    uiMedium: string;
    uiSemibold: string;
    mono: string;
    monoMedium: string;
  };
}

const ThemeContext = createContext<ResolvedTheme | null>(null);

export function AppThemeProvider({ theme = counterTheme, children }: { theme?: Theme; children: ReactNode }) {
  const system = useColorScheme();
  const scheme: ColorScheme = system === 'dark' || system === 'light' ? system : theme.defaultScheme;
  const value = useMemo<ResolvedTheme>(
    () => ({
      scheme,
      colors: theme[scheme],
      fonts: {
        ...fonts,
        ...(theme.fonts?.display ? { display: theme.fonts.display, displayMedium: theme.fonts.display } : {}),
        ...(theme.fonts?.ui
          ? { ui: theme.fonts.ui, uiMedium: theme.fonts.ui, uiSemibold: theme.fonts.ui }
          : {}),
        ...(theme.fonts?.mono ? { mono: theme.fonts.mono, monoMedium: theme.fonts.mono } : {}),
      },
    }),
    [scheme, theme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ResolvedTheme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme must be used inside AppThemeProvider');
  return t;
}
