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

/**
 * Where a tapped notification goes: a customer message (`{ type: 'inbox', conversation_id }`,
 * companion gem 0.7) opens its conversation, a new order (`data.url`) opens that order. null for
 * anything else.
 */
export function notificationRoute(data: unknown): `/inbox/${string}` | `/orders/${string}` | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as { type?: unknown; conversation_id?: unknown; url?: unknown };
  if (d.type === 'inbox') {
    const id =
      typeof d.conversation_id === 'number' && Number.isFinite(d.conversation_id)
        ? String(d.conversation_id)
        : d.conversation_id;
    return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? `/inbox/${id}` : null;
  }
  if (typeof d.url === 'string' && d.url.startsWith('/orders/')) return d.url as `/orders/${string}`;
  return null;
}

/** Tapping a notification opens what it is about (see `notificationRoute`). */
export function useNotificationNavigation() {
  useEffect(() => {
    const open = (data: unknown) => {
      const route = notificationRoute(data);
      if (route) router.push(route);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification.request.content.data);
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      open(r.notification.request.content.data),
    );
    return () => sub.remove();
  }, []);
}
