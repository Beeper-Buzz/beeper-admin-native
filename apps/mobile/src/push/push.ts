import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/** Show new-order notifications while the app is open, too. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * An Expo push token for this install, or null when push isn't possible: simulator, permission
 * refused, or no EAS project configured for this distribution (distribution.json → eas.projectId).
 */
export async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('orders', {
      name: 'New orders',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

/** Tapping a new-order notification opens that order (`data.url` from the companion gem). */
export function useNotificationNavigation() {
  useEffect(() => {
    const open = (data: unknown) => {
      const url = (data as { url?: unknown } | undefined)?.url;
      if (typeof url === 'string' && url.startsWith('/orders/')) router.push(url as `/orders/${string}`);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification.request.content.data);
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      open(r.notification.request.content.data),
    );
    return () => sub.remove();
  }, []);
}
