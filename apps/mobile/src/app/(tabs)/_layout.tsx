import { useMutation } from '@tanstack/react-query';
import { NativeTabs } from 'expo-router/native-tabs';
import { useEffect } from 'react';
import { unreadBadge } from '@/inbox/inbox-state';
import { useInboxSummary } from '@/inbox/use-inbox';
import { getPushToken, useNotificationNavigation } from '@/push/push';
import { useCan, useSession } from '@/session/session';
import { useTheme } from '@/theme/theme';
import { useTRPC } from '@/trpc/trpc';

/** Register for new-order notifications when the store runs the companion gem. */
function usePushRegistration() {
  const trpc = useTRPC();
  const { state } = useSession();
  const { mutate } = useMutation(trpc.devices.updatePush.mutationOptions());
  const canPush =
    state.store?.probe.capabilities.includes('notifications.push') &&
    state.store.credential.method === 'spreeToken';
  useEffect(() => {
    if (!canPush) return;
    getPushToken()
      .then((pushToken) => pushToken && mutate({ pushToken, enabled: true }))
      .catch(() => {});
  }, [canPush, mutate]);
}

export default function TabsLayout() {
  const { colors, fonts } = useTheme();
  usePushRegistration();
  useNotificationNavigation();
  // With a customer inbox, Inbox takes the Customers tab's place and Customers moves to More.
  const inbox = useCan()('inbox');
  const unread = unreadBadge(useInboxSummary().data?.unread);
  return (
    <NativeTabs
      backgroundColor={colors.surface}
      iconColor={{ default: colors.inkMuted, selected: colors.ink }}
      labelStyle={{
        default: { color: colors.inkMuted, fontFamily: fonts.uiMedium },
        selected: { color: colors.ink, fontFamily: fonts.uiSemibold },
      }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="orders">
        <NativeTabs.Trigger.Label>Orders</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'tray', selected: 'tray.fill' }} md="inbox" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="products">
        <NativeTabs.Trigger.Label>Products</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'tag', selected: 'tag.fill' }} md="sell" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inbox" hidden={!inbox}>
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }}
          md="forum"
        />
        <NativeTabs.Trigger.Badge hidden={!unread} selectedBackgroundColor={colors.info}>
          {unread ?? undefined}
        </NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="customers" hidden={inbox}>
        <NativeTabs.Trigger.Label>Customers</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="ellipsis" md="more_horiz" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
