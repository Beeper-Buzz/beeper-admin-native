import { Stack } from 'expo-router';
import { useTheme } from '@/theme/theme';

export default function InboxLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Inbox', headerLargeTitle: true }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
      <Stack.Screen
        name="customer"
        options={{
          presentation: 'formSheet',
          // Scrolling content that loads after the sheet opens needs fixed detents: fitToContents
          // can't size a ScrollView and its text overlapped.
          sheetAllowedDetents: [0.66, 0.95],
          sheetGrabberVisible: true,
          headerShown: false,
        }}
      />
    </Stack>
  );
}
