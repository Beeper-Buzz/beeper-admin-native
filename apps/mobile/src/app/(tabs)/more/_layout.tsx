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
      <Stack.Screen name="media" options={{ title: 'Media', headerLargeTitle: true }} />
      {/* Host-described admin types; the screens set their titles from the manifest. */}
      <Stack.Screen name="admin/[key]/index" options={{ title: '', headerLargeTitle: true }} />
      <Stack.Screen name="admin/[key]/[id]" options={{ title: '' }} />
      <Stack.Screen name="admin/[key]/new" options={{ title: 'New' }} />
      <Stack.Screen
        name="admin/pick"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="admin/action"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          headerShown: false,
        }}
      />
      {/* The menu builder's Move sheet and its groups (menu locations). */}
      <Stack.Screen
        name="admin/move"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="admin/groups"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          headerShown: false,
        }}
      />
      {/* Customers live here when the Inbox tab takes their place. */}
      <Stack.Screen name="customers/index" options={{ title: 'Customers', headerLargeTitle: true }} />
      <Stack.Screen name="customers/[id]" options={{ title: '' }} />
      <Stack.Screen name="visitors/index" options={{ title: 'Visitors', headerLargeTitle: true }} />
      <Stack.Screen name="visitors/[id]" options={{ title: 'Visitor' }} />
    </Stack>
  );
}
