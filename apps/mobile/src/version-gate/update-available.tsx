import { layout, radius, space } from '@instincts/spree-ui';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Button } from '@/components/primitives';
import { Text } from '@/components/text';
import { versionGateBreadcrumb } from '@/observability/sentry';
import { useTheme } from '@/theme/theme';
import { openUpdate } from './open-update';
import { isSnoozed, loadSnooze, markPrompted, promptKey, snooze, wasPrompted } from './snooze';

/**
 * Below the store's recommended version: a small card asking, not forcing, an update.
 *
 * At most once per app session for a store and version; Not now snoozes it for 24 hours for that
 * store and version, so a newer recommended version asks again at once. It waits for `canShow`
 * (the root layout passes "on a tab's first screen"), so it never lands on a form sheet or a
 * pushed screen, and the root layout never renders it with the Update required screen.
 */
export function UpdateAvailablePrompt({
  appName,
  storeId,
  installed,
  recommended,
  updateUrl,
  canShow,
}: {
  appName: string;
  storeId: string;
  installed: string | null;
  recommended: string;
  updateUrl: string | null;
  canShow: boolean;
}) {
  const { colors } = useTheme();
  const key = promptKey(storeId, recommended);
  /** The key whose snooze has been read and found clear. */
  const [eligible, setEligible] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    loadSnooze(storeId).then((s) => {
      if (live && !isSnoozed(s, recommended)) setEligible(promptKey(storeId, recommended));
    });
    return () => {
      live = false;
    };
  }, [storeId, recommended]);

  useEffect(() => {
    if (open || !canShow || eligible !== key || wasPrompted(key)) return;
    markPrompted(key);
    setOpen(true);
    versionGateBreadcrumb('Update available shown', { installed, recommended });
  }, [open, canShow, eligible, key, installed, recommended]);

  const notNow = () => {
    setOpen(false);
    versionGateBreadcrumb('Update available snoozed', { recommended });
    void snooze(storeId, recommended);
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={notNow}>
      <View style={[styles.scrim, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <View
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.line }]}
        >
          <Text size="title3" font="uiSemibold" accessibilityRole="header">
            Update available
          </Text>
          <Text tone="muted">
            {appName} {recommended} is available
            {installed ? ` (you have ${installed})` : ''}.{' '}
            {updateUrl ? 'Update for the latest fixes and features.' : "Ask the store's admin how to get it."}
          </Text>
          <View style={{ gap: space[2] }}>
            {updateUrl ? (
              <Button
                title="Update"
                onPress={() => {
                  setOpen(false);
                  void openUpdate(updateUrl, 'recommended');
                }}
              />
            ) : null}
            <Button title="Not now" variant="plain" onPress={notNow} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center', padding: layout.gutter },
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sheet,
    padding: space[5],
    gap: space[4],
  },
});
