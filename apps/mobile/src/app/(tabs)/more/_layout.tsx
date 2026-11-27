import { Stack } from 'expo-router';
import { useTheme } from '@/theme/theme';

export default function MoreLayout() {
  const { colors, fonts } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: fonts.uiSemibold },
        headerLargeTitleStyle: { fontFamily: fonts.display },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="promotions/index" options={{ title: 'Promotions', headerLargeTitle: true }} />
      <Stack.Screen name="promotions/[id]" options={{ title: '' }} />
    </Stack>
  );
}
