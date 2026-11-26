import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { fontAssets, theme } from '@/distribution';
import { SessionProvider, useSession } from '@/session/session';
import { AppThemeProvider, useTheme } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';

SplashScreen.preventAutoHideAsync();

// Import single weights by file: a font package's index pulls in every weight and italic.
const COUNTER_FONTS = {
  BricolageGrotesque_600SemiBold: require('@expo-google-fonts/bricolage-grotesque/600SemiBold/BricolageGrotesque_600SemiBold.ttf'),
  BricolageGrotesque_700Bold: require('@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf'),
  Geist_400Regular: require('@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf'),
  Geist_500Medium: require('@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf'),
  Geist_600SemiBold: require('@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf'),
  GeistMono_400Regular: require('@expo-google-fonts/geist-mono/400Regular/GeistMono_400Regular.ttf'),
  GeistMono_500Medium: require('@expo-google-fonts/geist-mono/500Medium/GeistMono_500Medium.ttf'),
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ ...COUNTER_FONTS, ...fontAssets });
  return (
    <AppThemeProvider theme={theme}>
      <SessionProvider>
        <Navigation ready={fontsLoaded} />
      </SessionProvider>
    </AppThemeProvider>
  );
}

function Navigation({ ready }: { ready: boolean }) {
  const { state, signOut } = useSession();
  const { colors, scheme } = useTheme();
  const booted = ready && state.status !== 'loading';

  useEffect(() => {
    if (booted) SplashScreen.hideAsync();
  }, [booted]);
  if (!booted) return null;

  return (
    <ApiProvider session={state.session} onAuthError={signOut}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Protected guard={state.status === 'ready'}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={state.status !== 'ready'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </ApiProvider>
  );
}
