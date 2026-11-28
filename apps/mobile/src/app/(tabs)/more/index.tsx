import { layout, space } from '@instincts/spree-ui';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AdminTypeSections } from '@/admin-types/more-sections';
import { CapabilityList } from '@/components/capability-list';
import { LinkCard, type LinkItem } from '@/components/link-card';
import { Button, Screen } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useCan, useSession } from '@/session/session';

export default function MoreScreen() {
  const { state, signOut } = useSession();
  const can = useCan();
  const probe = state.store?.probe;
  const links: LinkItem[] = [];
  // The Inbox tab takes the Customers tab's place; Customers is here instead.
  if (can('inbox') && can('customers.read'))
    links.push({
      key: 'customers',
      title: 'Customers',
      subtitle: 'Everyone who has an account or ordered',
      onPress: () => router.push('/more/customers'),
    });
  if (can('visitors') || can('carts'))
    links.push({
      key: 'visitors',
      title: 'Visitors',
      subtitle: can('visitors')
        ? 'Who is on the store now, and their carts'
        : 'Carts in progress and abandoned',
      onPress: () => router.push('/more/visitors'),
    });
  if (can('promotions.read'))
    links.push({
      key: 'promotions',
      title: 'Promotions',
      subtitle: 'Discount codes and automatic offers',
      onPress: () => router.push('/more/promotions'),
    });
  if (can('media.library'))
    links.push({
      key: 'media',
      title: 'Media',
      subtitle: 'Every product photo, and the ones missing alt text',
      onPress: () => router.push('/more/media'),
    });
  return (
    <Screen>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: layout.gutter, gap: space[5] }}>
          <Text size="title1" font="display">
            More
          </Text>
          <LinkCard items={links} />
          <AdminTypeSections />
          {probe ? (
            <View style={{ gap: space[2] }}>
              <Label>About this store</Label>
              <Text font="uiSemibold">{probe.storeName ?? probe.baseUrl}</Text>
              <Text size="footnote" font="mono" tone="muted">
                {[
                  probe.baseUrl,
                  probe.preferredApi,
                  probe.spreeVersion ? `Spree ${probe.spreeVersion}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <CapabilityList capabilities={probe.capabilities} />
            </View>
          ) : null}
          <Button title="Sign out" variant="plain" onPress={signOut} />
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
