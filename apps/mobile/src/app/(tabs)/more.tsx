import { layout, space } from '@instincts/spree-ui';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CapabilityList } from '@/components/capability-list';
import { Button, Screen } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useSession } from '@/session/session';

export default function MoreScreen() {
  const { state, signOut } = useSession();
  const probe = state.store?.probe;
  return (
    <Screen>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: layout.gutter, gap: space[5] }}>
          <Text size="title1" font="display">
            More
          </Text>
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
