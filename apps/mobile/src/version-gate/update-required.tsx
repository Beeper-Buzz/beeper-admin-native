import { layout, radius, space } from '@instincts/spree-ui';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Screen } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { versionGateBreadcrumb } from '@/observability/sentry';
import { useTheme } from '@/theme/theme';
import { openUpdate } from './open-update';

/**
 * Below the store's minimum version: the app can't be used until it is updated. Rendered by the
 * root layout in place of the whole navigator, so tabs, pushed screens and form sheets are all
 * gone rather than merely covered.
 */
export function UpdateRequiredScreen({
  appName,
  storeName,
  installed,
  minimum,
  updateUrl,
  onSwitchStore,
}: {
  appName: string;
  storeName: string | null;
  installed: string | null;
  minimum: string;
  updateUrl: string | null;
  onSwitchStore: () => void;
}) {
  const { colors } = useTheme();
  useEffect(() => {
    versionGateBreadcrumb('Update required shown', { installed, minimum, hasLink: !!updateUrl });
  }, [installed, minimum, updateUrl]);

  const store = storeName ?? 'This store';
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: layout.gutter,
            gap: space[5],
          }}
        >
          <View style={{ gap: space[2] }}>
            <Text size="title1" font="display" accessibilityRole="header">
              Update required
            </Text>
            <Text tone="muted">
              {store} needs version {minimum} or later of {appName}. Update the app to keep using it.
            </Text>
          </View>

          <View style={[styles.card, { borderColor: colors.line, backgroundColor: colors.surface }]}>
            <View style={styles.row} accessible accessibilityLabel={`Installed: ${installed ?? 'unknown'}`}>
              <Label>Installed</Label>
              <Text font="mono">{installed ?? 'Unknown'}</Text>
            </View>
            <View
              style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }]}
              accessible
              accessibilityLabel={`Required: ${minimum} or later`}
            >
              <Label>Required</Label>
              <Text font="mono">{minimum}</Text>
            </View>
          </View>

          <View style={{ gap: space[3] }}>
            {updateUrl ? (
              <Button title="Update" onPress={() => void openUpdate(updateUrl, 'required')} />
            ) : (
              <Text tone="muted">Ask the store's admin how to get the latest version of {appName}.</Text>
            )}
            <Button
              title="Switch store"
              variant="tonal"
              accessibilityHint="Signs out of this store so you can connect another"
              onPress={() => {
                versionGateBreadcrumb('Switch store from Update required');
                onSwitchStore();
              }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
});
