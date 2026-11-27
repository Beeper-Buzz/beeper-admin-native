import { layout, space } from '@instincts/spree-ui';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CapabilityList } from '@/components/capability-list';
import { Button, Screen } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useCan, useSession } from '@/session/session';
import { useTheme } from '@/theme/theme';

export default function MoreScreen() {
  const { state, signOut } = useSession();
  const can = useCan();
  const { colors } = useTheme();
  const probe = state.store?.probe;
  const links: [string, string, () => void][] = [];
  if (can('promotions.read'))
    links.push(['Promotions', 'Discount codes and automatic offers', () => router.push('/more/promotions')]);
  if (can('media.library'))
    links.push([
      'Media',
      'Every product photo, and the ones missing alt text',
      () => router.push('/more/media'),
    ]);
  return (
    <Screen>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: layout.gutter, gap: space[5] }}>
          <Text size="title1" font="display">
            More
          </Text>
          {links.length ? (
            <View
              style={{
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.line,
                borderRadius: 12,
                backgroundColor: colors.surface,
              }}
            >
              {links.map(([title, subtitle, onPress], i) => (
                <Pressable
                  key={title}
                  accessibilityRole="link"
                  accessibilityHint={subtitle}
                  onPress={onPress}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: space[3],
                    gap: space[3],
                    opacity: pressed ? 0.7 : 1,
                    borderTopWidth: i ? StyleSheet.hairlineWidth : 0,
                    borderTopColor: colors.line,
                  })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text font="uiSemibold">{title}</Text>
                    <Text size="footnote" tone="muted">
                      {subtitle}
                    </Text>
                  </View>
                  <Text tone="muted">›</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
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
