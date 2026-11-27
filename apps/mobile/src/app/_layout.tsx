import '@/observability/init';
import { useFonts } from 'expo-font';
import { type ErrorBoundaryProps, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Pressable, Text, useColorScheme, View } from 'react-native';
import { fontAssets, theme } from '@/distribution';
import { Sentry, tagStore } from '@/observability/sentry';
import { SessionProvider, useSession } from '@/session/session';
import { AppThemeProvider, useTheme } from '@/theme/theme';
import { ApiProvider } from '@/trpc/trpc';
import { VersionGate } from '@/version-gate/version-gate';

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

function RootLayout() {
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
  const probe = state.session?.probe ?? null;

  useEffect(() => tagStore(probe), [probe]);

  useEffect(() => {
    if (booted) SplashScreen.hideAsync();
  }, [booted]);
  if (!booted) return null;

  const gateStore =
    state.status === 'ready' ? { id: state.store.id, capabilities: state.store.probe.capabilities } : null;
  return (
    <ApiProvider session={state.session} onAuthError={signOut}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <VersionGate store={gateStore} storeName={probe?.storeName ?? null} onSwitchStore={signOut}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Protected guard={state.status === 'ready'}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
          <Stack.Protected guard={state.status !== 'ready'}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      </VersionGate>
    </ApiProvider>
  );
}

export default Sentry.wrap(RootLayout);

/**
 * Last resort for a render error anywhere in the app: report it and offer a retry instead of
 * closing the app. Plain components only, because the theme and session providers may be what
 * failed.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const dark = useColorScheme() === 'dark';
  const ink = dark ? '#F4F5F6' : '#15181C';
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        padding: 24,
        gap: 12,
        backgroundColor: dark ? '#15181C' : '#FFFFFF',
      }}
    >
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600', color: ink }}>
        Something went wrong
      </Text>
      <Text style={{ fontSize: 15, color: ink, opacity: 0.75 }}>{error.message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={{
          alignSelf: 'flex-start',
          marginTop: 8,
          paddingVertical: 12,
          paddingHorizontal: 20,
          borderRadius: 10,
          backgroundColor: ink,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '600', color: dark ? '#15181C' : '#FFFFFF' }}>
          Try again
        </Text>
      </Pressable>
    </View>
  );
}
