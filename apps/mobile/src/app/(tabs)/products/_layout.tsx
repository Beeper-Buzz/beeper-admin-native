import { Stack } from 'expo-router';
import { useTheme } from '@/theme/theme';

export default function ProductsLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Products', headerLargeTitle: true }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
      <Stack.Screen
        name="photo"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="variant"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          headerShown: false,
        }}
      />
    </Stack>
  );
}
