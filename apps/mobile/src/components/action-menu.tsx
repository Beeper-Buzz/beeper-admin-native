import { layout, radius, space } from '@instincts/spree-ui';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/theme';
import { Text } from './text';

export interface MenuAction {
  key: string;
  label: string;
  /** Red, for actions that remove something. */
  destructive?: boolean;
  /** A short second line ("Tomorrow 9:00"). */
  detail?: string | null;
  onPress: () => void;
}

/**
 * A bottom sheet of actions (row menus, snooze choices): any number of actions on both platforms,
 * which Alert can't do on Android. Choosing an action closes the menu first.
 */
export function ActionMenu({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  actions: readonly MenuAction[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close menu"
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]}
      />
      <View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          { backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, space[4]) },
        ]}
      >
        <Text size="footnote" font="uiSemibold" tone="muted" accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: StyleSheet.hairlineWidth }}>
          {actions.map((a) => (
            <Pressable
              key={a.key}
              accessibilityRole="button"
              accessibilityLabel={a.detail ? `${a.label}, ${a.detail}` : a.label}
              onPress={() => {
                onClose();
                a.onPress();
              }}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? colors.surfaceSunk : colors.surface },
              ]}
            >
              <Text font="uiMedium" tone={a.destructive ? 'critical' : 'ink'} style={{ flex: 1 }}>
                {a.label}
              </Text>
              {a.detail ? (
                <Text size="footnote" tone="muted">
                  {a.detail}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [
            styles.row,
            styles.cancel,
            { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text font="uiSemibold" tone="accent">
            Cancel
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: layout.gutter,
    gap: space[3],
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  row: {
    minHeight: layout.hitTarget + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.badge,
  },
  cancel: { justifyContent: 'center' },
});
